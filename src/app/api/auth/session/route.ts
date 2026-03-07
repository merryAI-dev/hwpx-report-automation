import { NextResponse } from "next/server";
import { readSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await readSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: { email: session.email },
    expiresAt: session.exp,
  });
}
