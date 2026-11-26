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
    "money_credit_card_payments",
    "money_transactions",
    "money_credit_card_charges",
    "money_credit_cards",
    "money_goal_accounts",
    "money_goals",
    "money_allocation_plans",
    "money_subscriptions",
    "money_dividends",
    "money_holdings",
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
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/workspace/main-data") && r.ok()
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await loaded;
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
}
async function command(page: import("@playwright/test").Page, data: Record<string, unknown>) {
  const response = await page.request.post("/api/workspace/main-commands", {
    headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
    data,
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function data(page: import("@playwright/test").Page) {
  return (await page.request.get("/api/workspace/main-data")).json();
}

test("bank and card subscription payments advance one cycle and retry a lost response once", async ({
  page,
}) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== "http://browser-workspace:3000") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await signIn(page);
  const bank = await command(page, {
    action: "bank.create",
    name: "Subscription bank",
    starting_balance: "100.00",
  });
  const card = await command(page, { action: "card.create", name: "Subscription card" });
  const bankSchedule = await command(page, {
    action: "subscription.create",
    name: "Sample mobile plan",
    amount: "12.34",
    frequency: "monthly",
    next_billing: "2027-01-31",
    payment_account_id: bank.id,
  });
  const cardSchedule = await command(page, {
    action: "subscription.create",
    name: "Sample streaming",
    amount: "7.89",
    frequency: "monthly",
    next_billing: "2027-01-31",
    payment_account_id: `cc:${card.id}`,
  });
  const before = await data(page);
  expect(before.balances[bank.id]).toBe(100);
  const keys: string[] = [];
  let dropped = false;
  await page.route("**/api/workspace/main-commands", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON()?.action === "subscription.pay") {
      keys.push(request.headers()["idempotency-key"]);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        return route.abort("failed");
      }
    }
    return route.continue();
  });
  await page.goto("/subscriptions");
  const mobile = page.getByRole("row").filter({ hasText: "Sample mobile plan" });
  await mobile.getByRole("button", { name: "Mark as Paid", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mark as Paid", exact: true });
  await expect(dialog.getByLabel("Pay from", { exact: true })).toHaveValue(bank.id);
  await dialog.getByLabel("Payment date", { exact: true }).fill("2027-01-31");
  await expect(dialog).toContainText("28 Feb 2027");
  await dialog.getByRole("button", { name: "Mark as Paid", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(mobile).toContainText("28 Feb");
  expect(dropped).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/api/workspace/main-commands");
  let current = await data(page);
  expect(current.balances[bank.id]).toBe(87.66);
  expect(current.transactions.filter((t: any) => t.merchant === "Sample mobile plan")).toHaveLength(
    1
  );
  expect(current.subscriptions.find((s: any) => s.id === bankSchedule.id).next_billing).toBe(
    "2027-02-28"
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Sample streaming" })
    .getByRole("button", { name: "Mark as Paid", exact: true })
    .click();
  await expect(dialog.getByLabel("Pay from", { exact: true })).toHaveValue(`cc:${card.id}`);
  await dialog.getByLabel("Payment date", { exact: true }).fill("2027-01-31");
  await dialog.getByRole("button", { name: "Mark as Paid", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Sample streaming" })).toContainText(
    "28 Feb"
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Subscriptions", exact: true })).toBeVisible();
  current = await data(page);
  expect(current.balances[bank.id]).toBe(87.66);
  expect(current.creditCards.find((c: any) => c.id === card.id).tracked_balance).toBe("7.89");
  const charges = current.creditCardCharges.filter((c: any) => c.card_id === card.id);
  expect(charges).toHaveLength(1);
  expect(
    current.transactions.filter((t: any) => t.linked_charge_id === charges[0].id)
  ).toHaveLength(1);
  expect(current.subscriptions.find((s: any) => s.id === cardSchedule.id).next_billing).toBe(
    "2027-02-28"
  );
  expect(external).toEqual([]);
});

test("a stale schedule save shows an error and preserves payment inputs without cash movement", async ({
  page,
}) => {
  await signIn(page);
  const bank = await command(page, {
    action: "bank.create",
    name: "Stale payment bank",
    starting_balance: "50.00",
  });
  const schedule = await command(page, {
    action: "subscription.create",
    name: "Sample membership",
    amount: "5.00",
    frequency: "monthly",
    next_billing: "2027-02-28",
    payment_account_id: bank.id,
  });
  await page.goto("/subscriptions");
  await page
    .getByRole("row")
    .filter({ hasText: "Sample membership" })
    .getByRole("button", { name: "Mark as Paid", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Mark as Paid", exact: true });
  await dialog.getByLabel("Payment date", { exact: true }).fill("2027-03-01");
  await command(page, {
    action: "subscription.update",
    id: schedule.id,
    version: 1,
    amount: "6.00",
  });
  await dialog.getByRole("button", { name: "Mark as Paid", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Payment date", { exact: true })).toHaveValue("2027-03-01");
  await expect(dialog.getByLabel("Pay from", { exact: true })).toHaveValue(bank.id);
  const current = await data(page);
  expect(current.balances[bank.id]).toBe(50);
  expect(current.transactions.filter((t: any) => t.merchant === "Sample membership")).toHaveLength(
    0
  );
  expect(current.subscriptions.find((s: any) => s.id === schedule.id).next_billing).toBe(
    "2027-02-28"
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("money_show_balances", "0"));
  await page.reload();
  await page
    .getByRole("row")
    .filter({ hasText: "Sample membership" })
    .getByRole("button", { name: "Mark as Paid", exact: true })
    .click();
  await expect(dialog).not.toContainText("£6.00");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await command(page, {
    action: "subscription.create",
    name: "Calendar boundary",
    amount: "1.00",
    frequency: "monthly",
    next_billing: "9999-12-31",
    payment_account_id: bank.id.toUpperCase(),
  });
  await page.reload();
  await page
    .getByRole("row")
    .filter({ hasText: "Calendar boundary" })
    .getByRole("button", { name: "Mark as Paid", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Pay from", { exact: true })).toHaveValue(bank.id);
  await expect(dialog.getByRole("button", { name: "Mark as Paid", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => localStorage.removeItem("money_show_balances"));
});
