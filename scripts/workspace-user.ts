// Run with: WORKSPACE_ADMIN_DATABASE_URL=... tsx scripts/workspace-user.ts username
// Password is read from stdin, never command-line arguments or console output.
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { hashPassword, normalizeUsername } from "../lib/workspace/auth";
async function main() {
  const username = normalizeUsername(process.argv[2] ?? "");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username))
    throw new Error("Provide a username (3–64 letters, numbers, dots, underscores or hyphens)");
  if (!process.env.WORKSPACE_ADMIN_DATABASE_URL)
    throw new Error("WORKSPACE_ADMIN_DATABASE_URL is required");
  if (process.stdin.isTTY) throw new Error("Pipe the password on stdin from a secure source");
  let password = "";
  for await (const chunk of process.stdin) {
    password += chunk.toString();
    if (password.length > 2048) throw new Error("Password input too long");
  }
  password = password.replace(/\r?\n$/, "");
  const passwordHash = await hashPassword(password);
  const pool = new Pool({ connectionString: process.env.WORKSPACE_ADMIN_DATABASE_URL, max: 1 });
  try {
    await pool.query("INSERT INTO workspace_users(id,username,password_hash) VALUES($1,$2,$3)", [
      randomUUID(),
      username,
      passwordHash,
    ]);
    console.log("Workspace user created");
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "User creation failed. Check username, password policy and administrator connection."
  );
  process.exitCode = 1;
});
