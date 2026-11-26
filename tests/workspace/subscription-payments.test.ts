import { it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand as command, readMainTable } from "../../lib/workspace/main-repository";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID();
beforeAll(async () => {
  await db.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
    [owner, "test-" + owner]
  );
});
afterAll(async () => {
  for (const table of [
    "money_transactions",
    "money_credit_card_charges",
    "money_subscriptions",
    "money_workspace_cards",
    "money_credit_cards",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [owner]);
  await db.query("DELETE FROM workspace_snapshots WHERE owner_id=$1", [owner]);
  await db.query("DELETE FROM workspace_accounts WHERE owner_id=$1", [owner]);
  await db.query("DELETE FROM workspace_features WHERE owner_id=$1", [owner]);
  await db.query("DELETE FROM workspace_users WHERE id=$1", [owner]);
  await db.end();
});
it("posts one exact bank expense and advances one overdue cycle atomically and idempotently", async () => {
  const bank = await command(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic bank",
  });
  const subscription = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Synthetic bill",
    amount: "12.34",
    frequency: "monthly",
    next_billing: "2026-01-31",
  });
  const input = {
    action: "subscription.pay",
    id: subscription.id,
    version: 1,
    payment_account_id: bank.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2026-01-31",
  };
  const key = randomUUID();
  const result = await command(owner, key, input);
  expect(result.version).toBe(2);
  expect(result.row.next_billing).toBe("2026-02-28");
  expect(await command(owner, key, input)).toEqual(result);
  await expect(command(owner, randomUUID(), input)).rejects.toThrow("changed");
  const transactions = await readMainTable(owner, "money_transactions");
  expect(transactions).toHaveLength(1);
  expect(transactions[0]).toMatchObject({
    amount: "12.34",
    account_id: bank.id,
    category: "Bills",
    merchant: "Synthetic bill",
    is_recurring: true,
    recurrence: "monthly",
    date: "2026-11-26",
  });
  expect((await readMainTable(owner, "money_accounts"))[0].version).toBe(2);
});
it("posts a card charge and exactly one linked expense with both card versions advanced", async () => {
  const card = await command(owner, randomUUID(), {
    action: "card.create",
    name: "Synthetic card",
  });
  const sub = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Card bill",
    amount: "0.01",
    next_billing: "2024-02-29",
    frequency: "yearly",
  });
  await command(owner, randomUUID(), {
    action: "subscription.pay",
    id: sub.id,
    version: 1,
    payment_account_id: "cc:" + card.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2024-02-29",
  });
  const charges = await readMainTable(owner, "money_credit_card_charges");
  expect(charges).toHaveLength(1);
  expect(charges[0]).toMatchObject({
    amount: "0.01",
    card_id: card.id,
    statement_disposition: "excluded",
  });
  const tx = (await readMainTable(owner, "money_transactions")).filter(
    (t) => t.linked_charge_id === charges[0].id
  );
  expect(tx).toHaveLength(1);
  expect(charges[0].linked_transaction_id).toBe(tx[0].id);
  expect((await readMainTable(owner, "money_credit_cards"))[0].version).toBe(2);
  expect(
    (await db.query("SELECT version FROM workspace_accounts WHERE id=$1", [card.id])).rows[0]
      .version
  ).toBe(2);
});
it("rejects stale accounts, foreign owners, disabled input, client amounts and invalid dates without financial effects", async () => {
  const bank = await command(owner, randomUUID(), {
    action: "bank.create",
    name: "Validation bank",
  });
  const sub = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Validation bill",
    amount: "10",
    next_billing: "2026-03-31",
  });
  const input = {
    action: "subscription.pay",
    id: sub.id,
    version: 1,
    payment_account_id: bank.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2026-03-31",
  };
  const count = (await readMainTable(owner, "money_transactions")).length;
  for (const change of [
    { amount: "1" },
    { owner_id: owner },
    { name: "Altered" },
    { frequency: "weekly" },
    { currency: "GBP" },
    { date: "0000-01-01" },
    { date: "2026-02-30" },
    { expected_next_billing: "2026-03-30" },
    { payment_account_version: 2 },
    { payment_account_id: randomUUID() },
  ]) {
    const key = randomUUID();
    await expect(command(owner, key, { ...input, ...change })).rejects.toThrow();
    expect(
      (
        await db.query("SELECT key FROM money_command_receipts WHERE user_id=$1 AND key=$2", [
          owner,
          key,
        ])
      ).rows
    ).toHaveLength(0);
  }
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  await expect(command(owner, randomUUID(), input)).rejects.toThrow("disabled");
  await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  await db.query("UPDATE money_accounts SET archived=true WHERE id=$1", [bank.id]);
  await expect(command(owner, randomUUID(), input)).rejects.toThrow("not found");
  await db.query("UPDATE money_accounts SET archived=false WHERE id=$1", [bank.id]);
  const outsider = randomUUID();
  await db.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
    [outsider, "test-" + outsider]
  );
  await expect(command(outsider, randomUUID(), input)).rejects.toThrow("not found");
  await db.query("DELETE FROM workspace_users WHERE id=$1", [outsider]);
  expect((await readMainTable(owner, "money_transactions")).length).toBe(count);
  expect(
    (await readMainTable(owner, "money_subscriptions")).find((s) => s.id === sub.id)
  ).toMatchObject({ version: 1, next_billing: "2026-03-31" });
});
it("serializes competing keys for the same cycle", async () => {
  const bank = await command(owner, randomUUID(), {
    action: "bank.create",
    name: "Concurrent bank",
  });
  const sub = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Concurrent bill",
    amount: "3.21",
    next_billing: "2026-12-31",
  });
  const input = {
    action: "subscription.pay",
    id: sub.id,
    version: 1,
    payment_account_id: bank.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2026-12-31",
  };
  const results = await Promise.allSettled([
    command(owner, randomUUID(), input),
    command(owner, randomUUID(), input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await readMainTable(owner, "money_transactions")).filter((t) => t.account_id === bank.id)
  ).toHaveLength(1);
});
it("rolls back charge, expense and all versions when schedule update fails", async () => {
  const card = await command(owner, randomUUID(), { action: "card.create", name: "Rollback card" });
  const sub = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Rollback bill",
    amount: "2.99",
    next_billing: "2026-04-30",
  });
  const input = {
    action: "subscription.pay",
    id: sub.id,
    version: 1,
    payment_account_id: "cc:" + card.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2026-04-30",
  };
  // Exhausting the schedule's integer version forces a database failure after both financial inserts.
  await db.query("UPDATE money_subscriptions SET version=2147483647 WHERE id=$1", [sub.id]);
  const key = randomUUID();
  await expect(command(owner, key, { ...input, version: 2147483647 })).rejects.toThrow();
  expect(
    (await readMainTable(owner, "money_credit_card_charges")).filter((c) => c.card_id === card.id)
  ).toHaveLength(0);
  expect(
    (await readMainTable(owner, "money_transactions")).filter((t) => t.merchant === "Rollback bill")
  ).toHaveLength(0);
  expect(
    (await readMainTable(owner, "money_credit_cards")).find((c) => c.id === card.id).version
  ).toBe(1);
  expect(
    (await db.query("SELECT version FROM workspace_accounts WHERE id=$1", [card.id])).rows[0]
      .version
  ).toBe(1);
  expect(
    (
      await db.query("SELECT key FROM money_command_receipts WHERE user_id=$1 AND key=$2", [
        owner,
        key,
      ])
    ).rows
  ).toHaveLength(0);
});
it("requires positive active GBP schedules and matching active bridged card versions", async () => {
  const card = await command(owner, randomUUID(), { action: "card.create", name: "Version card" });
  const sub = await command(owner, randomUUID(), {
    action: "subscription.create",
    name: "Version bill",
    amount: "8.88",
    next_billing: "2026-08-31",
  });
  const input = {
    action: "subscription.pay",
    id: sub.id,
    version: 1,
    payment_account_id: "cc:" + card.id,
    payment_account_version: 1,
    date: "2026-11-26",
    expected_next_billing: "2026-08-31",
  };
  for (const [table, field, value] of [
    ["money_subscriptions", "amount", 0],
    ["money_subscriptions", "is_active", false],
    ["money_subscriptions", "currency", "USD"],
    ["money_credit_cards", "archived", true],
    ["money_credit_cards", "currency", "USD"],
    ["money_credit_cards", "version", 2],
    ["workspace_accounts", "version", 2],
  ] as const) {
    const target = table === "money_subscriptions" ? sub.id : card.id;
    const original = (
      await db.query(`SELECT ${field} AS value FROM ${table} WHERE id=$1`, [target])
    ).rows[0].value;
    await db.query(`UPDATE ${table} SET ${field}=$2 WHERE id=$1`, [target, value]);
    await expect(command(owner, randomUUID(), input)).rejects.toThrow();
    await db.query(`UPDATE ${table} SET ${field}=$2 WHERE id=$1`, [target, original]);
  }
  await db.query("DELETE FROM money_workspace_cards WHERE card_id=$1 AND user_id=$2", [
    card.id,
    owner,
  ]);
  await expect(command(owner, randomUUID(), input)).rejects.toThrow("link changed");
  expect(
    (await readMainTable(owner, "money_credit_card_charges")).filter((c) => c.card_id === card.id)
  ).toHaveLength(0);
  expect(
    (await readMainTable(owner, "money_subscriptions")).find((s) => s.id === sub.id).version
  ).toBe(1);
});
