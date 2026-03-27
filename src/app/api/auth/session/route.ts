import { NextResponse } from "next/server";
import { getActiveTenantMembership, readSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  if (process.env.AUTH_DISABLED === "true") {
    return NextResponse.json({
      authenticated: true,
      user: {
        sub: "system",
        email: "admin@hwpx.local",
        displayName: "관리자",
      },
      provider: { id: "password", type: "password", displayName: "Password" },
      memberships: [{ tenantId: "default", tenantName: "Default Workspace", role: "owner" }],
      activeTenant: { tenantId: "default", tenantName: "Default Workspace", role: "owner" },
      expiresAt: 9999999999,
    });
  }

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
