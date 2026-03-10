import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { getWorkspaceTemplateVersion } from "@/lib/server/workspace-store";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { diffTemplateCatalogs } from "@/lib/server/template-diff";

export const runtime = "nodejs";

export const GET = withApiAuth(async (
  request: NextRequest,
  session,
  context?: { params: Promise<{ templateId: string; versionId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("templateId and versionId are required.");
    }
    const { templateId, versionId } = await context.params;
    const withVersionId = request.nextUrl.searchParams.get("with");
    if (!withVersionId) {
      throw new Error("Query parameter 'with' (otherVersionId) is required.");
    }
    const [fromVersion, toVersion] = await Promise.all([
      getWorkspaceTemplateVersion({ tenantId: actor.tenantId, actor, templateId, versionId }),
      getWorkspaceTemplateVersion({ tenantId: actor.tenantId, actor, templateId, versionId: withVersionId }),
    ]);
    if (!fromVersion) {
      return NextResponse.json({ error: "Base version not found." }, { status: 404 });
    }
    if (!toVersion) {
      return NextResponse.json({ error: "Comparison version not found." }, { status: 404 });
    }
    const diff = diffTemplateCatalogs(versionId, fromVersion.catalog, withVersionId, toVersion.catalog);
    return NextResponse.json({ diff });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to diff template versions.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ templateId: string; versionId: string }> }) => Promise<Response>;
