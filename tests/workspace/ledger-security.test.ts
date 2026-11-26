import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { executeCommand, listAccounts } from "../../lib/workspace/ledger";
import { withUserDb } from "../../lib/workspace/db";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owner = randomUUID(),
  foreign = randomUUID();
const ids: string[] = [];
async function create() {
  const result = await executeCommand(owner, randomUUID(), {
    action: "create",
    name: "Synthetic atomicity test",
    kind: "loan",
    amount: "100.00",
    asOf: "2026-01-01",
  });
  ids.push(result.id);
  return result.id;
}
async function account(id: string) {
  return (await listAccounts(owner)).find((a) => a.id === id)!;
}
beforeAll(async () => {
  for (const id of [owner, foreign])
    await admin.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [
      id,
      "test-" + id,
      "not-a-valid-login",
    ]);
});
afterAll(async () => {
  for (const table of [
    "workspace_snapshots",
    "workspace_payments",
    "workspace_command_receipts",
    "workspace_pdf_previews",
    "workspace_accounts",
    "workspace_features",
  ])
    await admin.query(`DELETE FROM ${table} WHERE owner_id=ANY($1::uuid[])`, [[owner, foreign]]);
  await admin.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[owner, foreign]]);
  await admin.end();
});
describe("transactional command security", () => {
  it("rolls back overpayment, version and receipt together then permits corrected same key", async () => {
    const id = await create(),
      key = randomUUID();
    const input = {
      action: "payment",
      accountId: id,
      version: 1,
      amount: "100.01",
      status: "posted",
      paidOn: "2026-01-02",
    };
    await expect(executeCommand(owner, key, input)).rejects.toMatchObject({ status: 400 });
    const row = await account(id);
    expect(row.version).toBe(1);
    expect(row.payments).toHaveLength(0);
    expect(row.trackedBalance).toBe("100.00");
    expect(
      (
        await admin.query(
          "SELECT key FROM workspace_command_receipts WHERE owner_id=$1 AND key=$2",
          [owner, key]
        )
      ).rowCount
    ).toBe(0);
    await executeCommand(owner, key, { ...input, amount: "10.00" });
    expect((await account(id)).trackedBalance).toBe("90.00");
  });
  it("serializes concurrent same-key replay and conflicting account versions", async () => {
    const id = await create(),
      key = randomUUID();
    const input = {
      action: "payment",
      accountId: id,
      version: 1,
      amount: "10.00",
      status: "posted",
      paidOn: "2026-01-02",
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => executeCommand(owner, key, input))
    );
    expect(results.every((r) => r.id === id)).toBe(true);
    expect((await account(id)).payments).toHaveLength(1);
    await expect(executeCommand(owner, key, { ...input, amount: "11.00" })).rejects.toMatchObject({
      status: 409,
    });
    const mutations = await Promise.allSettled([
      executeCommand(owner, randomUUID(), { ...input, version: 2 }),
      executeCommand(owner, randomUUID(), { ...input, version: 2 }),
    ]);
    expect(mutations.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mutations.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await account(id)).payments).toHaveLength(2);
    expect((await account(id)).version).toBe(3);
  });
  it("preserves pending payments through reconciliation and appends immutable snapshots", async () => {
    const id = await create();
    await executeCommand(owner, randomUUID(), {
      action: "payment",
      accountId: id,
      version: 1,
      amount: "15.00",
      status: "pending",
      paidOn: "2026-01-02",
    });
    await executeCommand(owner, randomUUID(), {
      action: "reconcile",
      accountId: id,
      version: 2,
      amount: "90.00",
      asOf: "2026-01-03",
      dispositions: [],
    });
    const row = await account(id);
    expect(row.pendingTotal).toBe("15.00");
    expect(row.trackedBalance).toBe("90.00");
    expect(row.payments[0].status).toBe("pending");
    expect(row.snapshots).toHaveLength(2);
    await expect(
      withUserDb(owner, (c) =>
        c.query("UPDATE workspace_snapshots SET amount_minor=0 WHERE account_id=$1", [id])
      )
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("confirms a PDF once, safely replays the same command and rejects reuse or foreign preview", async () => {
    const id = await create(),
      preview = randomUUID(),
      key = randomUUID();
    await admin.query(
      "INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
      [preview, owner, "test-" + preview, JSON.stringify({ synthetic: true })]
    );
    const input = {
      action: "reconcile",
      accountId: id,
      version: 1,
      amount: "95.00",
      asOf: "2026-01-03",
      dispositions: [],
      previewId: preview,
    };
    await executeCommand(owner, key, input);
    await executeCommand(owner, key, input);
    expect((await account(id)).version).toBe(2);
    expect((await account(id)).snapshots).toHaveLength(2);
    await expect(
      executeCommand(owner, randomUUID(), { ...input, version: 2 })
    ).rejects.toMatchObject({ status: 409 });
    expect((await account(id)).version).toBe(2);
    const foreignPreview = randomUUID();
    await admin.query(
      "INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at) VALUES($1,$2,$3,'{}',now()+interval '10 minutes')",
      [foreignPreview, foreign, "test-" + foreignPreview]
    );
    await expect(
      executeCommand(owner, randomUUID(), { ...input, version: 2, previewId: foreignPreview })
    ).rejects.toMatchObject({ status: 409 });
    expect((await account(id)).reportedBalance).toBe("95.00");
    const expired = randomUUID();
    await admin.query(
      "INSERT INTO workspace_pdf_previews(id,owner_id,file_hash,parsed,expires_at) VALUES($1,$2,$3,'{}',now()-interval '1 minute')",
      [expired, owner, "test-" + expired]
    );
    await expect(
      executeCommand(owner, randomUUID(), { ...input, version: 2, previewId: expired })
    ).rejects.toMatchObject({ status: 409 });
    expect((await account(id)).version).toBe(2);
  });
});
