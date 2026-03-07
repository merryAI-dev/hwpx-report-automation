import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken, getSessionCookieOptions } from "@/lib/auth/session";
import { getConfiguredOidcProvider, resolveSeededIdentity } from "@/lib/auth/provider-config";
import {
  OIDC_FLOW_COOKIE_NAME,
  exchangeOidcCodeForProfile,
  getClearedOidcFlowCookieOptions,
  normalizeNextPath,
  verifyOidcFlowToken,
} from "@/lib/auth/oidc-flow";

type Context = {
  params: Promise<{
    providerId: string;
  }>;
};

function redirectToLogin(request: Request, nextPath: string, error: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", normalizeNextPath(nextPath));
  loginUrl.searchParams.set("error", error);
  return NextResponse.redirect(loginUrl);
}

function readCookieValue(cookieHeader: string, cookieName: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${cookieName}=`)) {
      continue;
    }
    return decodeURIComponent(trimmed.slice(trimmed.indexOf("=") + 1));
  }
  return null;
}

export async function GET(request: Request, context: Context) {
  const { providerId } = await context.params;
  const provider = getConfiguredOidcProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "OIDC provider not found." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code") || "";
  const state = requestUrl.searchParams.get("state") || "";
  const flowToken = readCookieValue(request.headers.get("cookie") || "", OIDC_FLOW_COOKIE_NAME);
  const flow = flowToken ? await verifyOidcFlowToken(flowToken) : null;

  if (!code || !state || !flow || flow.providerId !== providerId || flow.state !== state) {
    const response = redirectToLogin(request, flow?.nextPath || "/", "oidc_state");
    response.cookies.set({
      name: OIDC_FLOW_COOKIE_NAME,
      value: "",
      ...getClearedOidcFlowCookieOptions(),
    });
    return response;
  }

  try {
    const profile = await exchangeOidcCodeForProfile(provider, request.url, code, flow.codeVerifier);
    const seededIdentity = resolveSeededIdentity({
      providerId,
      subject: profile.sub,
      email: profile.email,
      displayName: profile.displayName,
    });
    const activeTenantId = flow.requestedTenantId || seededIdentity.defaultTenantId;
    const token = await createSessionToken(
      {
        sub: `${providerId}:${profile.sub}`,
        email: profile.email,
        displayName: seededIdentity.displayName,
        provider: {
          id: provider.id,
          type: provider.type,
          displayName: provider.displayName,
          issuer: provider.issuer,
        },
        memberships: seededIdentity.memberships,
        activeTenantId,
      },
      { activeTenantId },
    );

    const response = NextResponse.redirect(new URL(normalizeNextPath(flow.nextPath), request.url));
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      ...getSessionCookieOptions(),
    });
    response.cookies.set({
      name: OIDC_FLOW_COOKIE_NAME,
      value: "",
      ...getClearedOidcFlowCookieOptions(),
    });
    return response;
  } catch {
    const response = redirectToLogin(request, flow.nextPath, "oidc_callback");
    response.cookies.set({
      name: OIDC_FLOW_COOKIE_NAME,
      value: "",
      ...getClearedOidcFlowCookieOptions(),
    });
    return response;
  }
}
