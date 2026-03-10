import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { duplicateWorkspaceDocument } from "@/lib/server/workspace-store";
import { assertDocumentQuota } from "@/lib/server/quota-store";
import { attachWorkspaceDocumentDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";

export const runtime = "nodejs";

export const POST = withApiAuth(async (
  request: NextRequest,
  session,
  context?: { params: Promise<{ documentId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("documentId is required.");
    }
    const body = await request.json().catch(() => ({})) as unknown;
    const title = isRecord(body) && typeof body.title === "string" ? body.title : undefined;
    const { documentId } = await context.params;
    await assertDocumentQuota(actor.tenantId);
    const document = await duplicateWorkspaceDocument({
      tenantId: actor.tenantId,
      actor,
      documentId,
      newTitle: title,
    });
    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ document: attachWorkspaceDocumentDownloads(actor.tenantId, document) }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to duplicate document.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;
