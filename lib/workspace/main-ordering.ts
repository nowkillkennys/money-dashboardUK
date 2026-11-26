import type { PoolClient } from "pg";
import { HttpError } from "./http";

export const orderingFields: Record<string, string[]> = { ordering: ["kind", "items"] };
function invalid(message: string): never {
  throw new HttpError(400, message);
}
function changed(): never {
  throw new HttpError(409, "Records changed. Reload before reordering");
}

/** Runs in the owner's feature-locked transaction and command receipt journal. */
export async function executeOrderingCommand(
  c: PoolClient,
  owner: string,
  input: Record<string, any>
): Promise<any | undefined> {
  if (typeof input.action !== "string" || input.action.split(".")[0] !== "ordering")
    return undefined;
  if (input.action !== "ordering.set") invalid("Unsupported ordering command");
  if (Object.keys(input).some((key) => !["action", "kind", "items"].includes(key)))
    invalid("Unknown ordering field");
  if (input.kind !== "bank" && input.kind !== "card") invalid("Invalid ordering kind");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500)
    invalid("Order between one and 500 records");
  const items: { id: string; version: number }[] = input.items.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Invalid ordering item");
    const value = item as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["id", "version"].includes(key)))
      invalid("Unknown ordering item field");
    if (
      typeof value.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    )
      invalid("Invalid identifier");
    if (
      typeof value.version !== "number" ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1
    )
      invalid("Invalid record version");
    return { id: value.id.toLowerCase(), version: value.version };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length)
    invalid("Duplicate ordering record");
  const card = input.kind === "card",
    table = card ? "money_credit_cards" : "money_accounts";
  // All workspace anchors precede presentation rows, matching financial command lock order.
  const anchors = card
    ? (
        await c.query(
          `SELECT a.id,a.version FROM workspace_accounts a
     JOIN money_workspace_cards m ON m.workspace_account_id=a.id AND m.user_id=a.owner_id
     WHERE a.owner_id=$1 ORDER BY a.id FOR UPDATE OF a`,
          [owner]
        )
      ).rows
    : [];
  const rows = (
    await c.query(
      `SELECT id,version,archived,currency FROM ${table} WHERE user_id=$1 ORDER BY id FOR UPDATE`,
      [owner]
    )
  ).rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const anchorVersions = new Map(anchors.map((row) => [row.id, row.version]));
  if (rows.length !== items.length) changed();
  let archived = false;
  for (const item of items) {
    const row = byId.get(item.id);
    if (!row) changed();
    if (row.currency !== "GBP") invalid("This workspace uses GBP");
    if (item.version !== (card ? anchorVersions.get(item.id) : row.version)) changed();
    if (archived && !row.archived) invalid("Archived records must follow active records");
    archived ||= row.archived;
  }
  let first: any;
  for (const [position, item] of items.entries()) {
    const version = item.version + 1;
    if (card)
      await c.query("UPDATE workspace_accounts SET version=$3 WHERE owner_id=$1 AND id=$2", [
        owner,
        item.id,
        version,
      ]);
    const row = (
      await c.query(
        `UPDATE ${table} SET position=$3,version=$4 WHERE user_id=$1 AND id=$2 RETURNING *`,
        [owner, item.id, position, version]
      )
    ).rows[0];
    first ??= row;
  }
  return { id: first.id, version: first.version, row: first };
}
