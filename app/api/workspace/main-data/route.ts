import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { mainData } from "@/lib/workspace/main-data";
import { jsonError } from "@/lib/workspace/http";
export async function GET(r: Request) {
  try {
    const u = await requireWorkspaceSession(r);
    return NextResponse.json(await mainData(u.id, u.username), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
