import { NextResponse } from "next/server";
import { getActiveTenantMembership, readSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await readSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      sub: session.sub,
      email: session.email,
      displayName: session.displayName,
    },
    provider: session.provider,
    memberships: session.memberships,
    activeTenant: getActiveTenantMembership(session),
    expiresAt: session.exp,
  });
}
