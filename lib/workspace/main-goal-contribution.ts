import type { PoolClient } from "pg";
import { HttpError } from "./http";

export const goalContributionFields = [
  "source_account_id",
  "destination_account_id",
  "source_version",
  "destination_version",
  "amount",
  "date",
  "decrease_source_split",
  "increase_destination_split",
];
function bad(message: string): never {
  throw new HttpError(400, message);
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    bad("Invalid identifier");
  return value.toLowerCase();
}
function amount(value: unknown): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(value))
  )
    bad("Enter a positive GBP amount with at most two decimal places");
  const result = String(value);
  const [whole, fraction = ""] = result.split(".");
  if (BigInt(whole + fraction.padEnd(2, "0")) === BigInt(0)) bad("Enter a positive amount");
  return result;
}
function civilDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.slice(0, 4) === "0000" ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    bad("Invalid date");
  return value;
}
function version(observed: unknown, actual: unknown) {
  if (!Number.isSafeInteger(observed) || observed !== actual)
    throw new HttpError(409, "This item is out of date. Refresh before contributing.");
}
// Run only inside executeMainCommand's owner, manual-input and receipt transaction.
export async function executeGoalContributionCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  if (input.action !== "goal.contribute") return undefined;
  if (
    Object.keys(input).some(
      (k) => !["action", "id", "version", ...goalContributionFields].includes(k)
    )
  )
    bad("Unknown command field");
  if (
    typeof input.decrease_source_split !== "boolean" ||
    typeof input.increase_destination_split !== "boolean"
  )
    bad("Invalid allocation adjustment flag");
  const gid = uuid(input.id),
    source = uuid(input.source_account_id),
    destination = uuid(input.destination_account_id);
  if (source === destination) bad("Choose different accounts");
  const value = amount(input.amount),
    date = civilDate(input.date);
  const goal = (
    await c.query("SELECT * FROM money_goals WHERE user_id=$1 AND id=$2 FOR UPDATE", [owner, gid])
  ).rows[0];
  if (!goal) throw new HttpError(404, "Goal not found");
  version(input.version, goal.version);
  if (goal.completed_at !== null) bad("Choose an active goal");
  for (const aid of [source, destination].sort()) {
    const bank = (
      await c.query("SELECT * FROM money_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [
        owner,
        aid,
      ])
    ).rows[0];
    if (!bank || bank.archived || bank.currency !== "GBP") bad("Choose an available GBP account");
    version(aid === source ? input.source_version : input.destination_version, bank.version);
  }
  const links = (
    await c.query("SELECT * FROM money_goal_accounts WHERE user_id=$1 AND goal_id=$2 FOR UPDATE", [
      owner,
      gid,
    ])
  ).rows;
  const destinationLink = links.find((link) => link.account_id === destination);
  if (!destinationLink && (links.length !== 0 || goal.linked_account_id !== destination))
    bad("Destination must be linked to this goal");
  const sourceLink = links.find((link) => link.account_id === source);
  for (const [link, enabled, decrease] of [
    [sourceLink, input.decrease_source_split, true],
    [destinationLink, input.increase_destination_split, false],
  ] as const) {
    if (!enabled) continue;
    if (!link || link.allocated_amount === null)
      bad("Only an existing fixed allocation can be adjusted");
    const updated = await c.query(
      `UPDATE money_goal_accounts SET allocated_amount=allocated_amount ${decrease ? "-" : "+"} $4::numeric,version=version+1 WHERE user_id=$1 AND goal_id=$2 AND account_id=$3 AND allocated_amount ${decrease ? ">= $4::numeric" : "+ $4::numeric <= 99999999.99"} RETURNING id`,
      [owner, gid, link.account_id, value]
    );
    if (!updated.rowCount)
      bad(
        decrease
          ? "Contribution exceeds the source allocation"
          : "Destination allocation is too large"
      );
  }
  // Check both resulting balances and every explicit earmark, including other goals.
  for (const aid of [source, destination]) {
    const result = (
      await c.query(
        `SELECT cash >= 0 AND cash >= earmarks AS fits FROM (
      SELECT a.starting_balance
      + COALESCE((SELECT sum(CASE WHEN t.type IN ('income','correction') AND t.account_id=a.id THEN t.amount WHEN t.type='expense' AND t.account_id=a.id THEN -t.amount ELSE 0 END
        + CASE WHEN t.type='transfer' AND t.to_account_id=a.id THEN COALESCE(t.received_amount,t.amount) ELSE 0 END
        - CASE WHEN t.type='transfer' AND t.from_account_id=a.id THEN t.amount ELSE 0 END) FROM money_transactions t WHERE t.user_id=$1),0)
      - COALESCE((SELECT sum(p.amount) FROM money_credit_card_payments p WHERE p.user_id=$1 AND p.account_id=a.id),0)
      + CASE WHEN a.id=$3::uuid THEN -$4::numeric ELSE $4::numeric END AS cash,
      COALESCE((SELECT sum(g.allocated_amount) FROM money_goal_accounts g WHERE g.user_id=$1 AND g.account_id=a.id),0) AS earmarks
      FROM money_accounts a WHERE a.user_id=$1 AND a.id=$2
    ) balances`,
        [owner, aid, source, value]
      )
    ).rows[0];
    if (!result?.fits) bad("Contribution exceeds available account cash or goal allocations");
  }
  await c.query(
    "INSERT INTO money_transactions(user_id,type,currency,amount,date,from_account_id,to_account_id,category,notes) VALUES($1,'transfer','GBP',$2,$3,$4,$5,'Goal Contribution',$6)",
    [owner, value, date, source, destination, `Goal contribution: ${goal.name}`]
  );
  await c.query("UPDATE money_accounts SET version=version+1 WHERE user_id=$1 AND id IN ($2,$3)", [
    owner,
    source,
    destination,
  ]);
  return (
    await c.query(
      "UPDATE money_goals SET version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
      [owner, gid]
    )
  ).rows[0];
}
