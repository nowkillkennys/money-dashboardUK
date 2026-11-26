import { NextRequest, NextResponse } from "next/server";

/** An isolated evaluation boundary, not a replacement for future real-user authentication. */
export function proxy(request: NextRequest) {
  if (process.env.WORKSPACE_MODE === "authenticated") {
    const path = request.nextUrl.pathname;
    if (
      path.startsWith("/api/workspace/") ||
      path === "/workspace" ||
      path.startsWith("/workspace/") ||
      path.startsWith("/_next/static/") ||
      path === "/icon.svg" ||
      path === "/favicon.ico"
    )
      return NextResponse.next();
    if (path === "/sw.js" || path === "/_next/image")
      return NextResponse.json({ error: "Disabled in this workspace" }, { status: 403 });
    if (path.startsWith("/api/") || !["GET", "HEAD"].includes(request.method))
      return NextResponse.json({ error: "Legacy integrations are disabled" }, { status: 403 });
    return NextResponse.redirect(new URL("/workspace", request.url));
  }
  if (process.env.UK_DEMO_ONLY !== "true")
    return NextResponse.json(
      { error: "An explicit application mode is required" },
      { status: 503 }
    );
  const path = request.nextUrl.pathname;
  if (path === "/api/stocks" && request.method === "GET")
    return NextResponse.json(
      { results: {}, source: "offline-synthetic-demo", live: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  if (
    path === "/api" ||
    path.startsWith("/api/") ||
    !["GET", "HEAD"].includes(request.method) ||
    path === "/sw.js" ||
    path === "/_next/image"
  )
    return NextResponse.json(
      {
        error:
          "External services and persistent writes are disabled in this UK adaptation preview.",
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  if (
    path === "/" ||
    (!path.startsWith("/_next/") &&
      path !== "/demo" &&
      !path.startsWith("/demo/") &&
      !/\.[a-z0-9]+$/i.test(path))
  )
    return NextResponse.redirect(new URL("/demo", request.url));
  return NextResponse.next();
}
export const config = { matcher: "/((?!_next/static).*)" };
