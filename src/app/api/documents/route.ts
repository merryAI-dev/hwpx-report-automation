import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  createWorkspaceDocument,
  listWorkspaceDocuments,
} from "@/lib/server/workspace-store";
import { buildWorkspaceActorFromSession, attachWorkspaceDocumentDownloads } from "@/lib/server/workspace-route-utils";
import { isRecord, workspaceErrorResponse } from "@/lib/server/workspace-api";
import { assertDocumentQuota } from "@/lib/server/quota-store";
import type {
  CreateWorkspaceDocumentPayload,
  WorkspaceBlobReference,
  WorkspacePermissionEntry,
  WorkspaceSourceFormat,
  WorkspaceValidationSummary,
} from "@/lib/workspace-types";
import type { TemplateCatalog } from "@/lib/template-catalog";
import type { JSONContent } from "@tiptap/core";

function parseBlob(value: unknown): WorkspaceBlobReference {
  if (!isRecord(value)) {
    throw new Error("blob is required.");
  }
  const blobId = String(value.blobId || "").trim();
  const fileName = String(value.fileName || "").trim();
  if (!blobId || !fileName) {
    throw new Error("blob.blobId and blob.fileName are required.");
  }
  return {
    blobId,
    provider: String(value.provider || "fs").trim() || "fs",
    fileName,
    contentType: String(value.contentType || "application/octet-stream").trim() || "application/octet-stream",
    byteLength: Number(value.byteLength || 0),
    createdAt: String(value.createdAt || new Date().toISOString()),
  };
}

function parsePermissions(value: unknown): WorkspacePermissionEntry[] | undefined {
  if (value == null) {
    return undefined;
  }
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

function parsePayload(body: unknown): CreateWorkspaceDocumentPayload {
  if (!isRecord(body)) {
    throw new Error("Invalid JSON body.");
  }
  const title = String(body.title || "").trim();
  const fileName = String(body.fileName || "").trim();
  if (!title || !fileName) {
    throw new Error("title and fileName are required.");
  }
  const sourceFormat = String(body.sourceFormat || "hwpx") as WorkspaceSourceFormat;
  const blob = parseBlob(body.blob);
  return {
    title,
    label: String(body.label || "manual-save").trim() || "manual-save",
    fileName,
    sourceFormat,
    editorDoc: (body.editorDoc as JSONContent | null | undefined) ?? null,
    templateCatalog: (body.templateCatalog as TemplateCatalog | null | undefined) ?? null,
    validationSummary: (body.validationSummary as WorkspaceValidationSummary | null | undefined) ?? null,
    blob,
    permissions: parsePermissions(body.permissions),
  };
}

export const runtime = "nodejs";

export const GET = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const query = request.nextUrl.searchParams.get("q") || "";
    const documents = await listWorkspaceDocuments({
      tenantId: actor.tenantId,
      actor,
      query,
    });
    return NextResponse.json({ documents });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list documents.");
  }
}, { requireTenant: true });

export const POST = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    await assertDocumentQuota(actor.tenantId);
    const payload = parsePayload(await request.json());
    const document = await createWorkspaceDocument({
      tenantId: actor.tenantId,
      actor,
      payload,
    });
    return NextResponse.json({ document: attachWorkspaceDocumentDownloads(actor.tenantId, document) }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to create document.");
  }
}, { requireTenant: true });
