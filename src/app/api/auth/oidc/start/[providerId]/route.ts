import { NextResponse } from "next/server";
import { getConfiguredOidcProvider } from "@/lib/auth/provider-config";
import {
  OIDC_FLOW_COOKIE_NAME,
  buildOidcAuthorizationUrl,
  createOidcFlowToken,
  createPkcePair,
  createRandomBase64Url,
  getOidcFlowCookieOptions,
  normalizeNextPath,
} from "@/lib/auth/oidc-flow";

type Context = {
  params: Promise<{
    providerId: string;
  }>;
};

export async function GET(request: Request, context: Context) {
  const { providerId } = await context.params;
  const provider = getConfiguredOidcProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "OIDC provider not found." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next"));
  const requestedTenantId = requestUrl.searchParams.get("tenantId")?.trim() || null;
  const state = createRandomBase64Url(24);
  const { codeVerifier, codeChallenge } = await createPkcePair();
  const flowToken = await createOidcFlowToken({
    providerId,
    state,
    codeVerifier,
    nextPath,
    requestedTenantId,
  });
  const redirectUrl = buildOidcAuthorizationUrl(provider, request.url, {
    state,
    codeChallenge,
    nextPath,
  });

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: OIDC_FLOW_COOKIE_NAME,
    value: flowToken,
    ...getOidcFlowCookieOptions(),
  });
  return response;
}
