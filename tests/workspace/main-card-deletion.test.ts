import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand, readMainTable } from "../../lib/workspace/main-repository";
import { withUserDb } from "../../lib/workspace/db";

const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  other = randomUUID();
beforeAll(async () => {
  for (const id of [owner, other])
    await db.query(
      "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
      [id, "test-" + id]
    );
  await db.query("INSERT INTO workspace_features(owner_id) VALUES($1),($2)", [owner, other]);
});
afterAll(async () => {
  for (const table of [
    "money_workspace_cards",
    "money_subscriptions",
    "money_credit_card_payments",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_cards",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [[owner, other]]);
  for (const table of [
    "workspace_pdf_previews",
    "workspace_snapshots",
    "workspace_payments",
    "workspace_accounts",
    "workspace_command_receipts",
    "workspace_features",
  ])
    await db.query(`DELETE FROM ${table} WHERE owner_id=ANY($1::uuid[])`, [[owner, other]]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, other]]);
  await db.end();
});
const create = (fields: Record<string, unknown> = {}) =>
  executeMainCommand(owner, randomUUID(), {
    action: "card.create",
    name: "Synthetic deletion card",
    ...fields,
  });
const remove = (card: { id: string; version: number }, key = randomUUID(), who = owner) =>
  executeMainCommand(who, key, { action: "card.delete", id: card.id, version: card.version });

it("deletes an unused zero card from both models and replays the deletion receipt", async () => {
  const card = await create();
  const key = randomUUID();
  const deleted = await remove(card, key);
  expect(deleted).toMatchObject({ id: card.id, version: 2 });
  expect(await remove(card, key)).toEqual(deleted);
  for (const [table, column] of [
    ["money_credit_cards", "id"],
    ["money_workspace_cards", "card_id"],
    ["workspace_accounts", "id"],
    ["workspace_snapshots", "account_id"],
  ]) {
    expect((await db.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [card.id])).rows).toEqual(
      []
    );
  }
  await expect(remove(card)).rejects.toMatchObject({ status: 404 });
});

it("rejects stale versions, another owner, and manual-disabled deletions", async () => {
  const card = await create();
  await expect(remove({ ...card, version: 0 })).rejects.toMatchObject({ status: 409 });
  await expect(remove(card, randomUUID(), other)).rejects.toMatchObject({ status: 404 });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  try {
    await expect(remove(card)).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  }
  expect((await readMainTable(owner, "money_credit_cards")).some((c) => c.id === card.id)).toBe(
    true
  );
});

it("preserves paid-off card charges, linked expenses, repayments and bank balances", async () => {
  const bank = await executeMainCommand(owner, randomUUID(), {
    action: "bank.create",
    name: "Synthetic bank",
    starting_balance: 1000,
  });
  const card = await create();
  await executeMainCommand(owner, randomUUID(), {
    action: "card.charge",
    id: card.id,
    version: 1,
    amount: 20,
    date: "2026-11-26",
    tx_overrides: {},
  });
  await executeMainCommand(owner, randomUUID(), {
    action: "card.payment",
    id: card.id,
    version: 2,
    amount: 20,
    date: "2026-11-26",
    account_id: bank.id,
  });
  const tables = [
    "money_credit_card_charges",
    "money_credit_card_payments",
    "money_transactions",
    "money_accounts",
  ];
  const before = await Promise.all(tables.map((t) => readMainTable(owner, t)));
  await expect(remove({ ...card, version: 3 })).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/archive/i),
  });
  expect(await Promise.all(tables.map((t) => readMainTable(owner, t)))).toEqual(before);
});

