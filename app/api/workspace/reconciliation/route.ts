import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { reconciliationPreview } from "@/lib/workspace/main-reconciliation";
import { HttpError, jsonError } from "@/lib/workspace/http";
export async function GET(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const params = new URL(request.url).searchParams;
    if (
      Array.from(params.keys()).some((key) => key !== "session_id") ||
      params.getAll("session_id").length !== 1
    )
      throw new HttpError(400, "Supply one reconciliation session identifier");
    return NextResponse.json(await reconciliationPreview(user.id, params.get("session_id") ?? ""), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
