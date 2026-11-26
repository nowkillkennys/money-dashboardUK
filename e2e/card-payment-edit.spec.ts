import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  username = "main-browser-" + owner,
  password = randomBytes(24).toString("hex");
test.beforeAll(async () => {
  const salt = randomBytes(16);
  const hash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
  await admin.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [
    owner,
    username,
    hash,
  ]);
});
test.afterAll(async () => {
  await admin.query("UPDATE money_transactions SET linked_charge_id=NULL WHERE user_id=$1", [
    owner,
  ]);
  await admin.query(
    "UPDATE money_credit_card_charges SET linked_transaction_id=NULL WHERE user_id=$1",
    [owner]
  );
  for (const table of [
    "money_command_journal",
    "money_command_receipts",
    "money_workspace_cards",
    "money_subscriptions",
    "money_credit_card_payments",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_cards",
    "money_accounts",
    "money_settings",
  ])
    await admin.query(`DELETE FROM ${table} WHERE user_id=$1`, [owner]);
  for (const table of [
    "workspace_snapshots",
    "workspace_command_receipts",
    "workspace_payments",
    "workspace_pdf_previews",
    "workspace_features",
    "workspace_accounts",
  ])
    await admin.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
  await admin.query("DELETE FROM workspace_users WHERE id=$1", [owner]);
  await admin.end();
});
test("repayment edits move the original bank outflow once and retain stale drafts", async ({
  page,
}) => {
  const command = async (data: Record<string, unknown>) => {
    const r = await page.request.post("/api/workspace/main-commands", {
      headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
      data,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const data = async () => (await page.request.get("/api/workspace/main-data")).json();
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const initial = page.waitForResponse(
    (r) => r.url().endsWith("/api/workspace/main-data") && r.ok()
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await (await initial).finished();
  const a = await command({
    action: "bank.create",
    name: "Original bank",
    starting_balance: "100.00",
  });
  const b = await command({
    action: "bank.create",
    name: "Correct bank",
    starting_balance: "200.00",
  });
  const card = await command({
    action: "card.create",
    name: "Repayment edit card",
    opening_balance: "100.00",
  });
  const payment = await command({
    action: "card.payment",
    id: card.id,
    version: 1,
    amount: "20.00",
    date: "2026-11-26",
    account_id: a.id,
  });
  await page.goto("/credit-cards");
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Payment", exact: true });
  await expect(dialog.getByLabel("Paid from", { exact: true })).toHaveValue(a.id);
  await dialog.getByLabel("Amount", { exact: true }).fill("30.25");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-25");
  await dialog.getByLabel("Paid from", { exact: true }).selectOption(b.id);
  let dropped = false;
  const keys: string[] = [];
  await page.route("**/api/workspace/main-commands", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.action === "payment.update"
    ) {
      keys.push(route.request().headers()["idempotency-key"]);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        return route.abort("failed");
      }
    }
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit payment", exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/workspace/main-commands");
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit payment", exact: true })).toBeVisible();
  let current = await data();
  expect(current.balances[a.id]).toBe(100);
  expect(current.balances[b.id]).toBe(169.75);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("69.75");
  expect(current.creditCardPayments).toHaveLength(1);
  expect(current.creditCardPayments[0]).toMatchObject({
    id: payment.id,
    amount: 30.25,
    date: "2026-11-25",
    account_id: b.id,
    version: 2,
  });
  expect(current.transactions).toHaveLength(0);
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("25.00");
  await dialog.getByLabel("Paid from", { exact: true }).selectOption("");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit payment", exact: true })).toBeVisible();
  current = await data();
  expect(current.balances[a.id]).toBe(100);
  expect(current.balances[b.id]).toBe(200);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("75.00");
  expect(current.creditCardPayments[0]).toMatchObject({
    id: payment.id,
    amount: 25,
    account_id: null,
    version: 3,
  });
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("15.00");
  await dialog.getByLabel("Paid from", { exact: true }).selectOption(a.id);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit payment", exact: true })).toBeVisible();
  current = await data();
  expect(current.balances[a.id]).toBe(85);
  expect(current.balances[b.id]).toBe(200);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("85.00");
  expect(current.creditCardPayments[0]).toMatchObject({
    id: payment.id,
    amount: 15,
    account_id: a.id,
    version: 4,
  });
  await page.getByRole("button", { name: "Edit payment", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("16.00");
  await dialog.getByLabel("Paid from", { exact: true }).selectOption(b.id);
  await command({
    action: "bank.update",
    id: b.id,
    version: current.accounts.find((bank: any) => bank.id === b.id).version,
    name: "Changed elsewhere",
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("16.00");
  await expect(dialog.getByLabel("Paid from", { exact: true })).toHaveValue(b.id);
  current = await data();
  expect(current.creditCardPayments[0]).toMatchObject({ amount: 15, account_id: a.id, version: 4 });
  expect(current.balances[a.id]).toBe(85);
  expect(current.balances[b.id]).toBe(200);
  expect(current.transactions).toHaveLength(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});
