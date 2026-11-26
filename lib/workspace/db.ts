import { Pool, types, type PoolClient } from "pg";

// PostgreSQL DATE is a civil day, never a timezone-shifted JavaScript instant.
types.setTypeParser(1082, (value) => value);

let auth: Pool | undefined;
let ledger: Pool | undefined;
function pool(variable: string) {
  if (process.env.WORKSPACE_MODE !== "authenticated" || process.env.UK_DEMO_ONLY === "true")
    throw new Error("Authenticated workspace is disabled");
  const connectionString = process.env[variable];
  if (!connectionString) throw new Error(`${variable} is required`);
  return new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
export function authDb() {
  return (auth ??= pool("WORKSPACE_AUTH_DATABASE_URL"));
}
export function workspaceDb() {
  return (ledger ??= pool("WORKSPACE_DATABASE_URL"));
}
export async function withUserDb<T>(
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
  readOnly = false
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
    throw new Error("Invalid authenticated user");
  const client = await workspaceDb().connect();
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
