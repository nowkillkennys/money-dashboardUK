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
test("offers permanent deletion and reversible archive without losing history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const initialData = page.waitForResponse(
    (r) => r.url().endsWith("/api/workspace/main-data") && r.ok()
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await initialData;
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
    page.getByRole("button", { name: "Permanently delete card", exact: true })
  ).toBeDisabled();
  await page.getByLabel("Confirm card name", { exact: true }).fill("Synthetic unused card");
  await page.getByRole("button", { name: "Permanently delete card", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: 'Deleted "Synthetic unused card"' })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Synthetic unused card", exact: true })
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Credit Cards", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Credit Cards", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic history card", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("button", { name: "Archive card", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Remove credit card" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Credit Cards", exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: 'Archived "Synthetic history card"' })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Synthetic history card", exact: true })
  ).toHaveCount(0);
  await page.reload();
  const archived = await (await page.request.get("/api/workspace/main-data")).json();
  expect(archived.creditCards[0].archived).toBe(true);
  expect(archived.creditCards[0].tracked_balance).toBe("10.00");
  expect(archived.creditCardCharges).toHaveLength(1);
  await page.getByLabel("Show archived", { exact: true }).check();
  await expect(page.getByRole("heading", { name: /^Synthetic history card/ })).toBeVisible();
  await page.getByRole("button", { name: "Restore card", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/main-data")).json()).creditCards[0].archived
    )
    .toBe(false);
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("button", { name: "Archive card", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Remove credit card" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Credit Cards", exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: 'Archived "Synthetic history card"' })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("account and card keyboard ordering persists and a rejected save restores order", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const initialData = page.waitForResponse(
    (r) => r.url().endsWith("/api/workspace/main-data") && r.ok()
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await initialData;
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

test("permanent removal preserves bank cash and unlinks subscriptions after explicit confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const initialData = page.waitForResponse(
    (r) => r.url().endsWith("/api/workspace/main-data") && r.ok()
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await initialData;
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  const command = async (data: Record<string, unknown>) => {
    const r = await page.request.post("/api/workspace/main-commands", {
      headers: { Origin: "http://browser-workspace:3000", "Idempotency-Key": randomUUID() },
      data,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const bank = await command({
    action: "bank.create",
    name: "Removal bank",
    starting_balance: 1000,
  });
  const card = await command({
    action: "card.create",
    name: "Permanent sample",
    opening_balance: 100,
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
    account_id: bank.id,
    date: "2026-11-26",
  });
  const sub = await command({
    action: "subscription.create",
    name: "Sample streaming",
    amount: 5,
    next_billing: "2026-12-01",
    payment_account_id: `cc:${card.id}`,
  });
  await page.goto("/credit-cards");
  const cardPanel = page
    .locator("div.rounded-2xl")
    .filter({ has: page.getByRole("heading", { name: "Permanent sample", exact: true }) })
    .first();
  await cardPanel.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove credit card" });
  await expect(dialog).toContainText("£90.00");
  await expect(dialog).toContainText("1 bank-funded repayments");
  if (test.info().project.name === "laptop")
    await page.screenshot({ path: "test-results/card-removal-preview.png", fullPage: true });
  await page.getByLabel("Confirm card name", { exact: true }).fill("wrong");
  await expect(
    dialog.getByRole("button", { name: "Permanently delete card", exact: true })
  ).toBeDisabled();
  await command({ action: "subscription.update", id: sub.id, version: 1, amount: 6 });
  await page.getByLabel("Confirm card name", { exact: true }).fill("Permanent sample");
  await dialog.getByRole("button", { name: "Permanently delete card", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("details changed");
  await dialog.getByRole("button", { name: "Reload removal details", exact: true }).click();
  await expect(page.getByLabel("Confirm card name", { exact: true })).toHaveValue("");
  await page.getByLabel("Confirm card name", { exact: true }).fill("Permanent sample");
  await dialog.getByRole("button", { name: "Permanently delete card", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Permanent sample", exact: true })).toHaveCount(0);
  const data = await (await page.request.get("/api/workspace/main-data")).json();
  expect(data.balances[bank.id]).toBe(970);
  expect(data.creditCards.some((c: any) => c.id === card.id)).toBe(false);
  expect(data.subscriptions.find((s: any) => s.id === sub.id).payment_account_id).toBeNull();
  expect(
    data.transactions.filter((t: any) => t.type === "transfer" && t.from_account_id === bank.id)
  ).toHaveLength(1);
  await page.goto("/accounts");
  const preserved = page.getByRole("row").filter({ hasText: "Preserved payment · Read only" });
  await expect(preserved).toHaveCount(1);
  await expect(preserved.getByRole("button", { name: "Edit transfer", exact: true })).toHaveCount(
    0
  );
  await expect(preserved.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});
