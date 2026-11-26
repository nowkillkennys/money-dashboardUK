import type { PoolClient } from "pg";
import { HttpError } from "./http";

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    fail(400, "Invalid identifier");
  return value.toLowerCase();
}
/** Runs inside the owner/manual-input/receipt transaction; never opens a second writer. */
export async function executeHistoryDeletionCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
) {
  if (input.action !== "charge.delete" && input.action !== "payment.delete") return null;
  const chargeMode = input.action === "charge.delete";
  const allowed = [
    "action",
    "id",
    "version",
    "card_version",
    ...(chargeMode ? ["transaction_version"] : ["bank_versions"]),
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail(400, "Unknown deletion field");
  const id = uuid(input.id);
  const table = chargeMode ? "money_credit_card_charges" : "money_credit_card_payments";
  const found = (
    await c.query(`SELECT card_id FROM ${table} WHERE user_id=$1 AND id=$2`, [owner, id])
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
  const record = (
    await c.query(`SELECT * FROM ${table} WHERE user_id=$1 AND id=$2 FOR UPDATE`, [owner, id])
  ).rows[0];
  if (
    !record ||
    !anchor ||
    !card ||
    record.card_id !== card.id ||
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
    input.version !== record.version ||
    input.card_version !== card.version ||
    anchor.version !== card.version
  )
    fail(409, "Record changed. Reload before deleting");
  let needsReview = Boolean(anchor.review_required);
  if (chargeMode) {
    let linked: any;
    if (record.linked_transaction_id) {
      linked = (
        await c.query("SELECT * FROM money_transactions WHERE user_id=$1 AND id=$2 FOR UPDATE", [
          owner,
          record.linked_transaction_id,
        ])
      ).rows[0];
      if (
        !linked ||
        linked.linked_charge_id !== id ||
        linked.type !== "expense" ||
        linked.currency !== "GBP" ||
        linked.account_id !== null ||
        linked.from_account_id !== null ||
        linked.to_account_id !== null
      )
        fail(409, "Linked expense is inconsistent");
      if (input.transaction_version !== linked.version)
        fail(409, "Linked expense changed. Reload before deleting");
    } else if ("transaction_version" in input) fail(400, "Charge has no linked expense");
    const reverse = (
      await c.query("SELECT id FROM money_transactions WHERE user_id=$1 AND linked_charge_id=$2", [
        owner,
        id,
      ])
    ).rows;
    if (reverse.length !== (linked ? 1 : 0) || (linked && reverse[0]?.id !== linked.id))
      fail(409, "Linked expense is inconsistent");
    needsReview ||= record.statement_disposition !== "excluded";
    if (linked) {
      await c.query(
        "UPDATE money_credit_card_charges SET linked_transaction_id=NULL WHERE user_id=$1 AND id=$2",
        [owner, id]
      );
      await c.query(
        "UPDATE money_transactions SET linked_charge_id=NULL WHERE user_id=$1 AND id=$2",
        [owner, linked.id]
      );
      await c.query("DELETE FROM money_transactions WHERE user_id=$1 AND id=$2", [
        owner,
        linked.id,
      ]);
    }
    await c.query("DELETE FROM money_credit_card_charges WHERE user_id=$1 AND id=$2", [owner, id]);
  } else {
    if (!record.workspace_payment_id) fail(409, "Linked statement payment is missing");
    const linked = (
      await c.query("SELECT * FROM workspace_payments WHERE owner_id=$1 AND id=$2 FOR UPDATE", [
        owner,
        record.workspace_payment_id,
      ])
    ).rows[0];
    if (
      !linked ||
      linked.account_id !== card.id ||
      BigInt(linked.amount_minor) !== BigInt(String(record.amount).replace(".", "")) ||
      linked.paid_on !== record.date
    )
      fail(409, "Linked statement payment is inconsistent");
    const bankId = record.account_id;
    if (!Array.isArray(input.bank_versions) || input.bank_versions.length !== (bankId ? 1 : 0))
      fail(400, "Supply the original bank version");
    if (bankId) {
      const observed = input.bank_versions[0];
      if (
        !observed ||
        typeof observed !== "object" ||
        Array.isArray(observed) ||
        Object.keys(observed).some((key) => !["id", "version"].includes(key)) ||
        uuid(observed.id) !== bankId ||
        !Number.isSafeInteger(observed.version) ||
        observed.version < 1
      )
        fail(400, "Invalid bank version");
      const bank = (
        await c.query("SELECT * FROM money_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [
          owner,
          bankId,
        ])
      ).rows[0];
      if (!bank || bank.currency !== "GBP") fail(409, "Original GBP bank account is missing");
      if (observed.version !== bank.version) fail(409, "Bank changed. Reload before deleting");
      await c.query("UPDATE money_accounts SET version=version+1 WHERE user_id=$1 AND id=$2", [
        owner,
        bankId,
      ]);
    }
    needsReview ||= linked.disposition !== "excluded" || linked.status !== "posted";
    await c.query("UPDATE workspace_payments SET status='voided' WHERE owner_id=$1 AND id=$2", [
      owner,
      linked.id,
    ]);
    await c.query("DELETE FROM money_credit_card_payments WHERE user_id=$1 AND id=$2", [owner, id]);
  }
  const balance = (
    await c.query(
      `SELECT (a.reported_minor + COALESCE((SELECT sum(amount*100) FROM money_credit_card_charges WHERE user_id=$1 AND card_id=a.id AND statement_disposition='excluded'),0) - COALESCE((SELECT sum(amount_minor) FROM workspace_payments WHERE owner_id=$1 AND account_id=a.id AND status='posted' AND disposition='excluded'),0)) BETWEEN 0 AND 9999999999 AS valid FROM workspace_accounts a WHERE owner_id=$1 AND id=$2`,
      [owner, card.id]
    )
  ).rows[0];
  needsReview ||= !balance?.valid;
  await c.query(
    "UPDATE workspace_accounts SET review_required=$3,version=version+1 WHERE owner_id=$1 AND id=$2",
    [owner, card.id, needsReview]
  );
  await c.query("UPDATE money_credit_cards SET version=version+1 WHERE user_id=$1 AND id=$2", [
    owner,
    card.id,
  ]);
  return { ...record, version: record.version + 1, review_required: needsReview };
}
