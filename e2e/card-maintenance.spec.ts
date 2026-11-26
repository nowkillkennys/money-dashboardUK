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
test("deletes an unused card from both views and explains protected history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  await page.goto("/credit-cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).first().click();
  await page.getByLabel("Card Name", { exact: true }).fill("Synthetic unused card");
  await page.getByLabel("Credit Limit", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic unused card", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Synthetic unused card", exact: true })
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Synthetic unused card", exact: true })
  ).toHaveCount(0);
  expect((await (await page.request.get("/api/workspace/accounts")).json()).accounts).toHaveLength(
    0
  );
  const response = await page.request.post("/api/workspace/main-commands", {
    headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
    data: { action: "card.create", name: "Synthetic history card", credit_limit: "500.00" },
  });
  expect(response.ok()).toBeTruthy();
  const card = await response.json();
  expect(
    (
      await page.request.post("/api/workspace/main-commands", {
        headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
        data: {
          action: "card.charge",
          id: card.id,
          version: 1,
          amount: "10.00",
          date: "2026-11-26",
        },
      })
    ).ok()
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /archive/i })).toContainText(/archive/i);
  await expect(
    page.getByRole("heading", { name: "Synthetic history card", exact: true })
  ).toBeVisible();
  await page.reload();
  const data = await (await page.request.get("/api/workspace/main-data")).json();
  expect(data.creditCards).toHaveLength(1);
  expect(data.creditCardCharges).toHaveLength(1);
  expect(data.creditCards[0].tracked_balance).toBe("10.00");
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit card to archive", exact: true }).click();
  await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await page.reload();
  const archived = await (await page.request.get("/api/workspace/main-data")).json();
  expect(archived.creditCards[0].archived).toBe(true);
  expect(archived.creditCards[0].tracked_balance).toBe("10.00");
  expect(archived.creditCardCharges).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("account and card keyboard ordering persists and a rejected save restores order", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  for (const [kind, route, collection] of [
    ["bank", "/accounts", "accounts"],
    ["card", "/credit-cards", "creditCards"],
  ] as const) {
    for (const name of ["Order Alpha", "Order Beta"]) {
      const r = await page.request.post("/api/workspace/main-commands", {
        headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
        data: { action: kind + ".create", name },
      });
      expect(r.ok()).toBeTruthy();
    }
    await page.goto(route);
    const before = (await (await page.request.get("/api/workspace/main-data")).json())[collection];
    const handles = page.getByRole("button", { name: "Drag to reorder", exact: true });
    await expect(handles.nth(1)).toBeVisible();
    const a = await handles.nth(0).boundingBox(),
      b = await handles.nth(1).boundingBox();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await expect(handles.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(handles.nth(0)).toBeFocused();
    // Allow the sensor to attach its document key listener and measure the grid.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.keyboard.press(Math.abs(b!.y - a!.y) < 40 ? "ArrowRight" : "ArrowDown");
    await expect(page.getByRole("status")).toContainText(`over droppable area ${before[1].id}`);
    await page.keyboard.press("Space");
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/workspace/main-data")).json())[collection][0].id
      )
      .toBe(before[1].id);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Order Beta", exact: true })).toBeVisible();
    expect(
      (await (await page.request.get("/api/workspace/main-data")).json())[collection][0].id
    ).toBe(before[1].id);
    let blocked = false;
    await page.route("**/api/workspace/main-commands", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.action === "ordering.set"
      ) {
        blocked = true;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic stale ordering" }),
        });
      }
      return route.continue();
    });
    const c = await handles.nth(0).boundingBox(),
      d = await handles.nth(1).boundingBox();
    await handles.nth(0).focus();
    await page.keyboard.press("Space");
    await expect(handles.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(handles.nth(0)).toBeFocused();
    // Allow the sensor to attach its document key listener and measure the grid.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.keyboard.press(Math.abs(d!.y - c!.y) < 40 ? "ArrowRight" : "ArrowDown");
    await expect(page.getByRole("status")).toContainText(`over droppable area ${before[0].id}`);
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic stale ordering" })
    ).toContainText("Synthetic stale ordering");
    expect(blocked).toBe(true);
    expect(
      (await (await page.request.get("/api/workspace/main-data")).json())[collection][0].id
    ).toBe(before[1].id);
    await page.unroute("**/api/workspace/main-commands");
  }
});
