import { refundId, validateMainRefund, bumpRefundTargets } from "./main-refunds";
import type { PoolClient } from "pg";
import { HttpError } from "./http";
export const paymentEditFields = [
  "card_version",
  "bank_versions",
  "amount",
  "date",
  "account_id",
  "notes",
  "refund_of_transaction_id",
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

/** Runs inside the main owner, manual-input and receipt transaction. */
export async function executePaymentEditCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
) {
  if (input.action !== "payment.update") return null;
  if (
    Object.keys(input).some((k) => !["action", "id", "version", ...paymentEditFields].includes(k))
  )
    fail(400, "Unknown payment field");
  const paymentId = uuid(input.id);
  const found = (
    await c.query("SELECT card_id FROM money_credit_card_payments WHERE user_id=$1 AND id=$2", [
      owner,
      paymentId,
    ])
  ).rows[0];
  if (!found) fail(404, "Record not found");
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
  const payment = (
    await c.query(
      "SELECT * FROM money_credit_card_payments WHERE user_id=$1 AND id=$2 FOR UPDATE",
      [owner, paymentId]
    )
  ).rows[0];
  if (
    !payment ||
    payment.card_id !== found.card_id ||
    !card ||
    !anchor ||
    anchor.kind !== "credit_card" ||
    card.currency !== "GBP"
  )
    fail(409, "Card statement identity is inconsistent");
  if (
    !(
      await c.query(
        "SELECT 1 FROM money_workspace_cards WHERE user_id=$1 AND card_id=$2 AND workspace_account_id=$2",
        [owner, card.id]
      )
    ).rowCount
  )
    fail(409, "Card statement identity is missing");
  if (
    input.version !== payment.version ||
    input.card_version !== card.version ||
    anchor.version !== card.version
  )
    fail(409, "Record changed. Reload before saving");
  if (!payment.workspace_payment_id) fail(409, "Linked statement payment is missing");
  const linked = (
    await c.query("SELECT * FROM workspace_payments WHERE owner_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      payment.workspace_payment_id,
    ])
  ).rows[0];
  if (
    !linked ||
    linked.account_id !== card.id ||
    BigInt(linked.amount_minor) !== BigInt(String(payment.amount).replace(".", "")) ||
    linked.paid_on !== payment.date
  )
    fail(409, "Linked statement payment is inconsistent");
  if (linked.status !== "posted") fail(409, "Review this payment in All Debts before editing");
  const amount = input.amount === undefined ? payment.amount : decimal(input.amount);
  const date = input.date === undefined ? payment.date : day(input.date);
  if (!("account_id" in input)) fail(400, "Choose a payment source explicitly");
  const account = input.account_id === null ? null : uuid(input.account_id).toLowerCase();
  const notes = input.notes === undefined ? payment.notes : text(input.notes, 2000);
  const bankIds = [
    ...new Set<string>([payment.account_id, account].filter((id): id is string => id !== null)),
  ].sort();
  if (!Array.isArray(input.bank_versions) || input.bank_versions.length > 2)
    fail(400, "Invalid bank versions");
  const versions = new Map<string, number>();
  for (const item of input.bank_versions) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some((k) => !["id", "version"].includes(k))
    )
      fail(400, "Invalid bank versions");
    const id = uuid(item.id).toLowerCase();
    if (!Number.isSafeInteger(item.version) || item.version <= 0 || versions.has(id))
      fail(400, "Invalid bank versions");
    versions.set(id, item.version);
  }
  if (versions.size !== bankIds.length || bankIds.some((id) => !versions.has(id)))
    fail(400, "Supply versions for the existing and selected banks");
  for (const id of bankIds) {
    const bank = (
      await c.query("SELECT * FROM money_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [
        owner,
        id,
      ])
    ).rows[0];
    if (
      !bank ||
      bank.currency !== "GBP" ||
      (id === account && id !== payment.account_id && bank.archived)
    )
      fail(400, "Choose an active GBP bank account");
    if (bank.version !== versions.get(id)) fail(409, "Bank changed. Reload before saving");
  }
  const target =
    input.refund_of_transaction_id === undefined
      ? payment.refund_of_transaction_id
      : refundId(input.refund_of_transaction_id);
  await validateMainRefund(c, owner, {
    id: payment.id,
    refund_of_transaction_id: target,
    amount,
    date,
    account_id: account,
    card_id: card.id,
  });
  const changed = (
    await c.query("SELECT $1::numeric <> $2::numeric OR $3::date <> $4::date AS changed", [
      amount,
      payment.amount,
      date,
      payment.date,
    ])
  ).rows[0].changed;
  const disposition =
    changed && linked.disposition !== "excluded" ? "unresolved" : linked.disposition;
  const row = (
    await c.query(
      "UPDATE money_credit_card_payments SET amount=$3,date=$4,account_id=$5,notes=$6,refund_of_transaction_id=$7,version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
      [owner, payment.id, amount, date, account, notes, target]
    )
  ).rows[0];
  await c.query(
    "UPDATE workspace_payments SET amount_minor=$3::numeric*100,paid_on=$4,disposition=$5 WHERE owner_id=$1 AND id=$2",
    [owner, linked.id, amount, date, disposition]
  );
  const balance = (
    await c.query(
      `SELECT (a.reported_minor + COALESCE((SELECT sum(amount*100) FROM money_credit_card_charges WHERE card_id=a.id AND statement_disposition='excluded'),0) - COALESCE((SELECT sum(amount_minor) FROM workspace_payments WHERE account_id=a.id AND status='posted' AND disposition='excluded'),0)) BETWEEN 0 AND 9999999999 AS valid, (a.reported_minor + COALESCE((SELECT sum(amount*100) FROM money_credit_card_charges WHERE card_id=a.id AND statement_disposition='excluded'),0) - COALESCE((SELECT sum(amount_minor) FROM workspace_payments WHERE account_id=a.id AND status='posted' AND disposition='excluded'),0)) < 0 AS negative FROM workspace_accounts a WHERE a.id=$1`,
      [card.id]
    )
  ).rows[0];
  if (!balance.valid) {
    if (balance.negative && (target || payment.refund_of_transaction_id)) {
      await c.query(
        "UPDATE workspace_accounts SET review_required=true WHERE owner_id=$1 AND id=$2",
        [owner, card.id]
      );
      row.review_required = true;
      row.tracked_balance = null;
    } else fail(400, "Edit exceeds the supported tracked card balance");
  }
  await bumpRefundTargets(c, owner, payment.refund_of_transaction_id, target);
  for (const id of bankIds)
    await c.query("UPDATE money_accounts SET version=version+1 WHERE user_id=$1 AND id=$2", [
      owner,
      id,
    ]);
  await c.query("UPDATE money_credit_cards SET version=version+1 WHERE id=$1", [card.id]);
  await c.query("UPDATE workspace_accounts SET version=version+1 WHERE id=$1", [card.id]);
  return row;
}
