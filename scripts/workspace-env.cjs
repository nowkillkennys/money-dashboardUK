// Creates only new local workspace credentials. Never prints secret values.
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const dir = path.join(process.cwd(), ".uk-work");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, "workspace.env");
if (fs.existsSync(file)) {
  console.log("Existing workspace configuration retained.");
  process.exit(0);
}
const [admin, auth, app] = [0, 1, 2].map(() => randomBytes(32).toString("hex"));
fs.writeFileSync(
  file,
  `POSTGRES_PASSWORD=${admin}\nWORKSPACE_AUTH_PASSWORD=${auth}\nWORKSPACE_APP_PASSWORD=${app}\nWORKSPACE_ADMIN_DATABASE_URL=postgresql://postgres:${admin}@db:5432/workspace\nWORKSPACE_AUTH_DATABASE_URL=postgresql://auth_service:${auth}@db:5432/workspace\nWORKSPACE_DATABASE_URL=postgresql://workspace_app:${app}@db:5432/workspace\n`,
  { mode: 0o600, flag: "wx" }
);
console.log("New private local workspace configuration created.");
