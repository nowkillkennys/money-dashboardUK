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
test("original main app shares one bank, card, expense and debt ledger", async ({ page }, info) => {
  test.setTimeout(90000);
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add Account", exact: true }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Synthetic main bank");
  await page.getByLabel("Starting Balance", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Synthetic main bank", { exact: true }).first()).toBeVisible();
  await page.goto("/credit-cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).first().click();
  await page.getByLabel("Card Name", { exact: true }).fill("Synthetic main card");
  await page.getByLabel("Credit Limit", { exact: true }).fill("2000");
  await page
    .getByLabel("Linked Account (payments come from here)", { exact: true })
    .selectOption({ label: "Synthetic main bank (GBP)" });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic main card", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Charge", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("100");
  await page.locator("#charge-merchant").fill("Synthetic shop");
  await page.getByRole("button", { name: "Add Charge", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/main-data")).json()).creditCardCharges.length
    )
    .toBe(1);
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await page.getByRole("button", { name: "Custom Amount", exact: true }).click();
  await page.locator('input[type="number"]').fill("25");
  await page.getByRole("button", { name: "Pay", exact: true }).last().click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/main-data")).json()).creditCardPayments
          .length
    )
    .toBe(1);
  const data = await (await page.request.get("/api/workspace/main-data")).json();
  expect(data.accounts).toHaveLength(1);
  expect(data.creditCards).toHaveLength(1);
  expect(data.balances[data.accounts[0].id]).toBe(975);
  expect(data.transactions.filter((tx: { type: string }) => tx.type === "expense")).toHaveLength(1);
  const debts = await (await page.request.get("/api/workspace/accounts")).json();
  expect(debts.accounts[0].id).toBe(data.creditCards[0].id);
  expect(debts.accounts[0].trackedBalance).toBe("75.00");
  await page.goto("/accounts");
  await expect(page.getByText("£975.00", { exact: true }).first()).toBeVisible();
  await page.goto("/expenses");
  await expect(page.getByText("Synthetic shop", { exact: true }).first()).toBeVisible();
  await page.goto("/debts");
  await page.getByRole("button", { name: /Synthetic main card/ }).click();
  await expect(page.getByText("£75.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Credit Cards", exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("£900.00", { exact: true }).first()).toBeVisible();
  for (const path of [
    "/income",
    "/stocks",
    "/goals",
    "/subscriptions",
    "/reports",
    "/reconcile",
    "/chat",
    "/settings",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  }
  await page.goto("/");
  await expect(page.getByText("£900.00", { exact: true }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({
    path: info.outputPath("main-authenticated-synthetic.png"),
    fullPage: true,
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
