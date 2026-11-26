import { it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand, readMainTable } from "../../lib/workspace/main-repository";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  other = randomUUID();
afterAll(async () => {
  for (const t of [
    "money_workspace_cards",
    "money_credit_card_payments",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_cards",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${t} WHERE user_id=ANY($1::uuid[])`, [[owner, other]]);
  for (const t of [
    "workspace_snapshots",
    "workspace_pdf_previews",
    "workspace_payments",
    "workspace_accounts",
    "workspace_features",
  ])
    await db.query(`DELETE FROM ${t} WHERE owner_id=ANY($1::uuid[])`, [[owner, other]]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, other]]);
  await db.end();
});
it("atomically links charges, deducts bank repayments once, isolates owners and rejects stale retries", async () => {
  await db.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled'),($3,$4,'disabled')",
    [owner, "test-" + owner, other, "test-" + other]
  );
  await db.query("INSERT INTO workspace_features(owner_id,manual) VALUES($1,false)", [owner]);
  await expect(
    executeMainCommand(owner, randomUUID(), { action: "card.create", name: "Disabled" })
  ).rejects.toThrow("Manual input");
  await expect(
    executeMainCommand(owner, randomUUID(), { action: "bank.create", name: "Disabled" })
  ).rejects.toThrow("Manual input");
  await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  const existing = randomUUID();
  await db.query(
    "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of,version) VALUES($1,$2,'Existing synthetic','credit_card',12345,'2026-10-01',4)",
    [existing, owner]
  );
  const adoptKey = randomUUID(),
    adopt = { action: "card.adopt", id: existing, version: 4 };
  const adopted = await executeMainCommand(owner, adoptKey, adopt);
  expect(adopted.id).toBe(existing);
  expect(adopted.version).toBe(4);
  expect(await executeMainCommand(owner, adoptKey, adopt)).toEqual(adopted);
  expect(
    (
      await db.query("SELECT reported_minor,as_of::text FROM workspace_accounts WHERE id=$1", [
        existing,
      ])
    ).rows[0]
  ).toEqual({ reported_minor: "12345", as_of: "2026-10-01" });
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "card.create",
      name: "Invalid date",
      as_of: "2026-02-30",
    })
  ).rejects.toThrow();
  const foreign = await executeMainCommand(other, randomUUID(), {
    action: "bank.create",
    name: "Other synthetic bank",
    type: "checking",
  });
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "transaction.create",
      type: "expense",
      account_id: foreign.id,
      amount: 10,
      date: "2026-11-26",
    })
  ).rejects.toThrow();
  const bank = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic bank",
    type: "checking",
    starting_balance: 1000,
  });
  const card = await executeMainCommand(owner, randomUUID(), {
    action: "card.create",
    name: "Synthetic card",
    credit_limit: 2000,
  });
  const key = randomUUID(),
    command = {
      action: "card.charge",
      id: card.id,
      version: 1,
      amount: 100,
      date: "2026-11-26",
      merchant: "Synthetic",
      tx_overrides: {},
    };
  const charge = await executeMainCommand(owner, key, command);
  expect(await executeMainCommand(owner, key, command)).toEqual(charge);
  await expect(executeMainCommand(owner, key, { ...command, amount: 101 })).rejects.toThrow();
  await expect(executeMainCommand(owner, randomUUID(), command)).rejects.toThrow();
  await expect(
    executeMainCommand(other, randomUUID(), {
      action: "card.payment",
      id: card.id,
      version: 2,
      account_id: bank.id,
      amount: 20,
      date: "2026-11-26",
    })
  ).rejects.toThrow();
  await executeMainCommand(owner, randomUUID(), {
    action: "card.payment",
    id: card.id,
    version: 2,
    account_id: bank.id,
    amount: 20,
    date: "2026-11-26",
  });
  const tx = await readMainTable(owner, "money_transactions");
  expect(tx).toHaveLength(1);
  expect(tx[0].account_id).toBeNull();
  expect(tx[0].linked_charge_id).toBeTruthy();
  expect(await readMainTable(owner, "money_credit_card_payments")).toHaveLength(1);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "card.payment",
      id: card.id,
      version: 3,
      account_id: bank.id,
      amount: 1000,
      date: "2026-11-26",
    })
  ).rejects.toThrow("Payment exceeds");
  expect(await readMainTable(owner, "money_credit_card_payments")).toHaveLength(1);
  await expect(
    executeMainCommand(owner, randomUUID(), { action: "bank.delete", id: bank.id, version: 1 })
  ).rejects.toThrow("Archive accounts");
  expect((await readMainTable(other, "money_accounts")).map((r) => r.id)).toEqual([foreign.id]);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "transaction.create",
      type: "expense",
      account_id: randomUUID(),
      amount: 10,
      date: "2026-11-26",
    })
  ).rejects.toThrow();
  await executeMainCommand(owner, randomUUID(), {
    action: "card.charge",
    card_id: card.id,
    version: 3,
    amount: 5,
    date: "2026-11-26",
  });
  expect(await readMainTable(owner, "money_credit_card_charges")).toHaveLength(2);
  expect(await readMainTable(owner, "money_transactions")).toHaveLength(1);
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "card.payment",
      card_id: card.id,
      version: 4,
      amount: 1,
      date: "2026-11-26",
    })
  ).rejects.toThrow("Manual input");
});
