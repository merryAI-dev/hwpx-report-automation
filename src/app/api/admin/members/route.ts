import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";
import { listTenantMembers, upsertTenantMember } from "@/lib/server/workspace-store";
import type { WorkspaceAccessRole } from "@/lib/workspace-types";

export const runtime = "nodejs";

const VALID_ROLES = new Set<WorkspaceAccessRole>(["viewer", "editor", "manager", "owner"]);

function isValidRole(value: unknown): value is WorkspaceAccessRole {
  return typeof value === "string" && VALID_ROLES.has(value as WorkspaceAccessRole);
}

export const GET = withApiAuth(async (_request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const members = await listTenantMembers(actor.tenantId);
    return NextResponse.json({ members });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list tenant members.");
  }
}, { requireTenant: true });

export const POST = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const body = await request.json();
    if (!isRecord(body)) {
      throw new Error("Invalid JSON body.");
    }
    const { userId, email, displayName, role } = body;
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("userId is required.");
    }
    if (typeof email !== "string" || !email.trim()) {
      throw new Error("email is required.");
    }
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw new Error("displayName is required.");
    }
    if (!isValidRole(role)) {
      throw new Error("role must be one of: viewer, editor, manager, owner.");
    }
    const member = await upsertTenantMember({
      tenantId: actor.tenantId,
      actorRole: actor.tenantRole,
      actorUserId: actor.userId,
      member: {
        userId: userId.trim(),
        email: email.trim(),
        displayName: displayName.trim(),
        role,
      },
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to upsert tenant member.");
  }
}, { requireTenant: true });
