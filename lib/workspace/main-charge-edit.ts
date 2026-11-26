import { protectRefundedPurchase } from "./main-refunds";
import type { PoolClient } from "pg";
import { HttpError } from "./http";

export const chargeEditFields = [
  "card_version",
  "transaction_version",
  "amount",
  "date",
  "merchant",
  "category",
  "notes",
  "tx_overrides",
];
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    fail(400, "Invalid identifier");
  return value as string;
}
function decimal(value: unknown, share = false): string {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(value))
  )
    fail(400, "Invalid decimal amount");
  const result = String(value);
  const [whole, fraction = ""] = result.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (share ? minor > 10000n : minor <= 0n || minor > 9999999999n)
    fail(400, share ? "Invalid personal share" : "Enter a positive GBP amount");
  return result;
}
function day(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    fail(400, "Invalid date");
  return value as string;
}
function text(value: unknown, max: number): string | null {
  if (value !== null && (typeof value !== "string" || [...value].length > max))
    fail(400, "Invalid text field");
  return value as string | null;
}

/** Runs inside the main command's owner, manual-input and receipt transaction. */
export async function executeChargeEditCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
) {
  if (input.action !== "charge.update") return null;
  if (Object.keys(input).some((k) => !["action", "id", "version", ...chargeEditFields].includes(k)))
    fail(400, "Unknown charge field");
  const chargeId = uuid(input.id);
  const found = (
    await c.query("SELECT card_id FROM money_credit_card_charges WHERE user_id=$1 AND id=$2", [
      owner,
      chargeId,
    ])
  ).rows[0];
  if (!found) fail(404, "Record not found");
  // Shared lock order with statement reconciliation and card commands.
  const anchor = (
    await c.query("SELECT * FROM workspace_accounts WHERE owner_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      found.card_id,
    ])
  ).rows[0];
  const card = (
    await c.query("SELECT * FROM money_credit_cards WHERE user_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      found.card_id,
    ])
  ).rows[0];
  const charge = (
    await c.query("SELECT * FROM money_credit_card_charges WHERE user_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      chargeId,
    ])
  ).rows[0];
  if (
    !charge ||
    charge.card_id !== found.card_id ||
    !card ||
    !anchor ||
    anchor.kind !== "credit_card" ||
    card.currency !== "GBP"
  )
    fail(409, "Card statement identity is inconsistent");
  const bridge = (
    await c.query(
      "SELECT 1 FROM money_workspace_cards WHERE user_id=$1 AND card_id=$2 AND workspace_account_id=$2",
      [owner, card.id]
    )
  ).rowCount;
  if (!bridge) fail(409, "Card statement identity is missing");
  if (
    input.version !== charge.version ||
    input.card_version !== card.version ||
    anchor.version !== card.version
  )
    fail(409, "Record changed. Reload before saving");
  let tx: any;
  if (charge.linked_transaction_id) {
    tx = (
      await c.query("SELECT * FROM money_transactions WHERE user_id=$1 AND id=$2 FOR UPDATE", [
        owner,
        charge.linked_transaction_id,
      ])
    ).rows[0];
    if (
      !tx ||
      tx.linked_charge_id !== charge.id ||
      tx.type !== "expense" ||
      tx.currency !== "GBP" ||
      tx.account_id !== null ||
      tx.from_account_id !== null ||
      tx.to_account_id !== null
    )
      fail(409, "Linked expense is inconsistent");
    if (input.transaction_version !== tx.version)
      fail(409, "Linked expense changed. Reload before saving");
  } else if ("transaction_version" in input || "tx_overrides" in input)
    fail(400, "Charge has no linked expense");
  const reverse = (
    await c.query("SELECT id FROM money_transactions WHERE linked_charge_id=$1", [charge.id])
  ).rows;
  if (reverse.length !== (tx ? 1 : 0) || (tx && reverse[0]?.id !== tx.id))
    fail(409, "Linked expense is inconsistent");
  const fields: Record<string, any> = {
    amount: input.amount === undefined ? charge.amount : decimal(input.amount),
    date: input.date === undefined ? charge.date : day(input.date),
    merchant: input.merchant === undefined ? charge.merchant : text(input.merchant, 200),
    category: input.category === undefined ? charge.category : text(input.category, 100),
    notes: input.notes === undefined ? charge.notes : text(input.notes, 2000),
  };
  const overrides = input.tx_overrides;
  const txFields = { ...fields };
  if (overrides !== undefined) {
    if (
      !overrides ||
      typeof overrides !== "object" ||
      Array.isArray(overrides) ||
      Object.keys(overrides).some(
        (k) =>
          !["goal_id", "exclude_from_monthly", "personal_share_percent", "shared_with"].includes(k)
      )
    )
      fail(400, "Invalid linked expense fields");
    if ("exclude_from_monthly" in overrides) {
      if (typeof overrides.exclude_from_monthly !== "boolean")
        fail(400, "Invalid reporting setting");
      txFields.exclude_from_monthly = overrides.exclude_from_monthly;
    }
    if ("personal_share_percent" in overrides)
      txFields.personal_share_percent = decimal(overrides.personal_share_percent, true);
    if ("shared_with" in overrides) txFields.shared_with = text(overrides.shared_with, 100);
    if ("goal_id" in overrides) {
      txFields.goal_id = overrides.goal_id === null ? null : uuid(overrides.goal_id);
      if (
        txFields.goal_id &&
        !(
          await c.query("SELECT id FROM money_goals WHERE user_id=$1 AND id=$2 FOR KEY SHARE", [
            owner,
            txFields.goal_id,
          ])
        ).rowCount
      )
        fail(400, "Choose an existing goal");
    }
  }
  if (tx)
    await protectRefundedPurchase(c, owner, tx.id, {
      amount: fields.amount,
      date: fields.date,
      type: "expense",
    });
  const financialChanged = (
    await c.query("SELECT $1::numeric <> $2::numeric OR $3::date <> $4::date AS changed", [
      fields.amount,
      charge.amount,
      fields.date,
      charge.date,
    ])
  ).rows[0].changed;
  fields.statement_disposition =
    financialChanged && charge.statement_disposition !== "excluded"
      ? "unresolved"
      : charge.statement_disposition;
  async function update(table: string, target: string, values: Record<string, any>) {
    const keys = Object.keys(values);
    return (
      await c.query(
        `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")},version=version+1 WHERE id=$1 AND user_id=$${keys.length + 2} RETURNING *`,
        [target, ...Object.values(values), owner]
      )
    ).rows[0];
  }
  const row = await update("money_credit_card_charges", charge.id, fields);
  if (tx) await update("money_transactions", tx.id, txFields);
  // Numeric SQL keeps the statement floor exact, even when unresolved rows remain.
  const balance = (
    await c.query(
      `SELECT (a.reported_minor + COALESCE((SELECT sum(amount*100) FROM money_credit_card_charges WHERE card_id=a.id AND statement_disposition='excluded'),0) - COALESCE((SELECT sum(amount_minor) FROM workspace_payments WHERE account_id=a.id AND status='posted' AND disposition='excluded'),0)) BETWEEN 0 AND 9999999999 AS valid FROM workspace_accounts a WHERE a.id=$1`,
      [card.id]
    )
  ).rows[0];
  if (!balance.valid) fail(400, "Edit exceeds the supported tracked card balance");
  await c.query("UPDATE money_credit_cards SET version=version+1 WHERE id=$1", [card.id]);
  await c.query("UPDATE workspace_accounts SET version=version+1 WHERE id=$1", [card.id]);
  return row;
}
