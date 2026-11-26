import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkedWriteRequest, HttpError, jsonError } from "@/lib/workspace/http";
import { journalCommand, pendingMainCommands } from "@/lib/workspace/main-journal";
export async function GET(r: Request) {
  try {
    const u = await requireWorkspaceSession(r);
    return NextResponse.json(
      { pending: await pendingMainCommands(u.id) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(r: Request) {
  try {
    const u = await requireWorkspaceSession(r),
      input = await checkedWriteRequest(r),
      key = r.headers.get("idempotency-key");
    if (!key) throw new HttpError(400, "Request key required");
    return NextResponse.json(await journalCommand(u.id, key, { surface: "main", input }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
