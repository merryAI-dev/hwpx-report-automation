import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { listWorkspaceDocumentAuditEvents } from "@/lib/server/workspace-store";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";

export const runtime = "nodejs";

export const GET = withApiAuth(async (
  _request: NextRequest,
  session,
  context?: { params: Promise<{ documentId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("documentId is required.");
    }
    const { documentId } = await context.params;
    const events = await listWorkspaceDocumentAuditEvents({ tenantId: actor.tenantId, actor, documentId });
    return NextResponse.json({ events });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list document audit events.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;
