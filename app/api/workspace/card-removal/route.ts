import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { previewMainCardRemoval } from "@/lib/workspace/main-card-deletion";
import { id } from "@/lib/workspace/ledger";
import { HttpError, jsonError } from "@/lib/workspace/http";
export async function GET(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "id") || params.getAll("id").length !== 1)
      throw new HttpError(400, "Only one card identifier is accepted");
    const preview = await previewMainCardRemoval(user.id, id(params.get("id")));
    return NextResponse.json(preview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
