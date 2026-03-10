import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { approveWorkspaceTemplate } from "@/lib/server/workspace-store";
import { attachWorkspaceTemplateDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";

export const runtime = "nodejs";

export const POST = withApiAuth(async (
  _request: NextRequest,
  session,
  context?: { params: Promise<{ templateId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("templateId is required.");
    }
    const { templateId } = await context.params;
    const template = await approveWorkspaceTemplate({ tenantId: actor.tenantId, actor, templateId });
    if (!template) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }
    return NextResponse.json({ template: attachWorkspaceTemplateDownloads(actor.tenantId, template) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to approve template.");
  }
}, { requireTenant: true });
