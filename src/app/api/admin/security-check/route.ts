import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { runSecurityChecks } from "@/lib/server/security-checklist";

export const runtime = "nodejs";

export const GET = withApiAuth(async (_request, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const roleRank: Record<string, number> = { viewer: 1, editor: 2, manager: 3, owner: 4 };
    if ((roleRank[actor.tenantRole] ?? 0) < roleRank.manager) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }
    const checks = runSecurityChecks();
    return NextResponse.json({ checks });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to run security checks.");
  }
}, { requireTenant: true });
