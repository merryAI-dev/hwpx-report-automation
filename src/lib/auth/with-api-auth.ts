import { NextResponse } from "next/server";
import { readSessionFromRequest, type SessionPayload } from "@/lib/auth/session";

export type AuthenticatedRouteHandler<T extends Request = Request> = (
  request: T,
  session: SessionPayload,
) => Promise<Response> | Response;

export function withApiAuth<T extends Request = Request>(
  handler: AuthenticatedRouteHandler<T>,
) {
  return async (request: T) => {
    const session = await readSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    return handler(request, session);
  };
}
