import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { parseHwpxToProseMirror } from "@/lib/editor/hwpx-to-prosemirror";
import { buildTemplateCatalogFromDoc } from "@/lib/template-catalog";
import { saveBlobObject } from "@/lib/server/blob-store";
import { ensureServerDomParser } from "@/lib/server/ensure-dom-parser";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { assertTemplateQuota } from "@/lib/server/quota-store";
import { attachWorkspaceTemplateDownloads, buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { createWorkspaceTemplate, listWorkspaceTemplates } from "@/lib/server/workspace-store";

export const runtime = "nodejs";

export const GET = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const query = request.nextUrl.searchParams.get("q") || "";
    const templates = await listWorkspaceTemplates({ tenantId: actor.tenantId, actor, query });
    return NextResponse.json({ templates });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to list templates.");
  }
}, { requireTenant: true });

export const POST = withApiAuth(async (request: NextRequest, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    await assertTemplateQuota(actor.tenantId);
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
    const template = await createWorkspaceTemplate({
      tenantId: actor.tenantId,
      actor,
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
    return NextResponse.json({ template: attachWorkspaceTemplateDownloads(actor.tenantId, template) }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to create template.");
  }
}, { requireTenant: true });
