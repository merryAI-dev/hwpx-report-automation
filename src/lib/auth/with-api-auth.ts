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

export type AuthenticatedRouteHandler<T extends Request = Request> = (
  request: T,
  session: AuthenticatedSession,
) => Promise<Response> | Response;

export function withApiAuth<T extends Request = Request>(
  handler: AuthenticatedRouteHandler<T>,
  options: {
    requireTenant?: boolean;
  } = {},
) {
  return async (request: T) => {
    const session = await readSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const authenticatedSession: AuthenticatedSession = {
      ...session,
      activeTenant: getActiveTenantMembership(session),
    };

    if (options.requireTenant && !authenticatedSession.activeTenant) {
      return NextResponse.json({ error: "Active tenant is required." }, { status: 403 });
    }

    return handler(request, authenticatedSession);
  };
}
