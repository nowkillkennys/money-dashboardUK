import { it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand, readMainTable } from "../../lib/workspace/main-repository";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owners = [randomUUID(), randomUUID()];
afterAll(async () => {
  for (const table of [
    "money_allocation_plans",
    "money_goal_accounts",
    "money_goals",
    "money_transactions",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [owners]);
  await db.query("DELETE FROM workspace_features WHERE owner_id=ANY($1::uuid[])", [owners]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [owners]);
  await db.end();
});
it("saves owner scoped exact earmarks atomically, retries once and activates only one plan", async () => {
  for (const owner of owners)
    await db.query(
      "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
      [owner, `test-${owner}`]
    );
  const [owner, other] = owners;
  const run = (input: Record<string, unknown>, key = randomUUID()) =>
    executeMainCommand(owner, key, input);
  const bank = await run({
    action: "bank.create",
    name: "Savings",
    type: "checking",
    starting_balance: 100,
  });
  const foreign = await executeMainCommand(other, randomUUID(), {
    action: "bank.create",
    name: "Foreign",
    type: "checking",
    starting_balance: 100,
  });
  const command = {
    action: "goal.create",
    name: "Reserve",
    target_amount: 100,
    linked_accounts: [{ account_id: bank.id, allocated_amount: 60.01 }],
  };
  const key = randomUUID(),
    goal = await run(command, key);
  expect(await run(command, key)).toEqual(goal);
  expect(await readMainTable(owner, "money_goal_accounts")).toHaveLength(1);
  await expect(
    run({
      action: "goal.create",
      name: "Overbooked",
      linked_accounts: [{ account_id: bank.id, allocated_amount: 40 }],
    })
  ).rejects.toThrow();
  expect(await readMainTable(owner, "money_goals")).toHaveLength(1);
  await expect(
    run({
      action: "goal.update",
      id: goal.id,
      version: 1,
      name: "Foreign link",
      linked_accounts: [foreign.id],
    })
  ).rejects.toThrow();
  expect((await readMainTable(owner, "money_goals"))[0].name).toBe("Reserve");
  for (const amount of [0.001, true, {}, "1e2"])
    await expect(
      run({ action: "goal.increment", id: goal.id, version: 1, account_id: bank.id, amount })
    ).rejects.toThrow();
  await run({
    action: "goal.increment",
    id: goal.id,
    version: 1,
    account_id: bank.id,
    amount: 0.01,
  });
  await expect(
    run({ action: "goal.update", id: goal.id, version: 1, name: "Stale" })
  ).rejects.toThrow();
  expect((await readMainTable(owner, "money_goal_accounts"))[0].allocated_amount).toBe("60.02");
  await expect(
    run({ action: "goal.create", name: "Invalid day", target_date: "2026-02-30" })
  ).rejects.toThrow();
  await expect(
    run({ action: "goal.update", id: goal.id, version: 2, user_id: other })
  ).rejects.toThrow();
  await expect(
    run({
      action: "goal.update",
      id: goal.id,
      version: 2,
      linked_accounts: [{ account_id: bank.id, allocated_amount: 10, owner_id: other }],
    })
  ).rejects.toThrow();
  await expect(
    executeMainCommand(other, randomUUID(), { action: "goal.delete", id: goal.id, version: 2 })
  ).rejects.toThrow();
  await expect(
    run({ action: "allocation.create", name: "Foreign", allocations: { [foreign.id]: 10 } })
  ).rejects.toThrow();
  await expect(
    run({
      action: "allocation.create",
      name: "Stale goal",
      allocations: { [bank.id]: 10, __goals__: { [bank.id]: randomUUID() } },
    })
  ).rejects.toThrow();
  const a = await run({
    action: "allocation.create",
    name: "A",
    is_active: true,
    allocations: { [bank.id]: 20, __goals__: { [bank.id]: goal.id } },
  });
  const b = await run({
    action: "allocation.create",
    name: "B",
    is_active: false,
    allocations: { [bank.id]: 10 },
  });
  await expect(
    run({ action: "allocation.activate", id: randomUUID(), version: 1 })
  ).rejects.toThrow();
  expect(
    (await readMainTable(owner, "money_allocation_plans")).find((p) => p.id === a.id).is_active
  ).toBe(true);
  await run({ action: "allocation.activate", id: b.id, version: 1 });
  expect(
    (await readMainTable(owner, "money_allocation_plans"))
      .filter((p) => p.is_active)
      .map((p) => p.id)
  ).toEqual([b.id]);
  expect(await readMainTable(owner, "money_transactions")).toHaveLength(0);
  expect((await readMainTable(owner, "money_accounts"))[0].starting_balance).toBe("100.00");
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  await expect(run({ action: "goal.delete", id: goal.id, version: 2 })).rejects.toThrow(
    "Manual input"
  );
});
