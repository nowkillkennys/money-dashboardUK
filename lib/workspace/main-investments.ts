import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpError } from "./http";
export const investmentFields: Record<string, string[]> = {
  holding: ["account_id", "symbol", "shares", "cost_basis", "cost_currency"],
  dividend: ["holding_id", "symbol", "amount", "date", "notes", "reinvested"],
};
function invalid(message: string): never {
  throw new HttpError(400, message);
}
function identifier(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    invalid("Invalid identifier");
  return v;
}
function decimal(v: unknown, places: number, whole: number): string {
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    !new RegExp(`^(0|[1-9]\\d{0,${whole - 1}})(\\.\\d{1,${places}})?$`).test(String(v))
  )
    invalid(`Enter a non-negative decimal with at most ${places} decimal places`);
  return String(v);
}
function text(v: unknown, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) invalid("Invalid text");
  return v.trim();
}
function civil(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v < "1900-01-01" ||
    v > "9999-12-31" ||
    !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    invalid("Invalid date");
  return v;
}
export async function executeInvestmentCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  const entity = typeof input.action === "string" ? input.action.split(".")[0] : "";
  if (!Object.prototype.hasOwnProperty.call(investmentFields, entity)) return undefined;
  if (!new RegExp(`^${entity}\\.(create|update|delete)$`).test(input.action))
    invalid("Unsupported investment command");
  const action = input.action.split(".")[1];
  if (
    Object.keys(input).some(
      (k) => !["action", "id", "version", "currency", ...investmentFields[entity]].includes(k)
    )
  )
    invalid("Unknown command field");
  if (input.currency !== undefined && input.currency !== "GBP") invalid("This workspace uses GBP");
  if (input.cost_currency !== undefined && input.cost_currency !== "GBP")
    invalid("Cost basis must use GBP");
  if (action === "create" && (input.id !== undefined || input.version !== undefined))
    invalid("New records use server identifiers");
  if (
    action === "delete" &&
    Object.keys(input).some((k) => !["action", "id", "version", "currency"].includes(k))
  )
    invalid("Delete accepts only the record identifier and version");
  const table = entity === "holding" ? "money_holdings" : "money_dividends";
  let row: any;
  const resourceId = action === "create" ? randomUUID() : identifier(input.id);
  if (action !== "create") {
    if (!Number.isSafeInteger(input.version) || input.version < 1) invalid("Invalid version");
    row = (
      await c.query(`SELECT * FROM ${table} WHERE user_id=$1 AND id=$2 FOR UPDATE`, [
        owner,
        resourceId,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, "Record not found");
    if (row.version !== input.version)
      throw new HttpError(409, "Record changed. Reload before saving");
  }
  if (action === "delete") {
    if (
      entity === "holding" &&
      (
        await c.query("SELECT 1 FROM money_dividends WHERE user_id=$1 AND holding_id=$2 LIMIT 1", [
          owner,
          resourceId,
        ])
      ).rowCount
    )
      throw new HttpError(409, "Delete dividend history before deleting this position");
    await c.query(`DELETE FROM ${table} WHERE user_id=$1 AND id=$2`, [owner, resourceId]);
    return { id: resourceId, version: row.version + 1, row: { ...row, version: row.version + 1 } };
  }
  const value = (k: string, fallback?: unknown) =>
    input[k] !== undefined ? input[k] : (row?.[k] ?? fallback);
  let fields: Record<string, any>;
  if (entity === "holding") {
    const account = identifier(value("account_id"));
    const a = (
      await c.query(
        "SELECT type,currency FROM money_accounts WHERE user_id=$1 AND id=$2 FOR SHARE",
        [owner, account]
      )
    ).rows[0];
    if (!a || a.type !== "investing" || a.currency !== "GBP")
      invalid("Choose your GBP investing account");
    const symbol = text(value("symbol"), 32).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.^=:/_-]*$/.test(symbol)) invalid("Invalid symbol");
    if (["CASH", "CASHCAD"].includes(symbol))
      invalid("Track cash in the investing account balance");
    if (
      row &&
      symbol !== row.symbol &&
      (
        await c.query("SELECT 1 FROM money_dividends WHERE user_id=$1 AND holding_id=$2 LIMIT 1", [
          owner,
          resourceId,
        ])
      ).rowCount
    )
      invalid("A position with dividend history cannot change symbol");
    fields = {
      account_id: account,
      symbol,
      shares: decimal(value("shares", 0), 6, 8),
      cost_basis: decimal(value("cost_basis", 0), 2, 10),
      cost_currency: "GBP",
    };
  } else {
    const holding = identifier(value("holding_id"));
    const h = (
      await c.query("SELECT symbol FROM money_holdings WHERE user_id=$1 AND id=$2 FOR SHARE", [
        owner,
        holding,
      ])
    ).rows[0];
    if (!h) invalid("Choose your holding");
    if (input.symbol !== undefined && input.symbol !== h.symbol)
      invalid("Dividend symbol must match the holding");
    const notes = value("notes", null),
      reinvested = value("reinvested", false);
    if (notes !== null && (typeof notes !== "string" || notes.length > 2000))
      invalid("Notes must be at most 2000 characters");
    if (typeof reinvested !== "boolean") invalid("Invalid reinvestment setting");
    const amount = decimal(value("amount"), 2, 10);
    if (Number(amount) <= 0) invalid("Enter a positive dividend");
    const oldDate = row?.date instanceof Date ? row.date.toISOString().slice(0, 10) : row?.date;
    fields = {
      holding_id: holding,
      symbol: h.symbol,
      amount,
      currency: "GBP",
      date: civil(input.date !== undefined ? input.date : oldDate),
      notes,
      reinvested,
    };
  }
  const cols = Object.keys(fields);
  if (action === "create")
    row = (
      await c.query(
        `INSERT INTO ${table}(id,user_id,${cols.join(",")}) VALUES($1,$2,${cols.map((_, i) => "$" + (i + 3)).join(",")}) RETURNING *`,
        [resourceId, owner, ...Object.values(fields)]
      )
    ).rows[0];
  else
    row = (
      await c.query(
        `UPDATE ${table} SET ${cols.map((k, i) => k + "=$" + (i + 3)).join(",")},version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *`,
        [owner, resourceId, ...Object.values(fields)]
      )
    ).rows[0];
  return {
    id: row.id,
    version: row.version,
    row: {
      ...row,
      ...(row.date instanceof Date ? { date: row.date.toISOString().slice(0, 10) } : {}),
    },
  };
}
