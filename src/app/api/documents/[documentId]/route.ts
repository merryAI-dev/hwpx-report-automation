import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { getWorkspaceDocument, updateWorkspaceDocument } from "@/lib/server/workspace-store";
import { attachWorkspaceDocumentDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";

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
    const document = await getWorkspaceDocument({ tenantId: actor.tenantId, actor, documentId });
    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ document: attachWorkspaceDocumentDownloads(actor.tenantId, document) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to read document.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;

export const PATCH = withApiAuth(async (
  request: NextRequest,
  session,
  context?: { params: Promise<{ documentId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("documentId is required.");
    }
    const body = await request.json();
    if (!isRecord(body)) {
      throw new Error("Invalid JSON body.");
    }
    const { documentId } = await context.params;
    const document = await updateWorkspaceDocument({
      tenantId: actor.tenantId,
      actor,
      documentId,
      patch: {
        title: typeof body.title === "string" ? body.title : undefined,
        status: typeof body.status === "string" ? body.status as "draft" | "ready" | "archived" : undefined,
      },
    });
    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ document: attachWorkspaceDocumentDownloads(actor.tenantId, document) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to update document.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;
