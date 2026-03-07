import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  getSessionCookieOptions,
  validateAdminCredentials,
} from "@/lib/auth/session";

type LoginRequestBody = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const password = body.password || "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (!validateAdminCredentials(email, password)) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await createSessionToken(email);
  const response = NextResponse.json({
    ok: true,
    user: { email },
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...getSessionCookieOptions(),
  });

  return response;
}
