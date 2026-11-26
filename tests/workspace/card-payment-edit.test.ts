import { mainData } from "../../lib/workspace/main-data";
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
async function fixture() {
  const card = await executeMainCommand(owner, randomUUID(), {
    action: "card.create",
    name: "Payment edit",
    starting_balance: 100,
  });
  const bank = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Source",
    starting_balance: 500,
  });
  const second = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Destination",
    starting_balance: 300,
  });
  const payment = await executeMainCommand(owner, randomUUID(), {
    action: "card.payment",
    id: card.id,
    version: 1,
    amount: "20.00",
    date: "2026-11-26",
    account_id: bank.id,
  });
  const banks = (
    await db.query("SELECT id,version FROM money_accounts WHERE id=ANY($1::uuid[]) ORDER BY id", [
      [bank.id, second.id],
    ])
  ).rows;
  return {
    card,
    bank,
    second,
    payment,
    banks,
    input: {
      action: "payment.update",
      id: payment.id,
      version: 1,
      card_version: 2,
      bank_versions: banks.filter((b) => b.id === bank.id),
      amount: "25.00",
      date: "2026-11-25",
      account_id: bank.id,
      notes: "Edited",
    },
  };
}
const save = (input: any, key = randomUUID(), who = owner) => executeMainCommand(who, key, input);
async function state(card: string) {
  const result: any = {};
  for (const [table, col] of [
    ["money_credit_cards", "id"],
    ["workspace_accounts", "id"],
    ["money_credit_card_payments", "card_id"],
    ["workspace_payments", "account_id"],
    ["workspace_snapshots", "account_id"],
  ])
    result[table] = (
      await db.query(`SELECT * FROM ${table} WHERE ${col}=$1 ORDER BY id`, [card])
    ).rows;
  result.banks = (
    await db.query("SELECT * FROM money_accounts WHERE user_id=$1 ORDER BY id", [owner])
  ).rows;
  return result;
}
it("updates linked payment, versions, source and immutable snapshots, replays receipts", async () => {
  const f = await fixture(),
    before = await state(f.card.id),
    key = randomUUID();
  const result = await save({ ...f.input, account_id: f.second.id, bank_versions: f.banks }, key);
  expect(result.version).toBe(2);
  expect(await save({ ...f.input, account_id: f.second.id, bank_versions: f.banks }, key)).toEqual(
    result
  );
  const after = await state(f.card.id);
  expect(after.workspace_snapshots).toEqual(before.workspace_snapshots);
  expect(after.money_credit_cards[0].version).toBe(3);
  expect(after.workspace_accounts[0].version).toBe(3);
  expect(after.workspace_accounts[0].reported_minor).toBe(
    before.workspace_accounts[0].reported_minor
  );
  expect(after.workspace_payments[0]).toMatchObject({
    id: f.payment.id,
    amount_minor: "2500",
    paid_on: "2026-11-25",
    disposition: "excluded",
    status: "posted",
  });
  expect(after.money_credit_card_payments[0]).toMatchObject({
    id: f.payment.id,
    account_id: f.second.id,
    notes: "Edited",
    amount: "25.00",
  });
  for (const bank of f.banks)
    expect(after.banks.find((b: any) => b.id === bank.id).version).toBe(bank.version + 1);
  expect(after.banks.map((b: any) => [b.id, b.starting_balance])).toEqual(
    before.banks.map((b: any) => [b.id, b.starting_balance])
  );
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
});
it("supports null nonbank credit and preserves included metadata/source disposition", async () => {
  const f = await fixture();
  await db.query("UPDATE workspace_payments SET disposition='included' WHERE id=$1", [
    f.payment.id,
  ]);
  await save({ ...f.input, amount: "20.00", date: "2026-11-26", account_id: null });
  expect((await state(f.card.id)).workspace_payments[0].disposition).toBe("included");
  await save({ ...f.input, version: 2, card_version: 3, account_id: null, bank_versions: [] });
  expect((await state(f.card.id)).workspace_payments[0].disposition).toBe("unresolved");
});
it("enforces ownership, manual mode, strict fields and bank/card/payment versions", async () => {
  const f = await fixture();
  await expect(save(f.input, randomUUID(), other)).rejects.toMatchObject({ status: 404 });
  for (const patch of [
    { version: 0 },
    { card_version: 1 },
    { bank_versions: [{ id: f.bank.id, version: 999 }] },
  ])
    await expect(save({ ...f.input, ...patch })).rejects.toMatchObject({ status: 409 });
  for (const patch of [
    { currency: "GBP" },
    { card_id: f.card.id },
    { refund: true },
    { account_id: undefined },
    { bank_versions: [] },
    { bank_versions: [...f.input.bank_versions, ...f.input.bank_versions] },
    { bank_versions: [{ id: f.bank.id, version: 0 }] },
    { bank_versions: [{ id: f.bank.id, version: 1, extra: true }] },
    { notes: 42 },
    { notes: "x".repeat(2001) },
  ])
    await expect(save({ ...f.input, ...patch })).rejects.toMatchObject({ status: 400 });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  try {
    await expect(save(f.input)).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  }
});
it.each([0, -1, "1.001", true, "1e2", "100000000"])("rejects invalid amount %s", async (amount) => {
  const f = await fixture();
  await expect(save({ ...f.input, amount })).rejects.toMatchObject({ status: 400 });
});
it.each(["0000-01-01", "2026-02-29", "2026-04-31", "2026-1-01"])(
  "rejects invalid day %s",
  async (date) => {
    const f = await fixture();
    await expect(save({ ...f.input, date })).rejects.toMatchObject({ status: 400 });
  }
);
it("rejects broken linked payment and pending or voided payments", async () => {
  const f = await fixture();
  for (const status of ["pending", "voided"]) {
    await db.query("UPDATE workspace_payments SET status=$2 WHERE id=$1", [f.payment.id, status]);
    await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
  }
  await db.query("UPDATE workspace_payments SET status='posted',amount_minor=1999 WHERE id=$1", [
    f.payment.id,
  ]);
  await expect(save(f.input)).rejects.toMatchObject({ status: 409 });
});
it("permits historical archived source corrections, rejects newly archived banks", async () => {
  const f = await fixture();
  await db.query("UPDATE money_accounts SET archived=true WHERE id=ANY($1::uuid[])", [
    [f.bank.id, f.second.id],
  ]);
  await expect(
    save({ ...f.input, account_id: f.second.id, bank_versions: f.banks })
  ).rejects.toMatchObject({ status: 400 });
  await save(f.input);
});
it("rolls back negative balance and permits one concurrent distinct-key save", async () => {
  const f = await fixture(),
    before = await state(f.card.id);
  await expect(save({ ...f.input, amount: "101.00" })).rejects.toMatchObject({ status: 400 });
  expect(await state(f.card.id)).toEqual(before);
  const results = await Promise.allSettled([save(f.input), save(f.input)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("rolls back all records when receipt insertion fails late", async () => {
  const f = await fixture(),
    before = await state(f.card.id);
  await db.query(
    `CREATE FUNCTION public.test_payment_edit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${owner}'::uuid THEN RAISE EXCEPTION 'synthetic late receipt failure'; END IF; RETURN NEW; END $$`
  );
  await db.query(
    "CREATE TRIGGER test_payment_edit_fail BEFORE INSERT ON money_command_receipts FOR EACH ROW EXECUTE FUNCTION public.test_payment_edit_fail()"
  );
  try {
    await expect(save(f.input)).rejects.toThrow("synthetic late receipt failure");
    expect(await state(f.card.id)).toEqual(before);
  } finally {
    await db.query("DROP TRIGGER test_payment_edit_fail ON money_command_receipts");
    await db.query("DROP FUNCTION public.test_payment_edit_fail()");
  }
});

it("moves exact cash effects between bank and nonbank sources without expenses", async () => {
  const f = await fixture();
  let data = await mainData(owner, "Synthetic");
  expect(data.balances[f.bank.id]).toBe(480);
  await save({ ...f.input, amount: "30.25", account_id: f.second.id, bank_versions: f.banks });
  data = await mainData(owner, "Synthetic");
  expect(data.balances[f.bank.id]).toBe(500);
  expect(data.balances[f.second.id]).toBe(269.75);
  await save({
    ...f.input,
    version: 2,
    card_version: 3,
    amount: "25.00",
    account_id: null,
    bank_versions: [
      { id: f.second.id, version: f.banks.find((b) => b.id === f.second.id)!.version + 1 },
    ],
  });
  data = await mainData(owner, "Synthetic");
  expect(data.balances[f.second.id]).toBe(300);
  await save({
    ...f.input,
    version: 3,
    card_version: 4,
    amount: "15.00",
    bank_versions: [{ id: f.bank.id, version: f.input.bank_versions[0].version + 1 }],
  });
  data = await mainData(owner, "Synthetic");
  expect(data.balances[f.bank.id]).toBe(485);
  expect(data.transactions).toHaveLength(0);
});
it("requires linked identity and card bridge, accepts early dates and unresolved edits", async () => {
  const f = await fixture();
  await db.query("UPDATE workspace_payments SET disposition='unresolved' WHERE id=$1", [
    f.payment.id,
  ]);
  await save({ ...f.input, date: "0001-01-01" });
  expect((await state(f.card.id)).workspace_payments[0]).toMatchObject({
    paid_on: "0001-01-01",
    disposition: "unresolved",
  });
  const g = await fixture();
  await db.query("UPDATE money_credit_card_payments SET workspace_payment_id=null WHERE id=$1", [
    g.payment.id,
  ]);
  await expect(save(g.input)).rejects.toMatchObject({ status: 409 });
  const h = await fixture();
  await db.query("DELETE FROM money_workspace_cards WHERE card_id=$1", [h.card.id]);
  await expect(save(h.input)).rejects.toMatchObject({ status: 409 });
});
