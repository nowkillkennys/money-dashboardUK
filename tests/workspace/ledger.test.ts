import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeCommand, listAccounts } from "../../lib/workspace/ledger";
const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const a = randomUUID(),
  b = randomUUID();
describe("owner-scoped transactional ledger", () => {
  afterAll(async () => {
    for (const table of [
      "workspace_snapshots",
      "workspace_command_receipts",
      "workspace_payments",
      "workspace_pdf_previews",
      "workspace_features",
      "workspace_accounts",
    ])
      await admin.query(`DELETE FROM ${table} WHERE owner_id=ANY($1::uuid[])`, [[a, b]]);
    await admin.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [[a, b]]);
    await admin.end();
  });
  it("provisions only isolated synthetic identities", async () => {
    await admin.query(
      "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3),($4,$5,$3)",
      [a, "test-" + a, "disabled-test-hash", b, "test-" + b]
    );
  });
  it("persists exact debt, replays once, rejects conflicting keys and cross-owner mutation", async () => {
    const key = randomUUID();
    const input = {
      action: "create",
      name: "Synthetic loan",
      kind: "loan",
      amount: "1234.56",
      asOf: "2026-11-26",
    };
    const result = await executeCommand(a, key, input);
    expect(result.id).toBeTruthy();
    expect(await executeCommand(a, key, input)).toEqual(result);
    await expect(executeCommand(a, key, { ...input, amount: "1.00" })).rejects.toThrow();
    expect((await listAccounts(a))[0].trackedBalance).toBe("1234.56");
    expect(await listAccounts(b)).toEqual([]);
    await expect(
      executeCommand(b, randomUUID(), {
        action: "payment",
        accountId: result.id,
        version: 1,
        amount: "100.00",
        status: "posted",
        paidOn: "2026-11-26",
      })
    ).rejects.toThrow();
    await executeCommand(a, randomUUID(), {
      action: "payment",
      accountId: result.id,
      version: 1,
      amount: "100.00",
      status: "posted",
      paidOn: "2026-11-26",
    });
    expect((await listAccounts(a))[0].trackedBalance).toBe("1134.56");
    await expect(
      executeCommand(a, randomUUID(), {
        action: "payment",
        accountId: result.id,
        version: 1,
        amount: "1.00",
        status: "posted",
        paidOn: "2026-11-26",
      })
    ).rejects.toThrow();
    const row = (await listAccounts(a))[0];
    await executeCommand(a, randomUUID(), {
      action: "reconcile",
      accountId: row.id,
      version: row.version,
      amount: "1134.56",
      asOf: "2026-11-26",
      dispositions: row.payments.map((p: any) => ({ paymentId: p.id, disposition: "included" })),
    });
    expect((await listAccounts(a))[0].trackedBalance).toBe("1134.56");
  });
  it("database denies absent identity, forged ownership and cross-owner foreign keys", async () => {
    const db = new Pool({ connectionString: process.env.WORKSPACE_DATABASE_URL });
    expect((await db.query("SELECT * FROM workspace_accounts")).rows).toEqual([]);
    await expect(
      db.query(
        "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,'forged','loan',1,'2026-11-26')",
        [randomUUID(), a]
      )
    ).rejects.toThrow();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id',$1,true)", [b]);
      const row = (await listAccounts(a))[0];
      await expect(
        client.query(
          "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,1,'posted','excluded','2026-11-26')",
          [randomUUID(), b, row.id]
        )
      ).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await db.end();
    }
  });
});
