import { NextResponse } from "next/server";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export function jsonError(error: unknown) {
  return NextResponse.json(
    { error: error instanceof HttpError ? error.message : "Request could not be completed" },
    {
      status: error instanceof HttpError ? error.status : 500,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
export function workspaceOrigin(): URL {
  const raw = process.env.WORKSPACE_ORIGIN;
  if (!raw) throw new Error("WORKSPACE_ORIGIN is required");
  const origin = new URL(raw);
  if (origin.origin !== raw || !["http:", "https:"].includes(origin.protocol))
    throw new Error("WORKSPACE_ORIGIN must be an exact origin");
  return origin;
}
export function trustedWrite(request: Request) {
  return request.headers.get("origin") === workspaceOrigin().origin;
}
export function checkWriteOrigin(request: Request) {
  if (!trustedWrite(request)) throw new HttpError(403, "Untrusted request origin");
}
export async function checkedWriteRequest(request: Request): Promise<Record<string, unknown>> {
  checkWriteOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new HttpError(415, "JSON required");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new HttpError(413, "Request too large");
    }
    chunks.push(value);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
export const SESSION_COOKIE = "workspace_session";
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: workspaceOrigin().protocol === "https:",
    path: "/",
    maxAge: 8 * 60 * 60,
  };
}
export function requestSessionToken(request: Request): string | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}
