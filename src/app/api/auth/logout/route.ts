import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getClearedSessionCookieOptions,
} from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...getClearedSessionCookieOptions(),
  });
  return response;
}
