import { NextResponse } from "next/server";
import { getPublicAuthProviders, getTenantCatalog } from "@/lib/auth/provider-config";

export async function GET() {
  return NextResponse.json({
    providers: getPublicAuthProviders(),
    tenantCatalog: getTenantCatalog(),
  });
}
