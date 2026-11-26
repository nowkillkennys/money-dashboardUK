import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { parseMoneyMinor, formatMoneyDecimal } from "../debt/money";
import { londonCivilDate } from "../money/uk-locale";
import { HttpError } from "./http";

export const preferenceFields: Record<string, string[]> = {
  subscription: [
    "name",
    "amount",
    "frequency",
    "category",
    "next_billing",
    "is_active",
    "notes",
    "payment_account_id",
  ],
  settings: [
    "base_currency",
    "display_name",
    "greeting_tone",
    "expense_categories",
    "subscription_categories",
    "rent_amount",
    "rent_day",
    "rent_reminder_days",
    "bill_reminder_days",
    "monthly_essentials_budget",
    "paycheck_amount",
    "paycheck_frequency",
    "auto_apply_allocation",
    "dismissed_merchants",
  ],
};
function invalid(message: string): never {
  throw new HttpError(400, message);
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid("Invalid identifier");
  return value;
}
function text(value: unknown, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!nullable && !value.trim()) ||
    /\u0000/.test(value)
  )
    invalid("Invalid text");
  return value.trim();
}
function decimalGBP(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") invalid("Invalid GBP amount");
  try {
    return formatMoneyDecimal(parseMoneyMinor(String(value)));
  } catch {
    return invalid("Enter a non-negative GBP amount with at most two decimal places");
  }
}
function civilDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    invalid("Invalid date");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("Invalid boolean");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    invalid("Invalid day");
  return value;
}
function choice(value: unknown, choices: string[]): string {
  if (typeof value !== "string" || !choices.includes(value)) invalid("Invalid frequency");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) invalid("Invalid category list");
  const values = value.map((v) => text(v, 80) as string);
  if (new Set(values.map((v) => v.toLowerCase())).size !== values.length)
    invalid("Duplicate list entries");
  return values;
}
function current(input: Record<string, any>, row: any) {
  if (!Number.isInteger(input.version) || input.version < 1 || input.version !== row.version)
    throw new HttpError(409, "Record changed. Reload before saving");
}
function plain(row: any) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result))
    if (value instanceof Date)
      result[key] = key === "next_billing" ? value.toISOString().slice(0, 10) : value.toISOString();
  delete result.pin_hash;
  delete result.failed_attempts;
  delete result.locked_until;
  return result;
}

