import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkedWriteRequest, jsonError } from "@/lib/workspace/http";
import { retryMainCommand } from "@/lib/workspace/main-journal";
import { id } from "@/lib/workspace/ledger";
export async function POST(r: Request) {
  try {
    const u = await requireWorkspaceSession(r),
      body = await checkedWriteRequest(r);
    return NextResponse.json(await retryMainCommand(u.id, id(body.key)), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
