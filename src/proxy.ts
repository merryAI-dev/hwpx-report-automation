import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/demo";
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"
    || pathname === "/api/auth/session"
    || pathname === "/api/auth/providers"
    || pathname.startsWith("/api/auth/oidc/start/")
    || pathname.startsWith("/api/auth/oidc/callback/");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // /api/public/* — no auth required, CORS enabled for browser clients
  if (pathname.startsWith("/api/public/")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const response = NextResponse.next();
    Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (isPublicPath(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(redirectUrl, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
