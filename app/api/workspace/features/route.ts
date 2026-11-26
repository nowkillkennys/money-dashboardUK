import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkedWriteRequest, HttpError, jsonError } from "@/lib/workspace/http";
import { withUserDb } from "@/lib/workspace/db";
export async function GET(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const flags = await withUserDb(user.id, async (c) => {
      await c.query("INSERT INTO workspace_features(owner_id) VALUES($1) ON CONFLICT DO NOTHING", [
        user.id,
      ]);
      return (await c.query("SELECT manual,pdf FROM workspace_features")).rows[0];
    });
    return NextResponse.json(flags, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const data = await checkedWriteRequest(request);
    if (
      Object.keys(data).some((k) => !["manual", "pdf"].includes(k)) ||
      typeof data.manual !== "boolean" ||
      typeof data.pdf !== "boolean"
    )
      throw new HttpError(400, "Manual and PDF switches required");
    await withUserDb(user.id, (c) =>
      c.query(
        "INSERT INTO workspace_features(owner_id,manual,pdf) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET manual=$2,pdf=$3",
        [user.id, data.manual, data.pdf]
      )
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
