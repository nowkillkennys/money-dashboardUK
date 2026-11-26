import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkedWriteRequest, HttpError, jsonError } from "@/lib/workspace/http";
import { executeCommand, listAccounts } from "@/lib/workspace/ledger";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    return NextResponse.json(
      { accounts: await listAccounts(user.id) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return jsonError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const input = await checkedWriteRequest(request);
    const key = request.headers.get("idempotency-key");
    if (!key) throw new HttpError(400, "Request key required");
    return NextResponse.json(await executeCommand(user.id, key, input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
