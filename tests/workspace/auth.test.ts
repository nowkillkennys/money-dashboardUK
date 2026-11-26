import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { authDb, workspaceDb, withUserDb } from "../../lib/workspace/db";
import {
  getSession,
  hashPassword,
  login,
  revokeSession,
  sessionHash,
} from "../../lib/workspace/auth";

const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL, max: 2 });
const password = "synthetic integration password 123";
const prefix = "test-" + randomBytes(6).toString("hex");
const alice = { id: randomUUID(), username: prefix + "-a" };
const bob = { id: randomUUID(), username: prefix + "-b" };
const limited = { id: randomUUID(), username: prefix + "-limit" };
const accountId = randomUUID();
beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const user of [alice, bob, limited])
    await admin.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [
      user.id,
      user.username,
      hash,
    ]);
  await withUserDb(alice.id, (client) =>
    client.query(
      "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,'Synthetic security test','loan',10000,'2026-01-01')",
      [accountId, alice.id]
    )
  );
});
afterAll(async () => {
  await admin.query("DELETE FROM workspace_accounts WHERE id=$1", [accountId]);
  for (const user of [alice, bob, limited]) {
    await admin.query("DELETE FROM workspace_login_limits WHERE bucket=$1", [
      "user:" + sessionHash(user.username),
    ]);
    await admin.query("DELETE FROM workspace_users WHERE id=$1", [user.id]);
  }
  await admin.end();
});

describe("real database auth and ownership boundary", () => {
  it("authenticates distinct users, hashes session tokens and revokes sessions", async () => {
    const a = await login(alice.username, password);
    const b = await login(bob.username, password);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await getSession(a)).toEqual(alice);
    expect(await getSession(b)).toEqual(bob);
    expect(
      (await admin.query("SELECT token_hash FROM workspace_sessions WHERE token_hash=$1", [a]))
        .rowCount
    ).toBe(0);
    expect(
      (
        await admin.query("SELECT token_hash FROM workspace_sessions WHERE token_hash=$1", [
          sessionHash(a!),
        ])
      ).rowCount
    ).toBe(1);
    await revokeSession(a);
    expect(await getSession(a)).toBeNull();
    await revokeSession(b);
  });
  it("rejects expired sessions and disabled users", async () => {
    const token = await login(alice.username, password);
    await admin.query(
      "UPDATE workspace_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [sessionHash(token!)]
    );
    expect(await getSession(token)).toBeNull();
    const current = await login(bob.username, password);
    await admin.query("UPDATE workspace_users SET disabled=true WHERE id=$1", [bob.id]);
    try {
      expect(await getSession(current)).toBeNull();
      expect(await login(bob.username, password)).toBeNull();
    } finally {
      await admin.query("UPDATE workspace_users SET disabled=false WHERE id=$1", [bob.id]);
    }
  });
  it("throttles parallel attempts atomically", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, async () => {
        try {
          return await login(limited.username, "synthetic incorrect password");
        } catch (error) {
          return (error as { status: number }).status;
        }
      })
    );
    expect(outcomes.filter((x) => x === null)).toHaveLength(8);
    expect(outcomes.filter((x) => x === 429)).toHaveLength(4);
    const row = (
      await admin.query("SELECT attempts FROM workspace_login_limits WHERE bucket=$1", [
        "user:" + sessionHash(limited.username),
      ])
    ).rows[0];
    expect(row.attempts).toBe(12);
  });
  it("enforces non-owner database roles and privilege separation", async () => {
    const roles = (
      await admin.query(
        "SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname IN ('auth_service','workspace_app')"
      )
    ).rows;
    expect(roles).toHaveLength(2);
    for (const role of roles) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolcreaterole).toBe(false);
    }
    expect(
      (await admin.query("SELECT tableowner FROM pg_tables WHERE tablename='workspace_accounts'"))
        .rows[0].tableowner
    ).not.toBe("workspace_app");
    await expect(
      workspaceDb().query("SELECT password_hash FROM workspace_users")
    ).rejects.toMatchObject({ code: "42501" });
    await expect(authDb().query("SELECT * FROM workspace_accounts")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      authDb().query("UPDATE workspace_users SET disabled=false WHERE id=$1", [alice.id])
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("hides foreign accounts and rejects forged owner inserts and child references", async () => {
    expect(
      (
        await withUserDb(alice.id, (c) =>
          c.query("SELECT id FROM workspace_accounts WHERE id=$1", [accountId])
        )
      ).rowCount
    ).toBe(1);
    expect(
      (
        await withUserDb(bob.id, (c) =>
          c.query("SELECT id FROM workspace_accounts WHERE id=$1", [accountId])
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await withUserDb(bob.id, (c) =>
          c.query("UPDATE workspace_accounts SET name=$1 WHERE id=$2", ["forged", accountId])
        )
      ).rowCount
    ).toBe(0);
    await expect(
      withUserDb(bob.id, (c) =>
        c.query(
          "INSERT INTO workspace_accounts(id,owner_id,name,kind,reported_minor,as_of) VALUES($1,$2,'forged','loan',0,'2026-01-01')",
          [randomUUID(), alice.id]
        )
      )
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      withUserDb(bob.id, (c) =>
        c.query(
          "INSERT INTO workspace_payments(id,owner_id,account_id,amount_minor,status,disposition,paid_on) VALUES($1,$2,$3,1,'posted','excluded','2026-01-01')",
          [randomUUID(), bob.id, accountId]
        )
      )
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("denies absent context and clears context after commit and rollback on reused pooled connections", async () => {
    const original = workspaceDb().options.max;
    // Check all currently available pool connections, including the one returned by withUserDb.
    await withUserDb(alice.id, async (c) => {
      expect(
        (await c.query("SELECT current_setting('app.user_id',true) AS owner")).rows[0].owner
      ).toBe(alice.id);
    });
    await expect(
      withUserDb(alice.id, async () => {
        throw new Error("synthetic rollback");
      })
    ).rejects.toThrow("synthetic rollback");
    const clients = await Promise.all(
      Array.from({ length: original ?? 8 }, () => workspaceDb().connect())
    );
    try {
      for (const c of clients) {
        expect(
          (await c.query("SELECT nullif(current_setting('app.user_id',true),'') AS owner")).rows[0]
            .owner
        ).toBeNull();
        expect(
          (await c.query("SELECT id FROM workspace_accounts WHERE id=$1", [accountId])).rowCount
        ).toBe(0);
      }
    } finally {
      for (const c of clients) c.release();
    }
  });
});
