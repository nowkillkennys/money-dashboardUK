import { NextResponse } from "next/server";
import { requireWorkspaceSession } from "@/lib/workspace/auth";
import { checkedWriteRequest, HttpError, jsonError } from "@/lib/workspace/http";
import { captureMainSnapshot } from "@/lib/workspace/main-snapshots";

export async function POST(request: Request) {
  try {
    const user = await requireWorkspaceSession(request);
    const input = await checkedWriteRequest(request);
    if (
      Object.keys(input).length !== 1 ||
      typeof input.expected_owner_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.expected_owner_id
      )
    )
      throw new HttpError(400, "Expected account identity required");
    if (input.expected_owner_id !== user.id)
      throw new HttpError(409, "Account changed; reload the dashboard");
    return NextResponse.json(await captureMainSnapshot(user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
