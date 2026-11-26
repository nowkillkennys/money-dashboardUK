import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { jsonError } from "@/lib/workspace/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    return NextResponse.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
