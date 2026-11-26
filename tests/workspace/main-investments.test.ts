import { afterAll, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { executeMainCommand } from "../../lib/workspace/main-repository";
import { readMainTable } from "../../lib/workspace/main-repository";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
afterAll(() => admin.end());
async function fixture() {
  const owner = randomUUID();
  await admin.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
    [owner, "investments-" + owner]
  );
  const account = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic investing",
    type: "investing",
  });
  return { owner, account };
}
it("records exact positions and dividends once without creating cash transactions", async () => {
  const { owner, account } = await fixture(),
    key = randomUUID();
  const input = {
    action: "holding.create",
    account_id: account.id,
    symbol: "VWRP.L",
    shares: "0.123456",
    cost_basis: "123.45",
    cost_currency: "GBP",
  };
  const h = await executeMainCommand(owner, key, input);
  expect(await executeMainCommand(owner, key, input)).toEqual(h);
  expect(h.row.shares).toBe("0.123456");
  expect(h.row.cost_basis).toBe("123.45");
  const d = await executeMainCommand(owner, randomUUID(), {
    action: "dividend.create",
    holding_id: h.id,
    amount: "2.01",
    date: "2026-11-26",
    reinvested: true,
  });
  expect(d.row.symbol).toBe("VWRP.L");
  expect(await readMainTable(owner, "money_transactions")).toEqual([]);
  await expect(
    executeMainCommand(owner, randomUUID(), { action: "holding.delete", id: h.id, version: 1 })
  ).rejects.toMatchObject({ status: 409 });
  await executeMainCommand(owner, randomUUID(), {
    action: "dividend.delete",
    id: d.id,
    version: 1,
  });
  await executeMainCommand(owner, randomUUID(), {
    action: "holding.update",
    id: h.id,
    version: 1,
    shares: "1.000001",
  });
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "holding.update",
      id: h.id,
      version: 1,
      shares: "2",
    })
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects foreign accounts, forged fields, non GBP, precision loss and invalid booleans", async () => {
  const { owner, account } = await fixture(),
    foreign = await fixture();
  const checking = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic checking",
    type: "checking",
  });
  const base = {
    action: "holding.create",
    account_id: account.id,
    symbol: "VWRP.L",
    shares: "1",
    cost_basis: "1.00",
  };
  for (const patch of [
    { account_id: foreign.account.id },
    { account_id: checking.id },
    { shares: "0.0000001" },
    { shares: "100000000" },
    { cost_basis: "1.001" },
    { cost_currency: "USD" },
    { currency: "" },
    { symbol: 42 },
    { symbol: "CASH" },
    { symbol: "CASHCAD" },
    { user_id: foreign.owner },
    { version: 1 },
    { id: randomUUID() },
  ])
    await expect(
      executeMainCommand(owner, randomUUID(), { ...base, ...patch })
    ).rejects.toMatchObject({ status: 400 });
  const h = await executeMainCommand(owner, randomUUID(), base);
  for (const patch of [
    { reinvested: "false" },
    { date: "2026-02-30" },
    { holding_id: foreign.account.id },
    { symbol: "FORGED" },
    { notes: "x".repeat(2001) },
  ])
    await expect(
      executeMainCommand(owner, randomUUID(), {
        action: "dividend.create",
        holding_id: h.id,
        amount: "1",
        date: "2026-11-26",
        ...patch,
      })
    ).rejects.toMatchObject({ status: 400 });
  await expect(
    executeMainCommand(foreign.owner, randomUUID(), {
      action: "holding.update",
      id: h.id,
      version: 1,
      shares: "2",
    })
  ).rejects.toMatchObject({ status: 404 });
});