it.each([
  "opening",
  "voided",
  "pending",
  "snapshot",
  "pdf",
  "subscription",
  "reviewed",
  "pdf-snapshot",
] as const)("preserves cards with %s evidence", async (kind) => {
  const card = await create(kind === "opening" ? { opening_balance: 1 } : {});
  if (kind === "voided" || kind === "pending")
    await db.query(
      "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,100,$4,'excluded','2026-11-26')",
      [randomUUID(), owner, card.id, kind]
    );
  if (kind === "snapshot")
    await db.query(
      "INSERT INTO workspace_snapshots(id,owner_id,account_id,amount_minor,as_of,source) VALUES($1,$2,$3,0,'2026-11-26','manual')",
      [randomUUID(), owner, card.id]
    );
  if (kind === "reviewed")
    await db.query("UPDATE workspace_snapshots SET observations='{}' WHERE account_id=$1", [
      card.id,
    ]);
  if (kind === "pdf-snapshot")
    await db.query("UPDATE workspace_snapshots SET source='pdf' WHERE account_id=$1", [card.id]);
  if (kind === "pdf")
    await db.query(
      "INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at,confirmed_account_id) VALUES($1,$2,$3,'{}',now()+interval '1 day',$4)",
      [randomUUID(), owner, randomUUID(), card.id]
    );
  if (kind === "subscription")
    await db.query(
      "INSERT INTO money_subscriptions(user_id,name,amount,payment_account_id) VALUES($1,'Synthetic',1,$2)",
      [owner, "cc:" + card.id]
    );
  await expect(remove(card)).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/archive/i),
  });
  await expect(
    withUserDb(owner, (c) =>
      c.query("SELECT public.delete_unused_main_card($1,$2)", [card.id, card.version])
    )
  ).rejects.toMatchObject({ code: "P0001" });
  expect(
    (await db.query("SELECT id FROM workspace_accounts WHERE id=$1", [card.id])).rowCount
  ).toBe(1);
});

it("keeps raw snapshot deletion forbidden and guards direct function calls by owner and history", async () => {
  const card = await create({ opening_balance: 1 });
  await expect(
    withUserDb(owner, (c) =>
      c.query("DELETE FROM workspace_snapshots WHERE account_id=$1", [card.id])
    )
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    withUserDb(other, (c) =>
      c.query("SELECT public.delete_unused_main_card($1,$2)", [card.id, card.version])
    )
  ).rejects.toMatchObject({ code: "P0002" });
  await expect(
    withUserDb(owner, (c) =>
      c.query("SELECT public.delete_unused_main_card($1,$2)", [card.id, card.version])
    )
  ).rejects.toMatchObject({ code: "P0001" });
});

it("preserves an adopted statement even with a zero balance and one manual snapshot", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,'Synthetic adopted','credit_card',0,'2026-11-26')",
    [id, owner]
  );
  await db.query(
    "INSERT INTO workspace_snapshots(id,owner_id,account_id,amount_minor,as_of,source,created_at) VALUES($1,$2,$3,0,'2026-11-26','manual','2026-11-25')",
    [randomUUID(), owner, id]
  );
  const card = await executeMainCommand(owner, randomUUID(), {
    action: "card.adopt",
    id,
    version: 1,
  });
  await expect(remove(card)).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/archive/i),
  });
});

it("enforces feature and version gates even through the narrow SQL permission", async () => {
  const card = await create();
  await expect(
    withUserDb(owner, (c) => c.query("SELECT public.delete_unused_main_card($1,$2)", [card.id, 0]))
  ).rejects.toMatchObject({ code: "P0001" });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  try {
    await expect(
      withUserDb(owner, (c) =>
        c.query("SELECT public.delete_unused_main_card($1,$2)", [card.id, 1])
      )
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  }
  expect(
    (
      await db.query(
        "SELECT has_function_privilege('auth_service','public.delete_unused_main_card(uuid,integer)','EXECUTE') AS allowed"
      )
    ).rows[0].allowed
  ).toBe(false);
  expect(
    (await db.query("SELECT id FROM money_credit_cards WHERE id=$1", [card.id])).rowCount
  ).toBe(1);
});

it.each(["bank", "card"] as const)(
  "protects %s subscription references with uppercase UUID text",
  async (kind) => {
    const resource = await executeMainCommand(owner, randomUUID(), {
      action: kind + ".create",
      name: "Synthetic uppercase reference",
    });
    const reference = (kind === "card" ? "cc:" : "") + resource.id.toUpperCase();
    const sub = await executeMainCommand(owner, randomUUID(), {
      action: "subscription.create",
      name: "Synthetic schedule",
      amount: "1.00",
      next_billing: "2026-12-01",
      payment_account_id: reference,
    });
    await expect(
      executeMainCommand(owner, randomUUID(), {
        action: kind + ".delete",
        id: resource.id,
        version: 1,
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/archive/i) });
    expect(
      (await readMainTable(owner, "money_subscriptions")).find((row) => row.id === sub.id)
        ?.payment_account_id
    ).toBe(reference);
  }
);
