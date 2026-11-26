import { NextResponse } from "next/server";
import { login } from "@/lib/workspace/auth";
import {
  checkedWriteRequest,
  HttpError,
  jsonError,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/workspace/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await checkedWriteRequest(request);
    if (typeof body.username !== "string" || typeof body.password !== "string")
      throw new HttpError(400, "Login details required");
    const token = await login(body.username, body.password);
    if (!token) throw new HttpError(401, "Invalid username or password");
    const response = NextResponse.json(
      { authenticated: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
