import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/workspace/auth";
import {
  checkWriteOrigin,
  jsonError,
  requestSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/workspace/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkWriteOrigin(request);
    await revokeSession(requestSessionToken(request));
    const response = NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "private, no-store" } }
    );
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
