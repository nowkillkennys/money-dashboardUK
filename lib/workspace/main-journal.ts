import { createHash } from "node:crypto";
import { withUserDb } from "./db";
import { HttpError } from "./http";
import { executeMainCommand } from "./main-repository";
import { executeCommand, id } from "./ledger";
type Envelope = { surface: "main" | "debt"; input: Record<string, unknown> };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function synchronise(c: import("pg").PoolClient) {
  await c.query(
    "UPDATE money_command_journal j SET status='done' WHERE status='pending' AND (EXISTS(SELECT 1 FROM money_command_receipts r WHERE r.user_id=j.user_id AND r.key=j.key) OR EXISTS(SELECT 1 FROM workspace_command_receipts r WHERE r.owner_id=j.user_id AND r.key=j.key))"
  );
}
export async function pendingMainCommands(owner: string) {
  return withUserDb(owner, async (c) => {
    await synchronise(c);
    return (
      await c.query(
        "SELECT key,body->>'surface' AS surface,body->'input'->>'action' AS action FROM money_command_journal WHERE status='pending' ORDER BY created_at,key"
      )
    ).rows;
  });
}
export async function journalCommand(owner: string, key: string, envelope: Envelope) {
  id(key);
  const fingerprint = createHash("sha256").update(canonical(envelope)).digest("hex");
  await withUserDb(owner, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [owner + ":journal"]);
    await synchronise(c);
    const previous = (
      await c.query("SELECT fingerprint FROM money_command_journal WHERE key=$1", [key])
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new HttpError(409, "Request key already used for a different change");
      return;
    }
    if ((await c.query("SELECT key FROM money_command_journal WHERE status='pending'")).rowCount)
      throw new HttpError(409, "Resolve the pending change before making another change");
    await c.query(
      "INSERT INTO money_command_journal(user_id,key,body,fingerprint) VALUES($1,$2,$3,$4)",
      [owner, key, JSON.stringify(envelope), fingerprint]
    );
  });
  try {
    const result =
      envelope.surface === "main"
        ? await executeMainCommand(owner, key, envelope.input)
        : await executeCommand(owner, key, envelope.input);
    await withUserDb(owner, (c) =>
      c.query("UPDATE money_command_journal SET status='done' WHERE key=$1", [key])
    );
    return result;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && /^(22|23)/.test(String(e.code)))
      e = new HttpError(400, "Invalid value or account reference");
    if (e instanceof HttpError && e.status < 500 && e.status !== 408)
      await withUserDb(owner, (c) =>
        c.query("UPDATE money_command_journal SET status='rejected' WHERE key=$1", [key])
      );
    throw e;
  }
}
export async function retryMainCommand(owner: string, key: string) {
  id(key);
  const row = await withUserDb(
    owner,
    async (c) =>
      (await c.query("SELECT body FROM money_command_journal WHERE key=$1", [key])).rows[0]
  );
  if (!row) throw new HttpError(404, "Pending change not found");
  return journalCommand(owner, key, row.body);
}
