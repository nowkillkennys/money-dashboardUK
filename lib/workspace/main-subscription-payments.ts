import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { advanceSubscriptionBilling, subscriptionCivilDate } from "../money/subscription-billing";
import { parseMoneyMinor, formatMoneyDecimal } from "../debt/money";
import { HttpError } from "./http";

export const subscriptionPaymentFields = [
  "payment_account_id",
  "payment_account_version",
  "date",
  "expected_next_billing",
];
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new HttpError(400, "Invalid identifier");
  return value;
}
function civil(value: unknown): string {
  try {
    return subscriptionCivilDate(value);
  } catch {
    throw new HttpError(400, "Invalid date");
  }
}
function current(observed: unknown, version: number) {
  if (!Number.isSafeInteger(observed) || observed !== version || version < 1)
    throw new HttpError(409, "Record changed. Reload before paying");
}
/** Runs only within executeMainCommand's owner transaction, manual gate and receipt journal. */
export async function executeSubscriptionPaymentCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  if (input.action !== "subscription.pay") return undefined;
  if (
    Object.keys(input).some(
      (k) => !["action", "id", "version", ...subscriptionPaymentFields].includes(k)
    )
  )
    throw new HttpError(400, "Unknown payment command field");
  const subscriptionId = uuid(input.id);
  const paidOn = civil(input.date);
  const observedDue = civil(input.expected_next_billing);
  if (typeof input.payment_account_id !== "string")
    throw new HttpError(400, "Choose a payment account");
  const card = input.payment_account_id.startsWith("cc:");
  const accountId = uuid(card ? input.payment_account_id.slice(3) : input.payment_account_id);
  const schedule = (
    await c.query("SELECT * FROM money_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE", [
      subscriptionId,
      owner,
    ])
  ).rows[0];
  if (!schedule) throw new HttpError(404, "Subscription not found");
  current(input.version, schedule.version);
  if (schedule.next_billing !== observedDue)
    throw new HttpError(409, "Billing date changed. Reload before paying");
  if (!schedule.is_active || schedule.currency !== "GBP")
    throw new HttpError(400, "Choose an active GBP subscription");
  let amount: string;
  let nextBilling: string;
  try {
    const minor = parseMoneyMinor(String(schedule.amount));
    if (minor <= 0) throw new Error();
    amount = formatMoneyDecimal(minor);
    nextBilling = advanceSubscriptionBilling(observedDue, schedule.frequency);
  } catch {
    throw new HttpError(400, "Invalid subscription amount or billing cycle");
  }
  if (card) {
    // Statement operations consistently lock the workspace identity before its main card.
    const anchor = (
      await c.query("SELECT * FROM workspace_accounts WHERE id=$1 AND owner_id=$2 FOR UPDATE", [
        accountId,
        owner,
      ])
    ).rows[0];
    if (!anchor || anchor.kind !== "credit_card")
      throw new HttpError(404, "Active GBP card statement not found");
    current(input.payment_account_version, anchor.version);
  }
  const account = (
    await c.query(
      `SELECT * FROM ${card ? "money_credit_cards" : "money_accounts"} WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [accountId, owner]
    )
  ).rows[0];
  if (!account || account.archived || account.currency !== "GBP")
    throw new HttpError(404, "Active GBP payment account not found");
  current(input.payment_account_version, account.version);
  if (
    card &&
    !(
      await c.query(
        "SELECT card_id FROM money_workspace_cards WHERE user_id=$1 AND card_id=$2 AND workspace_account_id=$2",
        [owner, accountId]
      )
    ).rowCount
  )
    throw new HttpError(409, "Card statement link changed. Reload before paying");
  const transactionId = randomUUID();
  const chargeId = card ? randomUUID() : null;
  const notes = `Subscription billing cycle ${observedDue}${schedule.notes ? ": " + schedule.notes : ""}`;
  if (card)
    await c.query(
      "INSERT INTO money_credit_card_charges(id,user_id,card_id,amount,date,merchant,category,notes,statement_disposition) VALUES($1,$2,$3,$4,$5,$6,'Bills',$7,'excluded')",
      [chargeId, owner, accountId, amount, paidOn, schedule.name, notes]
    );
  await c.query(
    "INSERT INTO money_transactions(id,user_id,type,amount,date,currency,account_id,merchant,category,notes,is_recurring,recurrence,linked_charge_id) VALUES($1,$2,'expense',$3,$4,'GBP',$5,$6,'Bills',$7,true,$8,$9)",
    [
      transactionId,
      owner,
      amount,
      paidOn,
      card ? null : accountId,
      schedule.name,
      notes,
      schedule.frequency,
      chargeId,
    ]
  );
  if (card) {
    await c.query(
      "UPDATE money_credit_card_charges SET linked_transaction_id=$1 WHERE id=$2 AND user_id=$3",
      [transactionId, chargeId, owner]
    );
    await c.query("UPDATE workspace_accounts SET version=version+1 WHERE id=$1 AND owner_id=$2", [
      accountId,
      owner,
    ]);
  }
  await c.query(
    `UPDATE ${card ? "money_credit_cards" : "money_accounts"} SET version=version+1 WHERE id=$1 AND user_id=$2`,
    [accountId, owner]
  );
  const row = (
    await c.query(
      "UPDATE money_subscriptions SET next_billing=$3,version=version+1 WHERE id=$1 AND user_id=$2 RETURNING *",
      [subscriptionId, owner, nextBilling]
    )
  ).rows[0];
  return { id: row.id, version: row.version, row };
}
