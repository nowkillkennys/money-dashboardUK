import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand } from "../../lib/workspace/main-repository";
import { previewMainCardRemoval } from "../../lib/workspace/main-card-deletion";
import { mainData } from "../../lib/workspace/main-data";
import { withUserDb } from "../../lib/workspace/db";
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
    "money_workspace_cards",
    "money_subscriptions",
    "money_credit_card_payments",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_cards",
    "money_accounts",
    "money_net_worth_snapshots",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${t} WHERE user_id=ANY($1::uuid[])`, [[owner, other]]);
  for (const t of [
    "workspace_pdf_previews",
    "workspace_snapshots",
    "workspace_payments",
    "workspace_accounts",
    "workspace_command_receipts",
    "workspace_features",
  ])
    await db.query(`DELETE FROM ${t} WHERE owner_id=ANY($1::uuid[])`, [[owner, other]]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, other]]);
  await db.end();
});
const command = (body: any, key = randomUUID(), who = owner) => executeMainCommand(who, key, body);
const create = () =>
  command({ action: "card.create", name: "Synthetic permanent card", opening_balance: 100 });
const deletion = (p: any) => ({
  action: "card.delete",
  id: p.id,
  version: p.version,
  mode: "permanent",
  confirmation_name: p.name,
  preview_token: p.previewToken,
});
it("previews dependencies, removes history, preserves bank outflow and subscriptions, replays receipt", async () => {
  const card = await create();
  const bank = await command({
    action: "bank.create",
    name: "Synthetic bank",
    starting_balance: 1000,
  });
  await command({
    action: "card.charge",
    id: card.id,
    version: 1,
    amount: 20,
    date: "2026-11-26",
    tx_overrides: {},
  });
  await command({
    action: "card.payment",
    id: card.id,
    version: 2,
    amount: 30,
    date: "2026-11-26",
    account_id: bank.id,
  });
  await command({
    action: "subscription.create",
    name: "Synthetic schedule",
    amount: 1,
    next_billing: "2026-12-01",
    payment_account_id: "cc:" + card.id.toUpperCase(),
  });
  await db.query(
    "INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at,confirmed_account_id) VALUES($1,$2,$3,'{}',now(),$4)",
    [randomUUID(), owner, randomUUID(), card.id]
  );
  const p = await previewMainCardRemoval(owner, card.id);
  expect(p).toMatchObject({
    version: 3,
    trackedBalance: "90.00",
    reconciliationNeeded: false,
    charges: 1,
    linkedExpenses: 1,
    payments: 1,
    bankPayments: 1,
    snapshots: 1,
    pdfImports: 1,
    subscriptions: 1,
  });
  const before = await mainData(owner, "synthetic");
  const pay = before.creditCardPayments.find((p: any) => p.card_id === card.id);
  const key = randomUUID(),
    result = await command(deletion(p), key);
  expect(await command(deletion(p), key)).toEqual(result);
  const after = await mainData(owner, "synthetic");
  expect(after.balances[bank.id]).toBe(before.balances[bank.id]);
  expect(after.creditCards.some((c: any) => c.id === card.id)).toBe(false);
  expect(after.transactions.find((t: any) => t.id === pay.id)).toMatchObject({
    type: "transfer",
    from_account_id: bank.id,
    to_account_id: null,
    amount: 30,
  });
  expect(after.subscriptions.find((s: any) => s.name === "Synthetic schedule")).toMatchObject({
    payment_account_id: null,
    version: 2,
  });
  for (const [t, col] of [
    ["workspace_accounts", "id"],
    ["workspace_snapshots", "account_id"],
    ["workspace_payments", "account_id"],
    ["workspace_pdf_previews", "confirmed_account_id"],
    ["money_workspace_cards", "card_id"],
    ["money_credit_card_charges", "card_id"],
  ])
    expect((await db.query(`SELECT 1 FROM ${t} WHERE ${col}=$1`, [card.id])).rowCount).toBe(0);
});
it("rejects wrong confirmation, stale dependencies, owner, disabled feature and extra fields atomically", async () => {
  const card = await create(),
    p = await previewMainCardRemoval(owner, card.id);
  await expect(command({ ...deletion(p), confirmation_name: "wrong" })).rejects.toMatchObject({
    status: 400,
  });
  await expect(command({ ...deletion(p), amount: 1 })).rejects.toMatchObject({ status: 400 });
  await expect(previewMainCardRemoval(other, card.id)).rejects.toMatchObject({ status: 404 });
  await expect(command(deletion(p), randomUUID(), other)).rejects.toMatchObject({ status: 404 });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  await expect(command(deletion(p))).rejects.toMatchObject({ status: 403 });
  await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  await command({
    action: "subscription.create",
    name: "New dependency",
    amount: 1,
    next_billing: "2026-12-01",
    payment_account_id: "cc:" + card.id,
  });
  await expect(command(deletion(p))).rejects.toMatchObject({ status: 409 });
  await expect(
    withUserDb(owner, (c) =>
      c.query("SELECT public.permanently_delete_main_card($1,$2,$3,$4)", [
        card.id,
        p.version,
        p.name,
        p.previewToken,
      ])
    )
  ).rejects.toMatchObject({ code: "P0001" });
  const fresh = await previewMainCardRemoval(owner, card.id);
  await expect(
    withUserDb(owner, (c) =>
      c.query("SELECT public.permanently_delete_main_card($1,$2,$3,$4)", [
        card.id,
        fresh.version,
        "wrong",
        fresh.previewToken,
      ])
    )
  ).rejects.toMatchObject({ code: "22023" });
  await expect(command({ ...deletion(fresh), version: 0 })).rejects.toMatchObject({ status: 409 });
  await command(deletion(fresh));
});

it("preserves unrelated and historical aggregate rows and handles payment-ID collisions and non-bank credits", async () => {
  const card = await create(),
    unrelated = await create();
  const bank = await command({
    action: "bank.create",
    name: "Collision bank",
    starting_balance: 200,
  });
  const payment = await command({
    action: "card.payment",
    id: card.id,
    version: 1,
    amount: 10,
    date: "2026-11-26",
    account_id: bank.id,
  });
  await command({ action: "card.payment", id: card.id, version: 2, amount: 5, date: "2026-11-26" });
  await db.query(
    "INSERT INTO money_transactions(id,user_id,type,amount,date,account_id) VALUES($1,$2,'income',7,'2026-11-26',$3)",
    [payment.id, owner, bank.id]
  );
  await db.query(
    "INSERT INTO money_net_worth_snapshots(user_id,date,cash_base,holdings_base,dividends_base,total_base,base_currency) VALUES($1,'2026-11-26',200,0,0,200,'GBP')",
    [owner]
  );
  await db.query(
    "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,100,'posted','unresolved','2026-11-26')",
    [randomUUID(), owner, card.id]
  );
  const preview = await previewMainCardRemoval(owner, card.id);
  expect(preview).toMatchObject({
    trackedBalance: null,
    reconciliationNeeded: true,
    payments: 3,
    bankPayments: 1,
  });
  const before = await mainData(owner, "test");
  await command(deletion(preview));
  const after = await mainData(owner, "test");
  expect(after.netWorthSnapshots).toEqual(before.netWorthSnapshots);
  expect(after.creditCards.find((c: any) => c.id === unrelated.id)).toEqual(
    before.creditCards.find((c: any) => c.id === unrelated.id)
  );
  expect(after.balances[bank.id]).toBe(before.balances[bank.id]);
  expect(after.transactions.find((t: any) => t.id === payment.id)).toMatchObject({
    type: "income",
    amount: 7,
  });
  expect(after.transactions.filter((t: any) => t.from_account_id === bank.id)).toHaveLength(1);
});

it("enforces direct SQL owner, feature and version gates without broad history-delete privileges", async () => {
  const card = await create(),
    p = await previewMainCardRemoval(owner, card.id);
  const direct = (who: string, version = p.version) =>
    withUserDb(who, (c) =>
      c.query("SELECT public.permanently_delete_main_card($1,$2,$3,$4)", [
        card.id,
        version,
        p.name,
        p.previewToken,
      ])
    );
  await expect(direct(other)).rejects.toMatchObject({ code: "P0002" });
  await expect(direct(owner, 0)).rejects.toMatchObject({ code: "P0001" });
  await db.query("UPDATE workspace_features SET manual=false WHERE owner_id=$1", [owner]);
  try {
    await expect(direct(owner)).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("UPDATE workspace_features SET manual=true WHERE owner_id=$1", [owner]);
  }
  await expect(
    withUserDb(owner, (c) =>
      c.query("DELETE FROM workspace_snapshots WHERE account_id=$1", [card.id])
    )
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await db.query(
        "SELECT has_function_privilege('auth_service','public.permanently_delete_main_card(uuid,integer,text,text)','EXECUTE') AS allowed"
      )
    ).rows[0].allowed
  ).toBe(false);
  await expect(previewMainCardRemoval(owner, "invalid")).rejects.toMatchObject({ status: 400 });
  await expect(
    command({ action: "card.update", id: card.id, version: 1, mode: "permanent" })
  ).rejects.toMatchObject({ status: 400 });
});

it("protects preserved payments from edits and deletion while normal transfers remain editable", async () => {
  const card = await create();
  const bank = await command({
    action: "bank.create",
    name: "Protected payment bank",
    starting_balance: 200,
  });
  const destination = await command({ action: "bank.create", name: "Normal destination" });
  await command({
    action: "card.payment",
    id: card.id,
    version: 1,
    amount: 10,
    date: "2026-11-26",
    account_id: bank.id,
  });
  await command(deletion(await previewMainCardRemoval(owner, card.id)));
  const before = await mainData(owner, "test");
  const preserved = before.transactions.find((t: any) => t.from_account_id === bank.id);
  expect(preserved.preserved_card_payment).toBe(true);
  for (const action of ["transaction.update", "transaction.delete"]) {
    await expect(
      command({
        action,
        id: preserved.id,
        version: preserved.version,
        ...(action.endsWith("update") ? { to_account_id: destination.id, amount: 20 } : {}),
      })
    ).rejects.toMatchObject({
      status: 409,
      message: "Preserved card payment records cannot be edited or deleted",
    });
  }
  expect((await mainData(owner, "test")).balances).toEqual(before.balances);
  await expect(
    command({
      action: "transaction.create",
      type: "transfer",
      from_account_id: bank.id,
      to_account_id: destination.id,
      amount: 1,
      date: "2026-11-26",
      preserved_card_payment: true,
    })
  ).rejects.toMatchObject({ status: 400 });
  const transfer = await command({
    action: "transaction.create",
    type: "transfer",
    from_account_id: bank.id,
    to_account_id: destination.id,
    amount: 1,
    date: "2026-11-26",
  });
  expect(transfer.row.preserved_card_payment).toBe(false);
  const updated = await command({
    action: "transaction.update",
    id: transfer.id,
    version: transfer.version,
    amount: 2,
  });
  await command({ action: "transaction.delete", id: updated.id, version: updated.version });
  expect((await mainData(owner, "test")).balances).toEqual(before.balances);
});
