import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { authDb } from "./db";
import { HttpError, requestSessionToken } from "./http";
export interface WorkspaceUser {
  id: string;
  username: string;
}
export const normalizeUsername = (name: string) => name.trim().toLowerCase();
export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  );
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 1024)
    throw new Error("Password must contain 12 to 1024 characters");
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > 1024) return false;
  const parts = encoded.split("$");
  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    !/^[0-9a-f]{32}$/.test(parts[1]) ||
    !/^[0-9a-f]{128}$/.test(parts[2])
  )
    return false;
  return timingSafeEqual(
    await derive(password, Buffer.from(parts[1], "hex")),
    Buffer.from(parts[2], "hex")
  );
}
// Same work factor for unknown usernames; no account-existence signal in the response.
const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;
async function consumeLoginLimit(username: string) {
  const client = await authDb().connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    // All requests take global then username locks in the same order.
    for (const [bucket, limit] of [
      ["global", 100],
      ["user:" + sessionHash(username), 8],
    ] as const) {
      const result = await client.query(
        `INSERT INTO workspace_login_limits(bucket,window_started_at,attempts) VALUES($1,now(),1)
      ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN workspace_login_limits.window_started_at < now()-interval '15 minutes' THEN 1 ELSE workspace_login_limits.attempts+1 END,
      window_started_at=CASE WHEN workspace_login_limits.window_started_at < now()-interval '15 minutes' THEN now() ELSE workspace_login_limits.window_started_at END
      RETURNING attempts`,
        [bucket]
      );
      if (result.rows[0].attempts > limit) {
        await client.query("COMMIT");
        committed = true;
        throw new HttpError(429, "Too many login attempts. Try again later.");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function login(username: string, password: string): Promise<string | null> {
  username = normalizeUsername(username);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) || password.length > 1024)
    throw new HttpError(400, "Invalid login details");
  await consumeLoginLimit(username);
  const result = await authDb().query(
    "SELECT id,username,password_hash,disabled FROM workspace_users WHERE username=$1",
    [username]
  );
  const user = result.rows[0];
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!valid || !user || user.disabled) return null;
  const token = randomBytes(32).toString("base64url");
  await authDb().query(
    "INSERT INTO workspace_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
    [sessionHash(token), user.id]
  );
  return token;
}
export async function getSession(token: string | null): Promise<WorkspaceUser | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await authDb().query(
    `SELECT u.id,u.username FROM workspace_sessions s JOIN workspace_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled`,
    [sessionHash(token)]
  );
  return result.rows[0] ?? null;
}
export async function requireWorkspaceSession(request: Request): Promise<WorkspaceUser> {
  const user = await getSession(requestSessionToken(request));
  if (!user) throw new HttpError(401, "Sign in required");
  return user;
}
export async function revokeSession(token: string | null) {
  if (token)
    await authDb().query("DELETE FROM workspace_sessions WHERE token_hash=$1", [
      sessionHash(token),
    ]);
}