/** Executed inside the caller's owner-scoped transaction and receipt journal. Schedules never post transactions. */
export async function executePreferenceCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  const [entity, action, extra] = typeof input.action === "string" ? input.action.split(".") : [];
  if (!Object.prototype.hasOwnProperty.call(preferenceFields, entity)) return undefined;
  if (
    extra !== undefined ||
    !action ||
    Object.keys(input).some(
      (k) => !["action", "id", "version", "currency", ...preferenceFields[entity]].includes(k)
    )
  )
    invalid("Unknown command field");
  if (input.currency !== undefined && input.currency !== "GBP") invalid("This workspace uses GBP");
  const table = entity === "subscription" ? "money_subscriptions" : "money_settings";
  let row: any;
  if (entity === "settings") {
    if (action !== "upsert") invalid("Unsupported settings command");
    // Serialize initial creation too: SELECT FOR UPDATE cannot lock an absent row.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["settings:" + owner]);
    row = (await c.query("SELECT * FROM money_settings WHERE user_id=$1 FOR UPDATE", [owner]))
      .rows[0];
    if (input.id !== undefined && (!row || uuid(input.id) !== row.id))
      throw new HttpError(404, "Record not found");
    if (row) current(input, row);
    else if (input.version !== undefined) invalid("New settings must not specify a version");
  } else {
    if (!["create", "update", "delete"].includes(action))
      invalid("Unsupported subscription command");
    if (action === "create") {
      if (input.id !== undefined || input.version !== undefined)
        invalid("New schedules must not specify an identifier or version");
    } else {
      row = (
        await c.query("SELECT * FROM money_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE", [
          uuid(input.id),
          owner,
        ])
      ).rows[0];
      if (!row) throw new HttpError(404, "Record not found");
      current(input, row);
      if (row.currency !== "GBP") invalid("This workspace uses GBP");
      if (action === "delete") {
        if (Object.keys(input).some((k) => !["action", "id", "version", "currency"].includes(k)))
          invalid("Unexpected delete field");
        await c.query("DELETE FROM money_subscriptions WHERE id=$1 AND user_id=$2", [
          row.id,
          owner,
        ]);
        return { id: row.id, version: row.version + 1, row: plain(row) };
      }
    }
  }
  const get = (key: string, fallback: any) =>
    input[key] === undefined ? (row?.[key] ?? fallback) : input[key];
  let fields: Record<string, any>;
  if (entity === "subscription") {
    const account = get("payment_account_id", null);
    if (account !== null) {
      if (typeof account !== "string") invalid("Invalid payment account");
      const card = account.startsWith("cc:");
      const accountId = uuid(card ? account.slice(3) : account);
      const reference = (
        await c.query(
          `SELECT id FROM ${card ? "money_credit_cards" : "money_accounts"} WHERE id=$1 AND user_id=$2 AND currency='GBP' AND archived=false FOR SHARE`,
          [accountId, owner]
        )
      ).rows[0];
      if (!reference) throw new HttpError(404, "Payment account not found");
    }
    const nextBilling = get("next_billing", londonCivilDate());
    fields = {
      name: text(get("name", undefined), 80),
      amount: decimalGBP(get("amount", undefined)),
      currency: "GBP",
      frequency: choice(get("frequency", "monthly"), ["weekly", "bi-weekly", "monthly", "yearly"]),
      category: text(get("category", null), 80, true),
      next_billing: civilDate(
        nextBilling instanceof Date ? nextBilling.toISOString().slice(0, 10) : nextBilling
      ),
      is_active: boolean(get("is_active", true)),
      notes: text(get("notes", null), 2000, true),
      payment_account_id: account,
    };
  } else {
    if (get("base_currency", "GBP") !== "GBP") invalid("This workspace uses GBP");
    if (boolean(get("auto_apply_allocation", false)))
      invalid("Automatic allocation is not available; apply a plan explicitly");
    fields = {
      base_currency: "GBP",
      display_name: text(get("display_name", "User"), 80),
      greeting_tone: text(get("greeting_tone", "neutral"), 200),
      expense_categories: strings(
        get("expense_categories", ["Food", "Transport", "Bills", "Rent", "Fun", "Health", "Other"])
      ),
      subscription_categories: strings(
        get("subscription_categories", ["Streaming", "Software", "Other"])
      ),
      rent_amount: decimalGBP(get("rent_amount", 0)),
      rent_day: integer(get("rent_day", 1), 1, 31),
      rent_reminder_days: integer(get("rent_reminder_days", 0), 0, 30),
      bill_reminder_days: integer(get("bill_reminder_days", 0), 0, 30),
      monthly_essentials_budget: decimalGBP(get("monthly_essentials_budget", 0)),
      paycheck_amount: decimalGBP(get("paycheck_amount", 0)),
      paycheck_frequency: choice(get("paycheck_frequency", "monthly"), [
        "weekly",
        "bi-weekly",
        "monthly",
      ]),
      auto_apply_allocation: false,
      dismissed_merchants: strings(get("dismissed_merchants", [])),
    };
    for (const key of ["expense_categories", "subscription_categories", "dismissed_merchants"])
      fields[key] = JSON.stringify(fields[key]);
  }
  const cols = Object.keys(fields);
  if (row)
    row = (
      await c.query(
        `UPDATE ${table} SET ${cols.map((k, i) => k + "=$" + (i + 3)).join(",")},version=version+1 WHERE id=$1 AND user_id=$2 RETURNING *`,
        [row.id, owner, ...Object.values(fields)]
      )
    ).rows[0];
  else
    row = (
      await c.query(
        `INSERT INTO ${table}(id,user_id,${cols.join(",")}) VALUES($1,$2,${cols.map((_, i) => "$" + (i + 3)).join(",")}) RETURNING *`,
        [randomUUID(), owner, ...Object.values(fields)]
      )
    ).rows[0];
  return { id: row.id, version: row.version, row: plain(row) };
}
