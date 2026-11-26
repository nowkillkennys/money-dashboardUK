import { it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand, readMainTable } from "../../lib/workspace/main-repository";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  await db.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled'),($3,$4,'disabled')",
    [owner, "test-" + owner, other, "test-" + other]
  );
});
afterAll(async () => {
  for (const table of [
    "money_subscriptions",
    "money_settings",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [[owner, other]]);
  await db.query("DELETE FROM workspace_features WHERE owner_id=ANY($1::uuid[])", [[owner, other]]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, other]]);
  await db.end();
});
it("persists versioned owner schedules without posting financial effects and rolls back invalid commands", async () => {
  const foreign = await executeMainCommand(other, randomUUID(), {
    action: "bank.create",
    name: "Other bank",
  });
  const input = {
    action: "subscription.create",
    name: "Synthetic membership",
    amount: "12.34",
    frequency: "monthly",
    next_billing: "2026-11-30",
  };
  const key = randomUUID();
  const created = await executeMainCommand(owner, key, input);
  expect(await executeMainCommand(owner, key, input)).toEqual(created);
  await expect(executeMainCommand(owner, key, { ...input, amount: 13 })).rejects.toThrow("key");
  expect(await readMainTable(other, "money_subscriptions")).toEqual([]);
  await expect(
    executeMainCommand(other, randomUUID(), {
      action: "subscription.update",
      id: created.id,
      version: 1,
      is_active: false,
    })
  ).rejects.toThrow("not found");
  for (const invalid of [
    { action: "__proto__.create" },
    { action: "constructor.create" },
    { amount: "1.234" },
    { amount: -1 },
    { next_billing: "2026-02-30" },
    { frequency: "daily" },
    { is_active: "false" },
    { currency: "USD" },
    { owner_id: other },
    { payment_account_id: foreign.id },
    { notes: "x".repeat(2001) },
  ]) {
    const rejectedKey = randomUUID();
    await expect(
      executeMainCommand(owner, rejectedKey, { ...input, ...invalid })
    ).rejects.toThrow();
    expect(
      (
        await db.query("SELECT * FROM money_command_receipts WHERE user_id=$1 AND key=$2", [
          owner,
          rejectedKey,
        ])
      ).rows
    ).toHaveLength(0);
  }
  const bank = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Scheduled payment bank",
  });
  const paused = await executeMainCommand(owner, randomUUID(), {
    action: "subscription.update",
    id: created.id,
    version: 1,
    is_active: false,
    next_billing: "2026-12-31",
    payment_account_id: bank.id,
  });
  expect(paused.version).toBe(2);
  await expect(
    executeMainCommand(owner, randomUUID(), { action: "bank.delete", id: bank.id, version: 1 })
  ).rejects.toThrow("Archive");
  expect(await readMainTable(owner, "money_accounts")).toHaveLength(1);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "subscription.delete",
      id: created.id,
      version: 1,
    })
  ).rejects.toThrow("changed");
  expect((await readMainTable(owner, "money_subscriptions"))[0]).toMatchObject({
    is_active: false,
    next_billing: "2026-12-31",
    payment_account_id: bank.id,
  });
  expect(await readMainTable(owner, "money_transactions")).toHaveLength(0);
  expect(await readMainTable(owner, "money_credit_card_charges")).toHaveLength(0);
  await executeMainCommand(owner, randomUUID(), {
    action: "subscription.delete",
    id: created.id,
    version: 2,
  });
  expect(await readMainTable(owner, "money_subscriptions")).toEqual([]);
});
it("creates safe zero-valued GBP settings atomically and requires current versions for edits", async () => {
  const create = {
    action: "settings.upsert",
    display_name: "Synthetic user",
    rent_amount: 0,
    paycheck_amount: 0,
    monthly_essentials_budget: 0,
  };
  const key = randomUUID();
  const results = await Promise.allSettled([
    executeMainCommand(owner, key, create),
    executeMainCommand(owner, randomUUID(), create),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  // The winning create may use either key, so prove receipt replay with a fresh versioned update below.
  const settings = (await readMainTable(owner, "money_settings"))[0];
  const result = { id: settings.id, version: settings.version };
  expect(result.version).toBe(1);
  expect((await readMainTable(owner, "money_settings"))[0]).toMatchObject({
    base_currency: "GBP",
    rent_amount: "0.00",
    paycheck_amount: "0.00",
    monthly_essentials_budget: "0.00",
    pin_hash: null,
  });
  await expect(executeMainCommand(owner, randomUUID(), create)).rejects.toThrow("changed");
  for (const invalid of [
    { pin_hash: "bad" },
    { failed_attempts: 0 },
    { locked_until: null },
    { user_id: other },
    { base_currency: "EUR" },
    { auto_apply_allocation: true },
    { rent_day: 32 },
    { bill_reminder_days: -1 },
    { expense_categories: [1] },
    { paycheck_frequency: "daily" },
    { rent_amount: "1.001" },
  ])
    await expect(
      executeMainCommand(owner, randomUUID(), { ...create, version: 1, ...invalid })
    ).rejects.toThrow();
  const updateKey = randomUUID(),
    updateInput = {
      action: "settings.upsert",
      version: 1,
      display_name: "Updated",
      expense_categories: ["Bills", "Food"],
    };
  const updated = await executeMainCommand(owner, updateKey, updateInput);
  expect(await executeMainCommand(owner, updateKey, updateInput)).toEqual(updated);
  expect(updated.version).toBe(2);
  expect(await readMainTable(other, "money_settings")).toEqual([]);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "settings.upsert",
      version: 1,
      display_name: "Stale",
    })
  ).rejects.toThrow("changed");
  expect((await readMainTable(owner, "money_settings"))[0].display_name).toBe("Updated");
});
