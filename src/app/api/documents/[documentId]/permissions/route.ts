import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { getWorkspaceDocument, updateWorkspaceDocumentPermissions } from "@/lib/server/workspace-store";
import { attachWorkspaceDocumentDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";
import type { WorkspacePermissionEntry } from "@/lib/workspace-types";

function parsePermissions(value: unknown): WorkspacePermissionEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("permissions must be an array.");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("permission entry is invalid.");
    }
    return {
      subjectType: "user" as const,
      subjectId: String(entry.subjectId || "").trim(),
      displayName: String(entry.displayName || entry.subjectId || "").trim(),
      role: String(entry.role || "viewer") as WorkspacePermissionEntry["role"],
    };
  });
}

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
    return NextResponse.json({ permissions: document.permissions, document: attachWorkspaceDocumentDownloads(actor.tenantId, document) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to read document permissions.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;

export const PUT = withApiAuth(async (
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
    const document = await updateWorkspaceDocumentPermissions({
      tenantId: actor.tenantId,
      actor,
      documentId,
      permissions: parsePermissions(body.permissions),
    });
    if (!document) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ permissions: document.permissions, document: attachWorkspaceDocumentDownloads(actor.tenantId, document) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to update document permissions.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;
