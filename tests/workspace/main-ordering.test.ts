import { it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { executeMainCommand, readMainTable } from "../../lib/workspace/main-repository";
import { mainData } from "../../lib/workspace/main-data";
const db = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const owners: string[] = [];
async function user() {
  const owner = randomUUID();
  owners.push(owner);
  await db.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
    [owner, "test-" + owner]
  );
  return owner;
}
afterAll(async () => {
  for (const table of [
    "money_workspace_cards",
    "money_credit_cards",
    "money_accounts",
    "money_command_receipts",
  ])
    await db.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`, [owners]);
  for (const table of ["workspace_snapshots", "workspace_accounts", "workspace_features"])
    await db.query(`DELETE FROM ${table} WHERE owner_id=ANY($1::uuid[])`, [owners]);
  await db.query("DELETE FROM workspace_users WHERE id=ANY($1::uuid[])", [owners]);
  await db.end();
});
async function create(owner: string, kind: "bank" | "card", name: string) {
  return executeMainCommand(owner, randomUUID(), {
    action: kind + ".create",
    name,
    ...(kind === "card" ? { credit_limit: 100, opening_balance: 0, as_of: "2026-11-26" } : {}),
  });
}
it.each(["bank", "card"] as const)(
  "persists complete %s ordering with version checks, receipts and archived records included",
  async (kind) => {
    const owner = await user();
    const a = await create(owner, kind, "A"),
      b = await create(owner, kind, "B"),
      archived = await create(owner, kind, "Archived");
    await executeMainCommand(owner, randomUUID(), {
      action: kind + ".update",
      id: archived.id,
      version: 1,
      archived: true,
      position: 19,
    });
    const input = {
        action: "ordering.set",
        kind,
        items: [
          { id: b.id, version: 1 },
          { id: a.id, version: 1 },
          { id: archived.id, version: 2 },
        ],
      },
      key = randomUUID();
    await expect(
      executeMainCommand(owner, randomUUID(), {
        ...input,
        items: [input.items[2], input.items[0], input.items[1]],
      })
    ).rejects.toThrow("Archived");
    const result = await executeMainCommand(owner, key, input);
    expect(await executeMainCommand(owner, key, input)).toEqual(result);
    await expect(
      executeMainCommand(owner, key, { ...input, items: [...input.items].reverse() })
    ).rejects.toThrow("key");
    const data = await mainData(owner, "test");
    const rows = kind === "bank" ? data.accounts : data.creditCards;
    expect(rows.map((r: any) => r.id)).toEqual([b.id, a.id, archived.id]);
    expect(rows.find((r: any) => r.id === b.id)).toMatchObject({ position: 0, version: 2 });
    expect(rows.find((r: any) => r.id === a.id)).toMatchObject({ position: 1, version: 2 });
    expect(rows.find((r: any) => r.id === archived.id)).toMatchObject({
      position: 2,
      version: 3,
      archived: true,
    });
    const rejectedKey = randomUUID();
    await expect(
      executeMainCommand(owner, rejectedKey, {
        ...input,
        items: [
          { id: a.id, version: 2 },
          { id: b.id, version: 1 },
          { id: archived.id, version: 3 },
        ],
      })
    ).rejects.toThrow("changed");
    expect(await mainData(owner, "test")).toEqual(data);
    expect(
      (
        await db.query("SELECT * FROM money_command_receipts WHERE user_id=$1 AND key=$2", [
          owner,
          rejectedKey,
        ])
      ).rows
    ).toHaveLength(0);
  }
);
it("rejects malformed, incomplete and foreign ordering without modifying records", async () => {
  const owner = await user(),
    other = await user();
  const a = await create(owner, "bank", "A"),
    b = await create(owner, "bank", "B"),
    foreign = await create(other, "bank", "Foreign");
  const input = {
    action: "ordering.set",
    kind: "bank",
    items: [
      { id: a.id, version: 1 },
      { id: b.id, version: 1 },
    ],
  };
  const before = await readMainTable(owner, "money_accounts");
  for (const invalid of [
    { items: [] },
    { items: input.items.slice(0, 1) },
    { items: [input.items[0], input.items[0]] },
    { items: [input.items[0], { id: foreign.id, version: 1 }] },
    { items: [input.items[0], { id: b.id.toUpperCase(), version: "1" }] },
    { items: [input.items[0], { id: b.id, version: 1, position: 2 }] },
    { items: Array(501).fill(input.items[0]) },
    { items: null },
    { user_id: other },
    { kind: "transaction" },
    { action: "ordering.set.extra" },
  ])
    await expect(
      executeMainCommand(owner, randomUUID(), { ...input, ...invalid })
    ).rejects.toThrow();
  expect(await readMainTable(owner, "money_accounts")).toEqual(before);
});
it("serializes competing reorder requests so only one current-version order wins", async () => {
  const owner = await user(),
    a = await create(owner, "bank", "A"),
    b = await create(owner, "bank", "B");
  const items = [
    { id: a.id, version: 1 },
    { id: b.id, version: 1 },
  ];
  const results = await Promise.allSettled(
    [items, [...items].reverse()].map((order) =>
      executeMainCommand(owner, randomUUID(), {
        action: "ordering.set",
        kind: "bank",
        items: order,
      })
    )
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const rows = await readMainTable(owner, "money_accounts");
  expect(rows.map((r) => r.version)).toEqual([2, 2]);
  expect(rows.map((r) => r.position).sort()).toEqual([0, 1]);
});
it("uses the statement anchor version when card history has advanced independently", async () => {
  const owner = await user(),
    card = await create(owner, "card", "Statement card");
  // A statement import can advance the authoritative anchor without updating card presentation metadata.
  await db.query("UPDATE workspace_accounts SET version=version+1 WHERE owner_id=$1 AND id=$2", [
    owner,
    card.id,
  ]);
  await expect(
    executeMainCommand(owner, randomUUID(), {
      action: "ordering.set",
      kind: "card",
      items: [{ id: card.id, version: 1 }],
    })
  ).rejects.toThrow("changed");
  await executeMainCommand(owner, randomUUID(), {
    action: "ordering.set",
    kind: "card",
    items: [{ id: card.id, version: 2 }],
  });
  expect((await mainData(owner, "test")).creditCards[0]).toMatchObject({ position: 0, version: 3 });
  expect((await readMainTable(owner, "money_credit_cards"))[0].version).toBe(3);
});
