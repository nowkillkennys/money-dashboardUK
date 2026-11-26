import type { PoolClient } from "pg";
import { HttpError } from "./http";
const fail = (message: string): never => {
  throw new HttpError(400, message);
};
export function refundId(value: unknown): string | null {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    fail("Invalid refund purchase");
  return (value as string).toLowerCase();
}
export async function refundSummary(c: PoolClient, owner: string, target: string) {
  return (
    await c.query(
      `SELECT COALESCE(sum(amount),0) AS amount,min(date) AS first_date FROM (SELECT amount,date FROM money_transactions WHERE user_id=$1 AND refund_of_transaction_id=$2 UNION ALL SELECT amount,date FROM money_credit_card_payments WHERE user_id=$1 AND refund_of_transaction_id=$2) r`,
      [owner, target]
    )
  ).rows[0];
}
export async function protectRefundedPurchase(
  c: PoolClient,
  owner: string,
  target: string,
  fields?: { amount: unknown; date: unknown; type?: string }
) {
  const refunds = await refundSummary(c, owner, target);
  if (Number(refunds.amount) <= 0) return;
  if (!fields) fail("Remove linked refunds before deleting this purchase.");
  const valid = (
    await c.query("SELECT $1::numeric >= $2::numeric AND $3::date <= $4::date AS valid", [
      fields!.amount,
      refunds.amount,
      fields!.date,
      refunds.first_date,
    ])
  ).rows[0].valid;
  if (!valid || (fields!.type !== undefined && fields!.type !== "expense"))
    fail("Purchase amount and date must cover its linked refunds.");
}
export async function validateMainRefund(
  c: PoolClient,
  owner: string,
  refund: {
    id?: string;
    refund_of_transaction_id: string | null;
    amount: unknown;
    date: unknown;
    account_id?: string | null;
    card_id?: string;
    type?: string;
  }
) {
  const target = refund.refund_of_transaction_id;
  if (!target) return;
  const original = (
    await c.query("SELECT * FROM money_transactions WHERE user_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      target,
    ])
  ).rows[0];
  if (
    !original ||
    original.type !== "expense" ||
    original.currency !== "GBP" ||
    original.refund_of_transaction_id
  )
    fail("Select an original GBP expense belonging to this workspace.");
  if (refund.card_id) {
    if (
      refund.account_id ||
      !(
        await c.query(
          "SELECT 1 FROM money_credit_card_charges WHERE user_id=$1 AND card_id=$2 AND (id=$3 OR linked_transaction_id=$4)",
          [owner, refund.card_id, original.linked_charge_id, target]
        )
      ).rowCount
    )
      fail("Choose a purchase on this card and use Credit / Refund.");
  } else if (
    refund.type !== "income" ||
    !refund.account_id ||
    !(
      await c.query("SELECT 1 FROM money_accounts WHERE user_id=$1 AND id=$2 AND currency='GBP'", [
        owner,
        refund.account_id,
      ])
    ).rowCount
  )
    fail("Bank refunds require a GBP income deposit account.");
  const valid = (
    await c.query(
      `SELECT $3::numeric > 0 AND $4::date >= o.date AND $3::numeric + COALESCE((SELECT sum(amount) FROM (SELECT amount FROM money_transactions WHERE user_id=$1 AND refund_of_transaction_id=o.id AND ($6::boolean OR id IS DISTINCT FROM $5::uuid) UNION ALL SELECT amount FROM money_credit_card_payments WHERE user_id=$1 AND refund_of_transaction_id=o.id AND (NOT $6::boolean OR id IS DISTINCT FROM $5::uuid)) r),0) <= o.amount AS valid FROM money_transactions o WHERE user_id=$1 AND id=$2`,
      [owner, target, refund.amount, refund.date, refund.id ?? null, Boolean(refund.card_id)]
    )
  ).rows[0]?.valid;
  if (!valid)
    fail(
      "Refund must be positive, dated on or after the purchase, and within its remaining amount."
    );
}
export async function bumpRefundTargets(
  c: PoolClient,
  owner: string,
  ...targets: (string | null | undefined)[]
) {
  const ids = [...new Set(targets.filter((id): id is string => Boolean(id)))];
  if (ids.length)
    await c.query(
      "UPDATE money_transactions SET version=version+1 WHERE user_id=$1 AND id=ANY($2::uuid[])",
      [owner, ids]
    );
}
