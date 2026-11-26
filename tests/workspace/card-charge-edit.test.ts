import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand } from "../../lib/workspace/main-repository";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  for (const id of [owner, other]) {
    await db.query(
      "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
      [id, "test-" + id]
    );
    await db.query("INSERT INTO workspace_features(owner_id) VALUES($1)", [id]);
  }
});
afterAll(async () => {
  for (const t of [
    "money_command_receipts",
    "money_workspace_cards",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_card_payments",
    "money_credit_cards",
    "money_goals",
    "money_accounts",
  ])
    await db.query(`DELETE FROM ${t} WHERE user_id=ANY($1::uuid[])`, [[owner, other]]);
  for (const t of [
    "workspace_snapshots",
    "workspace_payments",
    "workspace_accounts",
    "workspace_features",
  ])
    await db.query(`DELETE FROM ${t} WHERE owner_id=ANY($1::uuid[])`, [[owner, other]]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, other]]);
  await db.end();
});
async function fixture(linked = true) {
  const card = await executeMainCommand(owner, randomUUID(), {
    action: "card.create",
    name: "Synthetic edit",
    starting_balance: 100,
  });
  const charge = await executeMainCommand(owner, randomUUID(), {
    action: "card.charge",
    id: card.id,
    version: 1,
    amount: "20.00",
    date: "2026-11-26",
    ...(linked ? { tx_overrides: {} } : {}),
  });
  return {
    card,
    charge,
    input: {
      action: "charge.update",
      id: charge.id,
      version: 1,
      card_version: 2,
      ...(linked ? { transaction_version: 1 } : {}),
      amount: "25.00",
      date: "2026-11-25",
      merchant: "Shop",
      category: "Food",
      notes: "Edited",
    },
  };
}
const save = (input: any, key = randomUUID(), who = owner) => executeMainCommand(who, key, input);
async function state(card: string) {
  const result: any = {};
  for (const [t, col] of [
    ["money_credit_cards", "id"],
    ["workspace_accounts", "id"],
    ["money_credit_card_charges", "card_id"],
    ["workspace_snapshots", "account_id"],
  ])
    result[t] = (await db.query(`SELECT * FROM ${t} WHERE ${col}=$1 ORDER BY id`, [card])).rows;
  result.tx = (
    await db.query(
      "SELECT * FROM money_transactions WHERE linked_charge_id IN (SELECT id FROM money_credit_card_charges WHERE card_id=$1)",
      [card]
    )
  ).rows;
  return result;
}
it("updates linked metadata atomically, preserves snapshots and replays receipts", async () => {
  const f = await fixture();
  const before = await state(f.card.id);
  const key = randomUUID();
  const result = await save(
    {
      ...f.input,
      tx_overrides: {
        exclude_from_monthly: true,
        personal_share_percent: "33.33",
        shared_with: "Sam",
        goal_id: null,
      },
    },
    key
  );
  expect(result.version).toBe(2);
  expect(
    await save(
      {
        ...f.input,
        tx_overrides: {
          exclude_from_monthly: true,
          personal_share_percent: "33.33",
          shared_with: "Sam",
          goal_id: null,
        },
      },
      key
    )
  ).toEqual(result);
  const after = await state(f.card.id);
  expect(after.workspace_snapshots).toEqual(before.workspace_snapshots);
  expect(after.money_credit_cards[0].version).toBe(3);
  expect(after.workspace_accounts[0].version).toBe(3);
  expect(after.tx[0]).toMatchObject({
    amount: "25.00",
    notes: "Edited",
    merchant: "Shop",
    personal_share_percent: "33.33",
    version: 2,
  });
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
});
it("enforces owner, all versions, manual flag and strict fields", async () => {
  const f = await fixture();
  await expect(save(f.input, randomUUID(), other)).rejects.toMatchObject({ status: 404 });
  for (const patch of [
    { version: 0 },
    { card_version: 1 },
    { transaction_version: 0 },
    { transaction_version: undefined },
  ])
    await expect(save({ ...f.input, ...patch })).rejects.toMatchObject({ status: 409 });
  for (const patch of [
    { card_id: f.card.id },
    { currency: "USD" },
    { tx_overrides: { notes: "x" } },
    { tx_overrides: { exclude_from_monthly: 1 } },
    { tx_overrides: { goal_id: randomUUID() } },
  ])
    await expect(save({ ...f.input, ...patch })).rejects.toMatchObject({ status: 400 });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  try {
    await expect(save(f.input)).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  }
});
it.each(["0000-01-01", "2026-02-29", "2026-04-31", "2026-1-01"])(
  "rejects invalid civil day %s",
  async (date) => {
    const f = await fixture();
    await expect(save({ ...f.input, date })).rejects.toMatchObject({ status: 400 });
  }
);
it.each([0, -1, "1.001", true, "1e2", "100000000"])(
  "rejects invalid GBP amount %s",
  async (amount) => {
    const f = await fixture();
    await expect(save({ ...f.input, amount })).rejects.toMatchObject({ status: 400 });
  }
);
it("rejects linked details on standalone charges and inconsistent or cash-linked expenses", async () => {
  const standalone = await fixture(false);
  await expect(save({ ...standalone.input, transaction_version: 1 })).rejects.toMatchObject({
    status: 400,
  });
  await expect(save({ ...standalone.input, tx_overrides: {} })).rejects.toMatchObject({
    status: 400,
  });
  await save(standalone.input);
  const f = await fixture();
  await db.query("UPDATE money_transactions SET linked_charge_id=null WHERE id=$1", [
    f.charge.row.linked_transaction_id,
  ]);
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
});
it("makes financial edits of included charges unresolved while preserving metadata-only disposition", async () => {
  const f = await fixture();
  await db.query(
    "UPDATE money_credit_card_charges SET statement_disposition='included' WHERE id=$1",
    [f.charge.id]
  );
  await save({ ...f.input, amount: "20.00", date: "2026-11-26" });
  expect((await state(f.card.id)).money_credit_card_charges[0].statement_disposition).toBe(
    "included"
  );
  await save({ ...f.input, version: 2, card_version: 3, transaction_version: 2 });
  expect((await state(f.card.id)).money_credit_card_charges[0].statement_disposition).toBe(
    "unresolved"
  );
});
it("rolls back all updates on negative tracked balance and permits only one concurrent save", async () => {
  const f = await fixture();
  await db.query(
    "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,12000,'posted','excluded','2026-11-26')",
    [randomUUID(), owner, f.card.id]
  );
  const before = await state(f.card.id);
  await expect(save({ ...f.input, amount: "19.00" })).rejects.toMatchObject({ status: 400 });
  expect(await state(f.card.id)).toEqual(before);
  const results = await Promise.allSettled([save(f.input), save(f.input)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("preserves unresolved state and accepts early real calendar days", async () => {
  const f = await fixture();
  await db.query(
    "UPDATE money_credit_card_charges SET statement_disposition='unresolved' WHERE id=$1",
    [f.charge.id]
  );
  await save({ ...f.input, date: "0001-01-01" });
  expect((await state(f.card.id)).money_credit_card_charges[0].statement_disposition).toBe(
    "unresolved"
  );
});
it("rejects overlong and nontext metadata and unknown override properties", async () => {
  const f = await fixture();
  for (const patch of [
    { merchant: 42 },
    { merchant: "a".repeat(201) },
    { category: "a".repeat(101) },
    { notes: "a".repeat(2001) },
    { tx_overrides: { shared_with: "a".repeat(101) } },
    { tx_overrides: { personal_share_percent: "100.01" } },
    { tx_overrides: { personal_share_percent: null } },
    { tx_overrides: [] },
    { tx_overrides: { is_recurring: true } },
  ])
    await expect(save({ ...f.input, ...patch })).rejects.toMatchObject({ status: 400 });
});
it("rejects cash-linked expense and unbridged statement identity without touching records", async () => {
  const f = await fixture();
  const bank = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic cash",
  });
  await db.query("UPDATE money_transactions SET account_id=$1 WHERE id=$2", [
    bank.id,
    f.charge.row.linked_transaction_id,
  ]);
  const before = await state(f.card.id);
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
  expect(await state(f.card.id)).toEqual(before);
  await db.query("UPDATE money_transactions SET account_id=null WHERE id=$1", [
    f.charge.row.linked_transaction_id,
  ]);
  await db.query("DELETE FROM money_workspace_cards WHERE card_id=$1", [f.card.id]);
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
  await db.query("DELETE FROM money_accounts WHERE id=$1", [bank.id]);
});
it("rolls back linked and card updates when receipt insertion fails late", async () => {
  const f = await fixture();
  const before = await state(f.card.id);
  await db.query(
    `CREATE FUNCTION public.test_charge_edit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${owner}'::uuid THEN RAISE EXCEPTION 'synthetic late receipt failure'; END IF; RETURN NEW; END $$`
  );
  await db.query(
    "CREATE TRIGGER test_charge_edit_fail BEFORE INSERT ON money_command_receipts FOR EACH ROW EXECUTE FUNCTION public.test_charge_edit_fail()"
  );
  try {
    await expect(save(f.input)).rejects.toThrow("synthetic late receipt failure");
    expect(await state(f.card.id)).toEqual(before);
  } finally {
    await db.query("DROP TRIGGER test_charge_edit_fail ON money_command_receipts");
    await db.query("DROP FUNCTION public.test_charge_edit_fail()");
  }
});
