import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getActiveTenantMembership,
  getSessionCookieOptions,
  readSessionFromRequest,
  switchSessionTenant,
  verifySessionToken,
} from "@/lib/auth/session";

type SwitchTenantBody = {
  tenantId?: string;
};

export async function POST(request: Request) {
  const session = await readSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: SwitchTenantBody;
  try {
    body = (await request.json()) as SwitchTenantBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tenantId = (body.tenantId || "").trim();
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  }

  const activeTenant = getActiveTenantMembership(session, tenantId);
  if (!activeTenant) {
    return NextResponse.json({ error: "Tenant membership not found." }, { status: 403 });
  }

  const token = await switchSessionTenant(session, tenantId);
  const nextSession = await verifySessionToken(token);
  const response = NextResponse.json({
    ok: true,
    user: {
      sub: session.sub,
      email: session.email,
      displayName: session.displayName,
    },
    provider: session.provider,
    memberships: session.memberships,
    activeTenant,
    expiresAt: nextSession?.exp ?? session.exp,
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...getSessionCookieOptions(),
  });

  return response;
}
