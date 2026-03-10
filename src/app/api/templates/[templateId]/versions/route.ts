import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { buildTemplateCatalogFromDoc } from "@/lib/template-catalog";
import { saveBlobObject } from "@/lib/server/blob-store";
import { ensureServerDomParser } from "@/lib/server/ensure-dom-parser";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { attachWorkspaceTemplateVersionDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { createWorkspaceTemplateVersion, listWorkspaceTemplateVersions } from "@/lib/server/workspace-store";

export const runtime = "nodejs";

export const GET = withApiAuth(async (
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
    const versions = await listWorkspaceTemplateVersions({ tenantId: actor.tenantId, actor, templateId });
    return NextResponse.json({ versions: attachWorkspaceTemplateVersionDownloads(actor.tenantId, versions) });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list template versions.");
  }
}, { requireTenant: true });

export const POST = withApiAuth(async (
  request: NextRequest,
  session,
  context?: { params: Promise<{ templateId: string }> },
) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    if (!context) {
      throw new Error("templateId is required.");
    }
    const { templateId } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("file is required.");
    }
    await ensureServerDomParser();
    const buffer = await file.arrayBuffer();
    const descriptor = await saveBlobObject({
      tenantId: actor.tenantId,
      fileName: String(formData.get("fileName") || file.name || "template.hwpx"),
      contentType: file.type || "application/octet-stream",
      buffer,
    });
    const parsed = await parseHwpxToProseMirror(buffer);
    const catalog = buildTemplateCatalogFromDoc(parsed.doc);
    const version = await createWorkspaceTemplateVersion({
      tenantId: actor.tenantId,
      actor,
      templateId,
      payload: {
        name: String(formData.get("name") || file.name || "Untitled Template"),
        documentType: String(formData.get("documentType") || "report"),
        fileName: file.name || "template.hwpx",
        blob: {
          blobId: descriptor.blobId,
          provider: descriptor.provider,
          fileName: descriptor.fileName,
          contentType: descriptor.contentType,
          byteLength: descriptor.byteLength,
          createdAt: descriptor.createdAt,
        },
        catalog,
      },
    });
    if (!version) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }
    return NextResponse.json({ version: attachWorkspaceTemplateVersionDownloads(actor.tenantId, [version])[0] }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to create template version.");
  }
}, { requireTenant: true });
