import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  getActiveTenantMembership,
  getSessionCookieOptions,
  validateUserCredentials,
} from "@/lib/auth/session";

type LoginRequestBody = {
  email?: string;
  password?: string;
  tenantId?: string;
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

  const user = validateUserCredentials(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const requestedTenantId = (body.tenantId || "").trim();
  const activeTenantId = user.memberships.some((membership) => membership.tenantId === requestedTenantId)
    ? requestedTenantId
    : user.defaultTenantId;

  const token = await createSessionToken(
    {
      sub: user.sub,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      memberships: user.memberships,
      activeTenantId,
    },
    { activeTenantId },
  );
  const activeTenant = getActiveTenantMembership(
    {
      sub: user.sub,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      memberships: user.memberships,
      activeTenantId,
      iat: 0,
      exp: 0,
    },
    activeTenantId,
  );

  const response = NextResponse.json({
    ok: true,
    user: {
      sub: user.sub,
      email: user.email,
      displayName: user.displayName,
    },
    provider: user.provider,
    memberships: user.memberships,
    activeTenant,
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...getSessionCookieOptions(),
  });

  return response;
}
