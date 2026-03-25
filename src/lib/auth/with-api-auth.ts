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

export function withApiAuth<T extends Request = Request, C = unknown>(
  handler: AuthenticatedRouteHandler<T, C>,
  options: {
    requireTenant?: boolean;
  } = {},
) {
  return async (request: T, context?: C) => {
    const session = await readSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const authenticatedSession: AuthenticatedSession = {
      ...session,
      activeTenant: getActiveTenantMembership(session),
    };

    if (options.requireTenant && !authenticatedSession.activeTenant) {
      return NextResponse.json({ error: "워크스페이스 설정이 필요합니다." }, { status: 403 });
    }

    return handler(request, authenticatedSession, context);
  };
}
