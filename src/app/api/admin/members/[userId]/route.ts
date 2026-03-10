import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { removeTenantMember } from "@/lib/server/workspace-store";

export const runtime = "nodejs";

export const DELETE = withApiAuth(
  async (_request: NextRequest, session, context?: { params?: Promise<{ userId: string }> }) => {
    try {
      const actor = buildWorkspaceActorFromSession(session);
      const params = await context?.params;
      const targetUserId = params?.userId;
      if (!targetUserId) {
        return NextResponse.json({ error: "userId is required." }, { status: 400 });
      }
      const removed = await removeTenantMember({
        tenantId: actor.tenantId,
        actorRole: actor.tenantRole,
        targetUserId,
      });
      if (!removed) {
        return NextResponse.json({ error: "Member not found." }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      return workspaceErrorResponse(error, "Failed to remove tenant member.");
    }
  },
  { requireTenant: true },
);
