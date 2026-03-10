import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { createWorkspaceDocumentVersion, listWorkspaceDocumentVersions } from "@/lib/server/workspace-store";
import { attachWorkspaceDocumentVersionDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";
import type { JSONContent } from "@tiptap/core";
import type { TemplateCatalog } from "@/lib/template-catalog";
import type { WorkspaceBlobReference, WorkspaceSourceFormat, WorkspaceValidationSummary } from "@/lib/workspace-types";

function parseBlob(value: unknown): WorkspaceBlobReference {
  if (!value || typeof value !== "object") {
    throw new Error("blob is required.");
  }
  const row = value as Record<string, unknown>;
  const blobId = String(row.blobId || "").trim();
  const fileName = String(row.fileName || "").trim();
  if (!blobId || !fileName) {
    throw new Error("blob.blobId and blob.fileName are required.");
  }
  return {
    blobId,
    provider: String(row.provider || "fs").trim() || "fs",
    fileName,
    contentType: String(row.contentType || "application/octet-stream").trim() || "application/octet-stream",
    byteLength: Number(row.byteLength || 0),
    createdAt: String(row.createdAt || new Date().toISOString()),
  };
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
    const versions = await listWorkspaceDocumentVersions({ tenantId: actor.tenantId, actor, documentId });
    return NextResponse.json({ versions: attachWorkspaceDocumentVersionDownloads(actor.tenantId, versions) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list document versions.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;

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
    const body = await request.json();
    if (!isRecord(body)) {
      throw new Error("Invalid JSON body.");
    }
    const { documentId } = await context.params;
    const version = await createWorkspaceDocumentVersion({
      tenantId: actor.tenantId,
      actor,
      documentId,
      payload: {
        label: String(body.label || "manual-save").trim() || "manual-save",
        fileName: String(body.fileName || "").trim(),
        sourceFormat: String(body.sourceFormat || "hwpx") as WorkspaceSourceFormat,
        editorDoc: (body.editorDoc as JSONContent | null | undefined) ?? null,
        templateCatalog: (body.templateCatalog as TemplateCatalog | null | undefined) ?? null,
        validationSummary: (body.validationSummary as WorkspaceValidationSummary | null | undefined) ?? null,
        blob: parseBlob(body.blob),
      },
    });
    if (!version) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ version: attachWorkspaceDocumentVersionDownloads(actor.tenantId, [version])[0] }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to create document version.");
  }
}, { requireTenant: true }) as unknown as (request: NextRequest, context: { params: Promise<{ documentId: string }> }) => Promise<Response>;
