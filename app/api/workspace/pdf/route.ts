import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkWriteOrigin, jsonError } from "@/lib/workspace/http";
import { previewPdf, readPdfBody, requirePdfFeature } from "@/lib/workspace/pdf";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkWriteOrigin(request);
    const user = await requireWorkspaceSession(request);
    await requirePdfFeature(user.id);
    const result = await previewPdf(user.id, await readPdfBody(request));
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
