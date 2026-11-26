import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, randomBytes, scryptSync, createHash } from "node:crypto";

const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID();
const username = "retry-" + owner;
const password = randomBytes(24).toString("hex");

test.beforeAll(async () => {
  const salt = randomBytes(16);
  const hash = "scrypt$" + salt.toString("hex") + "$" +
    scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex");
  await admin.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [owner, username, hash]);
});
test.afterAll(async () => {
  for (const table of ["workspace_snapshots", "workspace_command_receipts", "workspace_payments", "workspace_pdf_previews", "workspace_features", "workspace_accounts"])
    await admin.query(`DELETE FROM ${table} WHERE owner_id=$1`, [owner]);
  // Sessions are deleted by the user's foreign-key cascade.
  await admin.query("DELETE FROM workspace_users WHERE id=$1", [owner]);
  await admin.query("DELETE FROM workspace_login_limits WHERE bucket=$1", ["user:" + createHash("sha256").update(username).digest("hex")]);
  await admin.end();
});
async function signIn(page: Page) {
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your debts" })).toBeVisible();
}

test("lost committed payment response retries once and sign-out clears an unresolved retry", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== "http://browser-workspace:3000") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/workspace");
  await signIn(page);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await page.getByText("Add debt account", { exact: true }).click();
  await page.getByLabel("Account name").fill("Synthetic retry card");
  await page.getByLabel("Reported balance (£)", { exact: true }).fill("500.00");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const card = page.getByRole("button", { name: /Synthetic retry card/ });
  await expect(card).toContainText("£500.00");
  await card.click();
  await page.getByText("Record a payment", { exact: true }).click();

  let loseNextResponse = true;
  let returnServerError = false;
  const paymentRequests: { key: string | undefined; input: unknown }[] = [];
  await page.route("**/api/workspace/accounts", async (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "payment")
      return route.continue();
    paymentRequests.push({ key: route.request().headers()["idempotency-key"], input: route.request().postDataJSON() });
    if (!loseNextResponse) return route.continue();
    loseNextResponse = false;
    // The real server commits first; only its response to this browser is lost.
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    if (returnServerError)
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Change could not be acknowledged" }) });
    else await route.abort("failed");
  });
  await page.getByLabel("Payment (£)", { exact: true }).fill("50.00");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry change", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Manual tracking", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "PDF review", exact: true })).toBeDisabled();
  expect((await admin.query("SELECT count(*)::int AS count FROM workspace_payments WHERE owner_id=$1", [owner])).rows[0].count).toBe(1);
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(card).toContainText("£450.00");
  expect(paymentRequests).toHaveLength(2);
  expect(paymentRequests[0].key).toBeTruthy();
  expect(paymentRequests[1]).toEqual(paymentRequests[0]);
  expect((await admin.query("SELECT count(*)::int AS count FROM workspace_payments WHERE owner_id=$1", [owner])).rows[0].count).toBe(1);
  expect((await admin.query("SELECT count(*)::int AS count FROM workspace_command_receipts WHERE owner_id=$1", [owner])).rows[0].count).toBe(2);
  await page.reload();
  await expect(card).toContainText("£450.00");
  await card.click();
  await page.getByText("Record a payment", { exact: true }).click();
  loseNextResponse = true;
  returnServerError = true;
  await page.getByLabel("Payment (£)", { exact: true }).fill("25.00");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("button", { name: "Record payment", exact: true })).toBeDisabled();
  await page.getByText("Add debt account", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Manual tracking", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "PDF review", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(retry).toHaveCount(0);
  await signIn(page);
  await expect(card).toContainText("£425.00");
  await expect(retry).toHaveCount(0);
  await page.getByText("Add debt account", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add account", exact: true })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Manual tracking", exact: true })).toBeEnabled();
  expect(paymentRequests).toHaveLength(3);
  expect(paymentRequests[2].key).not.toBe(paymentRequests[0].key);
  expect((await admin.query("SELECT count(*)::int AS count FROM workspace_payments WHERE owner_id=$1", [owner])).rows[0].count).toBe(2);
  expect((await admin.query("SELECT count(*)::int AS count FROM workspace_command_receipts WHERE owner_id=$1", [owner])).rows[0].count).toBe(3);
  expect(external).toEqual([]);
});
