import type { PoolClient } from "pg";
import { withUserDb } from "./db";
import { HttpError } from "./http";

export const reconciliationFields = [
  "account_id",
  "account_version",
  "date_from",
  "date_to",
  "expected_balance",
  "action_type",
  "tx_ids",
  "transaction_versions",
  "keep_id",
  "delete_id",
];
function uuid(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    throw new HttpError(400, "Invalid identifier");
  return v.toLowerCase();
}
function civil(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v.startsWith("0000") ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new HttpError(400, "Invalid date");
  return v;
}
function current(v: unknown, actual: number) {
  if (!Number.isSafeInteger(v) || v !== actual)
    throw new HttpError(409, "Record changed. Run reconciliation again before applying an action.");
}
// Ordinary bank entries only. Refund and card relationships are protected even for forged IDs.
const eligible = `t.type IN ('income','expense') AND t.amount>0 AND t.currency='GBP' AND t.from_account_id IS NULL AND t.to_account_id IS NULL AND t.linked_charge_id IS NULL AND NOT t.preserved_card_payment AND t.refund_of_transaction_id IS NULL AND NOT EXISTS(SELECT 1 FROM money_transactions r WHERE r.user_id=t.user_id AND r.refund_of_transaction_id=t.id) AND NOT EXISTS(SELECT 1 FROM money_credit_card_payments p WHERE p.user_id=t.user_id AND p.refund_of_transaction_id=t.id)`;
async function balance(
  c: PoolClient,
  owner: string,
  account: string,
  until: string
): Promise<string> {
  return (
    await c.query(
      `SELECT (a.starting_balance + COALESCE((SELECT sum(CASE WHEN t.type='transfer' THEN CASE WHEN t.to_account_id=a.id THEN COALESCE(t.received_amount,t.amount) ELSE 0 END - CASE WHEN t.from_account_id=a.id THEN t.amount ELSE 0 END WHEN t.account_id=a.id AND t.type IN ('income','correction') THEN t.amount WHEN t.account_id=a.id AND t.type='expense' THEN -t.amount ELSE 0 END) FROM money_transactions t WHERE t.user_id=$1 AND t.date<=$3),0) - COALESCE((SELECT sum(p.amount) FROM money_credit_card_payments p WHERE p.user_id=$1 AND p.account_id=a.id AND p.date<=$3),0))::text AS balance FROM money_accounts a WHERE a.user_id=$1 AND a.id=$2`,
      [owner, account, until]
    )
  ).rows[0].balance;
}
async function pairs(c: PoolClient, owner: string, session: any) {
  return (
    await c.query(
      `WITH scoped AS (SELECT t.* FROM money_transactions t WHERE t.user_id=$1 AND t.account_id=$2 AND t.date BETWEEN $3 AND $4 AND ${eligible}) SELECT a.id tx_a_id,b.id tx_b_id,a.version version_a,b.version version_b,a.amount,a.date date_a,b.date date_b,a.merchant merchant_a,b.merchant merchant_b,(50+CASE WHEN a.date=b.date THEN 30 ELSE 10 END+CASE WHEN lower(trim(coalesce(a.merchant,'')))=lower(trim(coalesce(b.merchant,''))) AND trim(coalesce(a.merchant,''))<>'' THEN 20 ELSE 0 END)::integer score FROM scoped a JOIN scoped b ON a.id<b.id AND a.type=b.type AND a.amount=b.amount AND abs(a.date-b.date)<=1 WHERE NOT EXISTS(SELECT 1 FROM money_reconciliation_actions x WHERE x.owner_id=$1 AND x.session_id=$5 AND x.action_type='keep_both' AND x.payload_json->'tx_ids' @> jsonb_build_array(a.id::text,b.id::text)) ORDER BY score DESC,a.date DESC,a.id,b.id LIMIT 100`,
      [owner, session.account_id, session.date_from, session.date_to, session.id]
    )
  ).rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}
