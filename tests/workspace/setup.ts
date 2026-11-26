import { Pool } from "pg";
export default async function setup() {
  const url = new URL(process.env.WORKSPACE_ADMIN_DATABASE_URL || "");
  if (url.hostname !== "db-test")
    throw new Error("Integration tests require the separate db-test service");
  const db = new Pool({ connectionString: url.toString() });
  try {
    await db.query("DELETE FROM workspace_login_limits WHERE bucket='global'");
  } finally {
    await db.end();
  }
}
