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
test("editing a card charge saves its linked expense once and keeps stale inputs visible", async ({
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
  const bank = await command({
    action: "bank.create",
    name: "Charge edit bank",
    starting_balance: "100.00",
  });
  const card = await command({ action: "card.create", name: "Charge edit card" });
  const charge = await command({
    action: "card.charge",
    id: card.id,
    version: 1,
    amount: "20.00",
    date: "2026-11-26",
    merchant: "Sample purchase",
    notes: "Original note",
    tx_overrides: {},
  });
  await page.goto("/credit-cards");
  await page.getByRole("button", { name: "Edit charge", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Charge", exact: true });
  await dialog.getByLabel("Amount", { exact: true }).fill("30.25");
  await dialog.getByLabel("Date", { exact: true }).fill("2026-11-25");
  await dialog.getByLabel("Notes", { exact: true }).fill("Corrected purchase note");
  await dialog.getByRole("checkbox", { name: "Shared expense", exact: true }).check();
  await dialog.getByLabel("Your share (%)", { exact: true }).fill("25");
  await dialog.getByLabel("Shared with", { exact: true }).fill("Synthetic friend");
  await dialog.getByRole("checkbox", { name: "Exclude from monthly totals", exact: true }).check();
  let dropped = false;
  const keys: string[] = [];
  await page.route("**/api/workspace/main-commands", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.action === "charge.update"
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
  await expect(page.getByRole("heading", { name: "Credit Cards", exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/workspace/main-commands");
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit charge", exact: true })).toBeVisible();
  let current = await data();
  expect(current.balances[bank.id]).toBe(100);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("30.25");
  expect(current.creditCardCharges).toHaveLength(1);
  const saved = current.creditCardCharges[0];
  expect(saved).toMatchObject({
    id: charge.id,
    amount: 30.25,
    date: "2026-11-25",
    notes: "Corrected purchase note",
    version: 2,
  });
  const expense = current.transactions.filter((t: any) => t.linked_charge_id === charge.id);
  expect(expense).toHaveLength(1);
  expect(expense[0]).toMatchObject({
    amount: 30.25,
    date: "2026-11-25",
    notes: "Corrected purchase note",
    personal_share_percent: 25,
    shared_with: "Synthetic friend",
    exclude_from_monthly: true,
    version: 2,
  });
  expect(saved.linked_transaction_id).toBe(expense[0].id);
  await page.getByRole("button", { name: "Edit charge", exact: true }).click();
  await dialog.getByLabel("Amount", { exact: true }).fill("35.50");
  await dialog.getByLabel("Notes", { exact: true }).fill("Keep this draft");
  const cardVersion = current.creditCards.find((c: any) => c.id === card.id).version;
  await command({
    action: "card.update",
    id: card.id,
    version: cardVersion,
    name: "Updated in another tab",
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue("35.50");
  await expect(dialog.getByLabel("Notes", { exact: true })).toHaveValue("Keep this draft");
  current = await data();
  expect(current.creditCardCharges[0]).toMatchObject({
    amount: 30.25,
    notes: "Corrected purchase note",
    version: 2,
  });
  expect(current.transactions.find((t: any) => t.id === expense[0].id).amount).toBe(30.25);
  expect(current.balances[bank.id]).toBe(100);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const standalone = await command({
    action: "card.charge",
    id: card.id,
    version: current.creditCards.find((c: any) => c.id === card.id).version,
    amount: "5.00",
    date: "2026-11-26",
    merchant: "Standalone purchase",
  });
  await page.reload();
  await page
    .getByRole("row")
    .filter({ hasText: "Standalone purchase" })
    .getByRole("button", { name: "Edit charge", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Spending preferences", exact: true })
  ).toHaveCount(0);
  await dialog.getByLabel("Amount", { exact: true }).fill("10.00");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit charge", exact: true }).first()
  ).toBeVisible();
  current = await data();
  expect(current.creditCardCharges.find((c: any) => c.id === standalone.id)).toMatchObject({
    amount: 10,
    linked_transaction_id: null,
    version: 2,
  });
  expect(current.transactions).toHaveLength(1);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("40.25");
});
