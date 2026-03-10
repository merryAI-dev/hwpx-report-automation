import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { restoreWorkspaceDocumentVersion } from "@/lib/server/workspace-store";
import { attachWorkspaceDocumentVersionDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";

export const runtime = "nodejs";

export const POST = withApiAuth(async (
  _request: NextRequest,
  session,
  context?: { params: Promise<{ documentId: string; versionId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("documentId and versionId are required.");
    }
    const { documentId, versionId } = await context.params;
    const version = await restoreWorkspaceDocumentVersion({
      tenantId: actor.tenantId,
      actor,
      documentId,
      versionId,
    });
    if (!version) {
      return NextResponse.json({ error: "Document or version not found." }, { status: 404 });
    }
    return NextResponse.json({ version: attachWorkspaceDocumentVersionDownloads(actor.tenantId, [version])[0] }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to restore document version.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string; versionId: string }> }) => Promise<Response>;
