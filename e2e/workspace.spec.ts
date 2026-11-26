import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  username = "browser-" + owner,
  password = randomBytes(24).toString("hex");
function syntheticPdf(lines: string[]) {
  const stream =
    "BT /F1 11 Tf 50 750 Td " +
    lines
      .map((line, i) => (i ? "0 -16 Td " : "") + "(" + line.replace(/[()\\]/g, "\\$&") + ") Tj")
      .join("\n") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test.beforeAll(async () => {
  const salt = randomBytes(16);
  const hash =
    "scrypt$" +
    salt.toString("hex") +
    "$" +
    scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString(
      "hex"
    );
  await admin.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [
    owner,
    username,
    hash,
  ]);
});
test.afterAll(async () => {
  await admin.query("DELETE FROM money_command_journal WHERE user_id=$1", [owner]);
  await admin.query("DELETE FROM money_command_receipts WHERE user_id=$1", [owner]);
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
test("authenticated debt create, payment, reload and explicit reconciliation", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    if (new URL(r.request().url()).origin !== "http://browser-workspace:3000") {
      external.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  await page.goto("/workspace");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your debts" })).toBeVisible();
  await page.getByText("Add debt account", { exact: true }).click();
  await page.getByLabel("Account name").fill("Synthetic loan");
  await page.getByRole("combobox", { name: /Debt type/ }).selectOption("loan");
  await page.getByLabel("Reported balance (£)", { exact: true }).fill("500.00");
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic loan/ }).click();
  await page.getByText("Record a debt-only payment", { exact: true }).click();
  await page.getByLabel("Payment (£)", { exact: true }).fill("50.00");
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(page.getByText("£450.00").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your debts" })).toBeVisible();
  await page.getByRole("button", { name: /Synthetic loan/ }).click();
  await page.getByLabel("New reported balance (£)").fill("450.00");
  await page.getByRole("combobox", { name: /Inclusion/ }).selectOption("included");
  await page
    .getByText("I reviewed the balance, date, account, payment and charge inclusion.")
    .click();
  await page.getByRole("button", { name: "Confirm reviewed balance" }).click();
  await expect(page.getByText("£450.00").first()).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/accounts")).json()).accounts[0]
          .reportedBalance
    )
    .toBe("450.00");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await page.getByLabel("Statement PDF", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPdf([
      "SYNTHETIC TEST ONLY",
      "Statement balance 425.00",
      "Statement date 26 November 2026",
    ]),
  });
  await expect(page.getByLabel("New reported balance (£)")).toHaveValue("425.00");
  await expect(page.getByText("PDF preview · not saved to this account")).toBeVisible();
  await page.getByRole("combobox", { name: /Inclusion/ }).selectOption("included");
  await page
    .getByRole("checkbox", {
      name: "I reviewed the balance, date, account, payment and charge inclusion.",
    })
    .check();
  await page.getByRole("button", { name: "Confirm reviewed balance" }).click();
  await expect(page.getByRole("button", { name: /Synthetic loan/ })).toContainText("£425.00");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace/accounts")).json()).accounts[0].snapshots[0]
          .source
    )
    .toBe("pdf");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.getByRole("note").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/workspace-${info.project.name}.png`,
    fullPage: false,
  });
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await page.getByRole("checkbox", { name: "Manual tracking", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Manual tracking", exact: true })
  ).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Confirm reviewed balance" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Manual tracking", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Manual tracking", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect((await request.get("/api/workspace/accounts")).status()).toBe(401);
  expect(
    (
      await request.post("/api/workspace/auth/login", {
        headers: { Origin: "https://invalid.example" },
        data: { username, password },
      })
    ).status()
  ).toBe(403);
  for (const path of [
    "/api/session",
    "/api/set-pin",
    "/api/data/rest/v1/accounts",
    "/api/push/cron",
    "/api/ai/chat",
  ])
    expect((await request.get(path)).status()).toBe(403);
});