async function view(c: PoolClient, owner: string, session: any, accountVersion: number) {
  const computed = await balance(c, owner, session.account_id, session.date_to);
  const delta =
    session.expected_balance === null
      ? null
      : (
          await c.query("SELECT ($1::numeric-$2::numeric)::text delta", [
            computed,
            session.expected_balance,
          ])
        ).rows[0].delta;
  return {
    session,
    account_version: accountVersion,
    computed_balance: Number(computed),
    delta: delta === null ? null : Number(delta),
    duplicates: await pairs(c, owner, session),
  };
}
export async function reconciliationPreview(owner: string, sessionId: string) {
  uuid(sessionId);
  return withUserDb(
    owner,
    async (c) => {
      const session = (
        await c.query("SELECT * FROM money_reconciliation_sessions WHERE owner_id=$1 AND id=$2", [
          owner,
          sessionId,
        ])
      ).rows[0];
      if (!session) throw new HttpError(404, "Reconciliation not found");
      const account = (
        await c.query("SELECT version FROM money_accounts WHERE user_id=$1 AND id=$2", [
          owner,
          session.account_id,
        ])
      ).rows[0];
      if (!account) throw new HttpError(404, "Account not found");
      return view(c, owner, session, account.version);
    },
    true
  );
}
/** Called only inside the main command's manual gate, owner transaction and receipt journal. */
export async function executeReconciliationCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  if (!["reconciliation.start", "reconciliation.action"].includes(input.action)) return undefined;
  const start = input.action === "reconciliation.start";
  const allowed = start
    ? ["action", "account_id", "account_version", "date_from", "date_to", "expected_balance"]
    : [
        "action",
        "id",
        "version",
        "account_version",
        "action_type",
        "tx_ids",
        "transaction_versions",
        "keep_id",
        "delete_id",
      ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new HttpError(400, "Unknown reconciliation field");
  let session: any;
  if (!start) {
    session = (
      await c.query(
        "SELECT * FROM money_reconciliation_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE",
        [owner, uuid(input.id)]
      )
    ).rows[0];
    if (!session) throw new HttpError(404, "Reconciliation not found");
    current(input.version, session.version);
    if (session.status !== "open") throw new HttpError(409, "Reconciliation is closed");
  }
  const accountId = start ? uuid(input.account_id) : session.account_id;
  const account = (
    await c.query("SELECT * FROM money_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      accountId,
    ])
  ).rows[0];
  if (!account || account.archived || account.currency !== "GBP")
    throw new HttpError(404, "Active GBP account not found");
  current(input.account_version, account.version);
  if (start) {
    const from = civil(input.date_from),
      to = civil(input.date_to);
    if (from > to) throw new HttpError(400, "From date must precede To date");
    const expected = input.expected_balance ?? null;
    if (
      expected !== null &&
      (typeof expected !== "string" || !/^-?(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(expected))
    )
      throw new HttpError(400, "Enter an exact GBP balance with at most two decimal places");
    const computed = await balance(c, owner, accountId, to);
    session = (
      await c.query(
        "INSERT INTO money_reconciliation_sessions(owner_id,account_id,date_from,date_to,expected_balance,computed_balance,delta) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $5::numeric IS NULL THEN NULL ELSE $6::numeric-$5::numeric END) RETURNING *",
        [owner, accountId, from, to, expected, computed]
      )
    ).rows[0];
  } else {
    if (!["merge", "delete", "keep_both"].includes(input.action_type))
      throw new HttpError(400, "Invalid action");
    if (input.action_type !== "merge" && input.keep_id !== undefined)
      throw new HttpError(400, "Only merge accepts a retained entry");
    if (input.action_type !== "delete" && input.delete_id !== undefined)
      throw new HttpError(400, "Only delete accepts a deleted entry");
    if (!Array.isArray(input.tx_ids) || input.tx_ids.length !== 2)
      throw new HttpError(400, "Choose the duplicate entries");
    const ids = input.tx_ids.map(uuid).sort();
    if (
      new Set(ids).size !== ids.length ||
      !input.transaction_versions ||
      typeof input.transaction_versions !== "object" ||
      Array.isArray(input.transaction_versions)
    )
      throw new HttpError(400, "Transaction versions required");
    const versions = Object.fromEntries(
      Object.entries(input.transaction_versions).map(([key, value]) => [uuid(key), value])
    );
    if (
      Object.keys(input.transaction_versions).length !== 2 ||
      Object.keys(versions).sort().join() !== ids.join()
    )
      throw new HttpError(400, "Transaction versions required");
    const rows = (
      await c.query(
        `SELECT t.* FROM money_transactions t WHERE t.user_id=$1 AND t.id=ANY($2::uuid[]) AND t.account_id=$3 AND t.date BETWEEN $4 AND $5 AND ${eligible} ORDER BY t.id FOR UPDATE`,
        [owner, ids, accountId, session.date_from, session.date_to]
      )
    ).rows;
    if (rows.length !== ids.length)
      throw new HttpError(409, "Entries changed or are protected. Run reconciliation again.");
    for (const row of rows) current(versions[row.id], row.version);
    const candidates = await pairs(c, owner, session);
    if (!candidates.some((p) => p.tx_a_id === ids[0] && p.tx_b_id === ids[1]))
      throw new HttpError(409, "Duplicate candidate changed. Run reconciliation again.");
    const keepId = input.action_type === "merge" ? uuid(input.keep_id) : null;
    const deleteId = input.action_type === "delete" ? uuid(input.delete_id) : null;
    if (input.action_type === "delete" && (deleteId === null || !ids.includes(deleteId)))
      throw new HttpError(400, "Choose an entry to delete");
    if (input.action_type === "merge" && (keepId === null || !ids.includes(keepId)))
      throw new HttpError(400, "Choose an entry to retain");
    const deleted =
      input.action_type === "keep_both"
        ? []
        : ids.filter((id: string) =>
            input.action_type === "delete" ? id === deleteId : id !== keepId
          );
    await c.query(
      "INSERT INTO money_reconciliation_actions(owner_id,session_id,action_type,payload_json) VALUES($1,$2,$3,$4)",
      [
        owner,
        session.id,
        input.action_type,
        JSON.stringify({
          tx_ids: ids,
          keep_id: keepId,
          delete_id: deleteId,
          deleted_ids: deleted,
          transactions: rows,
        }),
      ]
    );
    if (deleted.length)
      await c.query("DELETE FROM money_transactions WHERE user_id=$1 AND id=ANY($2::uuid[])", [
        owner,
        deleted,
      ]);
    const computed = await balance(c, owner, accountId, session.date_to);
    session = (
      await c.query(
        "UPDATE money_reconciliation_sessions SET computed_balance=$3,delta=CASE WHEN expected_balance IS NULL THEN NULL ELSE $3::numeric-expected_balance END,version=version+1 WHERE owner_id=$1 AND id=$2 RETURNING *",
        [owner, session.id, computed]
      )
    ).rows[0];
    account.version = (
      await c.query(
        "UPDATE money_accounts SET version=version+1 WHERE user_id=$1 AND id=$2 RETURNING version",
        [owner, accountId]
      )
    ).rows[0].version;
  }
  return {
    id: session.id,
    version: session.version,
    row: await view(c, owner, session, account.version),
  };
}
