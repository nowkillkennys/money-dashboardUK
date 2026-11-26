import type { PoolClient } from "pg";
import { HttpError } from "./http";
export const goalFields: Record<string, string[]> = {
  goal: [
    "name",
    "target_amount",
    "target_date",
    "linked_account_id",
    "completed_at",
    "linked_accounts",
    "account_id",
    "amount",
  ],
  allocation: ["name", "is_active", "allocations"],
};
function bad(message: string): never {
  throw new HttpError(400, message);
}
function uuid(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    bad("Invalid identifier");
  return v;
}
function money(v: unknown): string {
  if (
    (typeof v !== "number" && typeof v !== "string") ||
    !/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(String(v))
  )
    bad("Enter a non-negative GBP amount with at most two decimal places");
  return String(v);
}
function name(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 80) bad("Enter a name");
  return v.trim();
}
function day(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    bad("Invalid date");
  return v;
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
async function account(c: PoolClient, owner: string, id: unknown) {
  const row = (
    await c.query("SELECT * FROM money_accounts WHERE user_id=$1 AND id=$2 FOR UPDATE", [
      owner,
      uuid(id),
    ])
  ).rows[0];
  if (!row || row.archived || row.currency !== "GBP") bad("Choose an available GBP account");
  return row;
}
type Link = { account_id: string; allocated_amount: string | null };
function links(v: unknown): Link[] {
  if (!Array.isArray(v) || v.length > 100) bad("Invalid goal accounts");
  const result = v.map((item): Link => {
    if (typeof item === "string") return { account_id: uuid(item), allocated_amount: null };
    if (
      !object(item) ||
      Object.keys(item).some((k) => !["account_id", "allocated_amount"].includes(k))
    )
      bad("Invalid goal account field");
    return {
      account_id: uuid(item.account_id),
      allocated_amount: item.allocated_amount == null ? null : money(item.allocated_amount),
    };
  });
  if (new Set(result.map((l) => l.account_id)).size !== result.length)
    bad("Duplicate goal account");
  return result;
}
async function capacity(c: PoolClient, owner: string, goal: string, items: Link[]) {
  for (const item of [...items].sort((a, b) => a.account_id.localeCompare(b.account_id))) {
    await account(c, owner, item.account_id);
    // Null links split only the remainder in computeGoalProgress; they do not reserve cash twice.
    const r = (
      await c.query(
        `SELECT (a.starting_balance
      + COALESCE((SELECT sum(CASE WHEN t.type IN ('income','correction') AND t.account_id=a.id THEN t.amount WHEN t.type='expense' AND t.account_id=a.id THEN -t.amount ELSE 0 END
        + CASE WHEN t.type='transfer' AND t.to_account_id=a.id THEN COALESCE(t.received_amount,t.amount) ELSE 0 END
        - CASE WHEN t.type='transfer' AND t.from_account_id=a.id THEN t.amount ELSE 0 END) FROM money_transactions t WHERE t.user_id=$1),0)
      - COALESCE((SELECT sum(p.amount) FROM money_credit_card_payments p WHERE p.user_id=$1 AND p.account_id=a.id),0)) >=
      COALESCE((SELECT sum(g.allocated_amount) FROM money_goal_accounts g WHERE g.user_id=$1 AND g.account_id=a.id AND g.goal_id<>$3),0)+$4::numeric AS fits
      FROM money_accounts a WHERE a.user_id=$1 AND a.id=$2`,
        [owner, item.account_id, goal, item.allocated_amount ?? "0"]
      )
    ).rows[0];
    if (!r?.fits)
      bad("Goal allocation exceeds available account cash; refresh and reduce earmarks");
  }
}
async function plan(c: PoolClient, owner: string, v: unknown) {
  if (!object(v) || Object.keys(v).length > 101) bad("Invalid plan allocations");
  const output: Record<string, unknown> = {},
    resolved = new Map<string, string>();
  for (const [key, value] of Object.entries(v)) {
    if (key === "__goals__") continue;
    let aid = key;
    if (!/^[0-9a-f-]{36}$/i.test(key)) {
      const found = (
        await c.query(
          "SELECT id FROM money_accounts WHERE user_id=$1 AND name=$2 AND NOT archived",
          [owner, key]
        )
      ).rows;
      if (found.length !== 1) bad("Plan account reference is stale or ambiguous; edit this plan");
      aid = found[0].id;
    }
    await account(c, owner, aid);
    if (Object.prototype.hasOwnProperty.call(output, aid)) bad("Duplicate plan account");
    output[aid] = Number(money(value));
    resolved.set(key, aid);
  }
  if (v.__goals__ !== undefined) {
    if (!object(v.__goals__)) bad("Invalid plan goal links");
    const goals: Record<string, string> = {};
    for (const [key, value] of Object.entries(v.__goals__)) {
      const aid = resolved.get(key);
      if (!aid) bad("Plan goal must reference an allocated account");
      const gid = uuid(value);
      if (
        !(await c.query("SELECT id FROM money_goals WHERE user_id=$1 AND id=$2", [owner, gid]))
          .rowCount
      )
        bad("Plan goal reference is stale; edit this plan");
      goals[aid] = gid;
    }
    output.__goals__ = goals;
  }
  return output;
}
export async function executeGoalCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  const [entity, action, ...extra] = String(input.action).split(".");
  if (!Object.prototype.hasOwnProperty.call(goalFields, entity)) return undefined;
  if (
    extra.length ||
    !["create", "update", "delete", ...(entity === "goal" ? ["increment"] : ["activate"])].includes(
      action
    )
  )
    bad("Unsupported goal command");
  const fields =
    action === "delete" || action === "activate"
      ? []
      : action === "increment"
        ? ["account_id", "amount"]
        : goalFields[entity].filter((k) => !["account_id", "amount"].includes(k));
  if (
    Object.keys(input).some((k) => !["action", "id", "version", "currency", ...fields].includes(k))
  )
    bad("Unknown command field");
  if (input.currency !== undefined && input.currency !== "GBP") bad("This workspace uses GBP");
  const table = entity === "goal" ? "money_goals" : "money_allocation_plans";
  let row: any;
  if (action !== "create") {
    row = (
      await c.query(`SELECT * FROM ${table} WHERE user_id=$1 AND id=$2 FOR UPDATE`, [
        owner,
        uuid(input.id),
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, "Item not found");
    if (!Number.isSafeInteger(input.version) || input.version !== row.version)
      throw new HttpError(409, "This item is out of date. Refresh before editing.");
  } else if (input.id !== undefined || input.version !== undefined)
    bad("Identifiers and versions are server-owned on create");
  if (action === "delete") {
    await c.query(`DELETE FROM ${table} WHERE user_id=$1 AND id=$2`, [owner, row.id]);
    return { ...row, version: row.version + 1 };
  }
  if (entity === "allocation") {
    const values = {
      name: input.name === undefined && row ? row.name : name(input.name),
      is_active: input.is_active === undefined ? (row?.is_active ?? false) : input.is_active,
      allocations: await plan(
        c,
        owner,
        input.allocations === undefined ? (row?.allocations ?? {}) : input.allocations
      ),
    };
    if (typeof values.is_active !== "boolean") bad("Invalid active flag");
    if (action === "activate") values.is_active = true;
    if (values.is_active && row)
      await c.query(
        "UPDATE money_allocation_plans SET is_active=false,version=version+1 WHERE user_id=$1 AND is_active AND id<>$2",
        [owner, row?.id ?? null]
      );
    if (values.is_active && !row)
      await c.query(
        "UPDATE money_allocation_plans SET is_active=false,version=version+1 WHERE user_id=$1 AND is_active",
        [owner]
      );
    if (!row)
      return (
        await c.query(
          "INSERT INTO money_allocation_plans(user_id,name,is_active,allocations) VALUES($1,$2,$3,$4) RETURNING *",
          [owner, values.name, values.is_active, JSON.stringify(values.allocations)]
        )
      ).rows[0];
    return (
      await c.query(
        "UPDATE money_allocation_plans SET name=$3,is_active=$4,allocations=$5,version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
        [owner, row.id, values.name, values.is_active, JSON.stringify(values.allocations)]
      )
    ).rows[0];
  }
  if (action === "increment") {
    const amount = money(input.amount);
    if (Number(amount) <= 0) bad("Enter a positive allocation");
    const aid = uuid(input.account_id);
    const existing = (
      await c.query(
        "SELECT * FROM money_goal_accounts WHERE user_id=$1 AND goal_id=$2 AND account_id=$3",
        [owner, row.id, aid]
      )
    ).rows[0];
    const sum = (
      await c.query("SELECT ($1::numeric+$2::numeric)::text AS amount", [
        existing?.allocated_amount ?? "0",
        amount,
      ])
    ).rows[0].amount;
    money(sum);
    await capacity(c, owner, row.id, [{ account_id: aid, allocated_amount: sum }]);
    await c.query(
      "INSERT INTO money_goal_accounts(user_id,goal_id,account_id,allocated_amount) VALUES($1,$2,$3,$4) ON CONFLICT(goal_id,account_id) DO UPDATE SET allocated_amount=EXCLUDED.allocated_amount,version=money_goal_accounts.version+1",
      [owner, row.id, aid, sum]
    );
    return (
      await c.query(
        "UPDATE money_goals SET version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
        [owner, row.id]
      )
    ).rows[0];
  }
  const values = {
    name: input.name === undefined && row ? row.name : name(input.name),
    target_amount:
      input.target_amount === undefined
        ? (row?.target_amount ?? null)
        : input.target_amount === null
          ? null
          : money(input.target_amount),
    target_date:
      input.target_date === undefined
        ? (row?.target_date ?? null)
        : input.target_date === null
          ? null
          : day(input.target_date),
    completed_at:
      input.completed_at === undefined
        ? row?.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : (row?.completed_at ?? null)
        : input.completed_at,
  };
  if (
    values.completed_at !== null &&
    (typeof values.completed_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(values.completed_at) ||
      !Number.isFinite(Date.parse(values.completed_at)) ||
      new Date(values.completed_at).toISOString() !== values.completed_at)
  )
    bad("Invalid completion date");
  let items = input.linked_accounts === undefined ? undefined : links(input.linked_accounts);
  if (items === undefined && input.linked_account_id !== undefined)
    items = input.linked_account_id === null ? [] : links([input.linked_account_id]);
  if (input.linked_account_id !== undefined && input.linked_account_id !== null)
    uuid(input.linked_account_id);
  if (!row)
    row = (
      await c.query(
        "INSERT INTO money_goals(user_id,name,target_amount,target_date,completed_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [owner, values.name, values.target_amount, values.target_date, values.completed_at]
      )
    ).rows[0];
  else
    row = (
      await c.query(
        "UPDATE money_goals SET name=$3,target_amount=$4,target_date=$5,completed_at=$6,version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
        [owner, row.id, values.name, values.target_amount, values.target_date, values.completed_at]
      )
    ).rows[0];
  if (items !== undefined) {
    await capacity(c, owner, row.id, items);
    await c.query("DELETE FROM money_goal_accounts WHERE user_id=$1 AND goal_id=$2", [
      owner,
      row.id,
    ]);
    for (const item of items)
      await c.query(
        "INSERT INTO money_goal_accounts(user_id,goal_id,account_id,allocated_amount) VALUES($1,$2,$3,$4)",
        [owner, row.id, item.account_id, item.allocated_amount]
      );
    row = (
      await c.query(
        "UPDATE money_goals SET linked_account_id=$3 WHERE user_id=$1 AND id=$2 RETURNING *",
        [owner, row.id, items[0]?.account_id ?? null]
      )
    ).rows[0];
  }
  return row;
}
