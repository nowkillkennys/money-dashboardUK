import { afterAll, expect, it } from "vitest";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  journalCommand,
  pendingMainCommands,
  retryMainCommand,
} from "../../lib/workspace/main-journal";
import { mainData } from "../../lib/workspace/main-data";

const admin = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL });
const users: string[] = [];
afterAll(async () => {
  // Synthetic account history remains in the isolated test volume for FK-safe teardown.
  await admin.query("DELETE FROM money_command_journal WHERE user_id=ANY($1::uuid[])", [users]);
  await admin.end();
});
async function newOwner() {
  const owner = randomUUID();
  await admin.query(
    "INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,'disabled')",
    [owner, "journal-security-" + owner]
  );
  users.push(owner);
  return owner;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => JSON.stringify(key) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function reserve(
  owner: string,
  key: string,
  envelope: { surface: "main" | "debt"; input: Record<string, unknown> }
) {
  const fingerprint = createHash("sha256").update(canonical(envelope)).digest("hex");
  await admin.query(
    "INSERT INTO money_command_journal(user_id,key,body,fingerprint) VALUES($1,$2,$3,$4)",
    [owner, key, JSON.stringify(envelope), fingerprint]
  );
}
const bank = (name = "Synthetic recovery bank") => ({
  surface: "main" as const,
  input: { action: "bank.create", name, starting_balance: "100.00" },
});

it("recovers a durably reserved command before finance ran and applies it once", async () => {
  const owner = await newOwner(),
    key = randomUUID();
  await reserve(owner, key, bank());
  expect(await pendingMainCommands(owner)).toEqual([
    { key, surface: "main", action: "bank.create" },
  ]);
  await expect(journalCommand(owner, randomUUID(), bank("Another"))).rejects.toMatchObject({
    status: 409,
  });
  const first = await retryMainCommand(owner, key);
  expect(await retryMainCommand(owner, key)).toEqual(first);
  expect((await mainData(owner, "Synthetic")).accounts).toHaveLength(1);
  expect(await pendingMainCommands(owner)).toEqual([]);
});

it("settles invalid SQL values and nonexistent foreign keys without wedging later commands", async () => {
  const owner = await newOwner();
  for (const input of [
    { action: "bank.create", name: "Invalid type", type: "not-a-bank-type" },
    {
      action: "transaction.create",
      type: "expense",
      amount: "1.00",
      date: "2026-11-26",
      account_id: randomUUID(),
    },
  ]) {
    const key = randomUUID();
    await expect(journalCommand(owner, key, { surface: "main", input })).rejects.toMatchObject({
      status: 400,
    });
    expect(await pendingMainCommands(owner)).toEqual([]);
    expect(
      (
        await admin.query("SELECT status FROM money_command_journal WHERE user_id=$1 AND key=$2", [
          owner,
          key,
        ])
      ).rows[0].status
    ).toBe("rejected");
  }
  await journalCommand(owner, randomUUID(), bank());
  expect((await mainData(owner, "Synthetic")).accounts).toHaveLength(1);
});

it("rejects same-key payload changes while preserving the original financial receipt", async () => {
  const owner = await newOwner(),
    key = randomUUID();
  const original = await journalCommand(owner, key, bank());
  await expect(journalCommand(owner, key, bank("Changed payload"))).rejects.toMatchObject({
    status: 409,
  });
  expect(await retryMainCommand(owner, key)).toEqual(original);
  expect((await mainData(owner, "Synthetic")).accounts.map((row: any) => row.name)).toEqual([
    "Synthetic recovery bank",
  ]);
});

it("hides pending keys and payloads from other owners and scopes reused keys by owner", async () => {
  const owner = await newOwner(),
    other = await newOwner(),
    key = randomUUID();
  await reserve(owner, key, bank());
  expect(await pendingMainCommands(other)).toEqual([]);
  await expect(retryMainCommand(other, key)).rejects.toMatchObject({ status: 404 });
  await journalCommand(other, key, bank("Other owner's bank"));
  expect(await pendingMainCommands(owner)).toEqual([
    { key, surface: "main", action: "bank.create" },
  ]);
  await retryMainCommand(owner, key);
  expect((await mainData(owner, "Synthetic")).accounts[0].name).toBe("Synthetic recovery bank");
  expect((await mainData(other, "Other")).accounts[0].name).toBe("Other owner's bank");
});

it("rejects references and updates to another owner's bank without modifying either ledger", async () => {
  const owner = await newOwner(),
    other = await newOwner();
  const foreign = await journalCommand(other, randomUUID(), bank("Foreign bank"));
  await expect(
    journalCommand(owner, randomUUID(), {
      surface: "main",
      input: {
        action: "transaction.create",
        type: "expense",
        amount: "5.00",
        date: "2026-11-26",
        account_id: foreign.id,
      },
    })
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    journalCommand(owner, randomUUID(), {
      surface: "main",
      input: { action: "bank.update", id: foreign.id, version: 1, name: "Hijacked" },
    })
  ).rejects.toMatchObject({ status: 404 });
  expect(await pendingMainCommands(owner)).toEqual([]);
  expect((await mainData(owner, "Synthetic")).transactions).toEqual([]);
  const data = await mainData(other, "Other");
  expect(data.accounts[0].name).toBe("Foreign bank");
  expect(data.balances[foreign.id]).toBe(100);
});
