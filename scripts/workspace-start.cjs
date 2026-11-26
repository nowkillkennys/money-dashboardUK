if (
  process.env.WORKSPACE_MODE !== "authenticated" ||
  process.env.UK_DEMO_ONLY === "true" ||
  !process.env.WORKSPACE_DATABASE_URL ||
  !process.env.WORKSPACE_AUTH_DATABASE_URL ||
  !process.env.WORKSPACE_ORIGIN
) {
  console.error("Authenticated workspace configuration required");
  process.exit(1);
}
process.argv = ["node", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"];
require("next/dist/bin/next");
