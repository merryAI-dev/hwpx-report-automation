import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";
import { getTenantQuotaSummary, setTenantQuotaConfig } from "@/lib/server/quota-store";

export const runtime = "nodejs";

const ROLE_RANK: Record<string, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  owner: 4,
  admin: 4,
};

export const GET = withApiAuth(async (_request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const summary = await getTenantQuotaSummary(actor.tenantId);
    return NextResponse.json({ quota: summary });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to get quota summary.");
  }
}, { requireTenant: true });

export const PUT = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const actorRoleRank = ROLE_RANK[actor.tenantRole.toLowerCase()] ?? 0;
    if (actorRoleRank < ROLE_RANK.manager) {
      return NextResponse.json({ error: "Tenant management access denied." }, { status: 403 });
    }
    const body = await request.json();
    if (!isRecord(body)) {
      throw new Error("Invalid JSON body.");
    }
    const patch: Partial<{ maxDocuments: number; maxTemplates: number; maxBlobBytes: number }> = {};
    if (typeof body.maxDocuments === "number") {
      patch.maxDocuments = body.maxDocuments;
    }
    if (typeof body.maxTemplates === "number") {
      patch.maxTemplates = body.maxTemplates;
    }
    if (typeof body.maxBlobBytes === "number") {
      patch.maxBlobBytes = body.maxBlobBytes;
    }
    const config = await setTenantQuotaConfig(actor.tenantId, patch);
    return NextResponse.json({ config });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to update quota config.");
  }
}, { requireTenant: true });
