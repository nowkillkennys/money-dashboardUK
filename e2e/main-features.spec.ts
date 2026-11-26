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
test("native goals, schedules, preferences and investment records persist without duplicate cash", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== "http://browser-workspace:3000") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  const bank = await page.request.post("/api/workspace/main-commands", {
    headers: { "Idempotency-Key": randomUUID(), Origin: "http://browser-workspace:3000" },
    data: {
      action: "bank.create",
      name: "Synthetic investing cash",
      type: "investing",
      starting_balance: "1000.00",
    },
  });
  expect(bank.ok()).toBeTruthy();
  await page.goto("/goals");
  await page.getByRole("button", { name: "Add Goal", exact: true }).first().click();
  await page.getByLabel("Goal Name", { exact: true }).fill("Synthetic reserve");
  await page.getByLabel("Target Amount", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Create Goal", exact: true }).click();
  await expect(page.getByText("Synthetic reserve", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Synthetic reserve", { exact: true }).first()).toBeVisible();
  await page.goto("/subscriptions");
  await page.getByRole("button", { name: "Add Subscription", exact: true }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic scheduled bill");
  await page.getByLabel("Amount", { exact: true }).fill("12.34");
  await page.getByLabel("Next billing date", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "Add Subscription", exact: true }).last().click();
  await expect(page.getByText("Synthetic scheduled bill", { exact: true }).first()).toBeVisible();
  await page.goto("/stocks");
  await page.getByRole("button", { name: "Add position", exact: true }).click();
  await page.getByLabel("Symbol", { exact: true }).fill("SYNTH");
  await page.getByLabel("Shares", { exact: true }).fill("1.123456");
  await page.getByLabel("Total cost basis (GBP)", { exact: true }).fill("100.01");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record dividend", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record dividend", exact: true }).click();
  await page.getByLabel("Amount (GBP)", { exact: true }).fill("4.25");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-26");
  await page.getByRole("button", { name: "Save dividend", exact: true }).click();
  await expect(page.getByText("£4.25", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("£100.01", { exact: true })).toBeVisible();
  const data = await (await page.request.get("/api/workspace/main-data")).json();
  expect(data.goals).toHaveLength(1);
  expect(data.subscriptions).toHaveLength(1);
  expect(data.holdings).toHaveLength(1);
  expect(data.dividends).toHaveLength(1);
  expect(data.transactions).toHaveLength(0);
  expect(data.balances[data.accounts[0].id]).toBe(1000);
  await page.goto("/");
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText(/known cash minus debts is/)).toContainText("£1,000.00");
  await page.goto("/settings");
  await page.locator("#settings-personalization > summary").click();
  await page.getByLabel("Display Name", { exact: true }).fill("Synthetic preference");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/main-data")).json()).settings.display_name
    )
    .toBe("Synthetic preference");
  const savedSettings = (await (await page.request.get("/api/workspace/main-data")).json())
    .settings;
  const remoteSave = await page.request.post("/api/workspace/main-commands", {
    headers: { "Idempotency-Key": randomUUID(), Origin: "http://browser-workspace:3000" },
    data: {
      action: "settings.upsert",
      id: savedSettings.id,
      version: savedSettings.version,
      display_name: "Another tab",
    },
  });
  expect(remoteSave.ok()).toBeTruthy();
  if (!(await page.getByLabel("Display Name", { exact: true }).isVisible()))
    await page.locator("#settings-personalization > summary").click();
  await page.getByLabel("Display Name", { exact: true }).fill("Stale form");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Record changed. Reload before saving/)).toBeVisible();
  await expect(page.getByLabel("Display Name", { exact: true })).toHaveValue("Stale form");
  expect(
    (await (await page.request.get("/api/workspace/main-data")).json()).settings.display_name
  ).toBe("Another tab");
  await page.goto("/stocks");
  await page.evaluate(() => localStorage.setItem("money_show_balances", "0"));
  await page.reload();
  await expect(page.getByText("£100.01", { exact: true })).toHaveCount(0);
  await expect(page.getByText("£4.25", { exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("money_show_balances"));
  for (const route of ["/goals", "/subscriptions", "/stocks", "/settings", "/reports"]) {
    await page.goto(route);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      )
      .toBe(true);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
