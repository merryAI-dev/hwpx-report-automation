import { NextResponse } from "next/server";
import {
  getActiveTenantMembership,
  readSessionFromRequest,
  type SessionPayload,
  type SessionTenantMembership,
} from "@/lib/auth/session";

export type AuthenticatedSession = SessionPayload & {
  activeTenant: SessionTenantMembership | null;
};

export type AuthenticatedRouteHandler<T extends Request = Request, C = unknown> = (
  request: T,
  session: AuthenticatedSession,
  context?: C,
) => Promise<Response> | Response;

const GUEST_SESSION: AuthenticatedSession = {
  sub: "guest",
  email: "guest@local",
  displayName: "Guest",
  provider: { id: "guest", type: "password" as const, displayName: "Local" },
  memberships: [],
  activeTenantId: "",
  iat: 0,
  exp: 0,
  activeTenant: null,
};

export function withApiAuth<T extends Request = Request, C = unknown>(
  handler: AuthenticatedRouteHandler<T, C>,
  options: {
    requireTenant?: boolean;
  } = {},
) {
  return async (request: T, context?: C) => {
    const session = await readSessionFromRequest(request);

    const authenticatedSession: AuthenticatedSession = session
      ? { ...session, activeTenant: getActiveTenantMembership(session) }
      : GUEST_SESSION;

    if (options.requireTenant && !authenticatedSession.activeTenant) {
      return NextResponse.json({ error: "Active tenant is required." }, { status: 403 });
    }

    return handler(request, authenticatedSession, context);
  };
}
