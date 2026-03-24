import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login";
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"
    || pathname === "/api/auth/session"
    || pathname === "/api/auth/providers"
    || pathname.startsWith("/api/auth/oidc/start/")
    || pathname.startsWith("/api/auth/oidc/callback/");
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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

  // Auth is optional — allow access without a session
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
