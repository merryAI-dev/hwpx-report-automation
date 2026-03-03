import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";
import type { UpdateDocumentInput } from "@/lib/persistence/types";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/[id] — fetch a single document with full content */
export async function GET(request: Request, context: RouteContext) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const { id } = await context.params;

  try {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) {
      return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({
      id: doc.id,
      name: doc.name,
      hwpxBlob: Buffer.from(doc.hwpxBlob).toString("base64"),
      docJson: doc.docJson,
      segments: doc.segments,
      extraSegmentsMap: doc.extraSegmentsMap,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    });
  } catch (err) {
    log.error("Failed to get document", err, { id });
    return NextResponse.json({ error: "문서를 불러오지 못했습니다." }, { status: 500 });
  }
}

/** PATCH /api/documents/[id] — update a document (optionally creating a version) */
export async function PATCH(request: Request, context: RouteContext) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const { id } = await context.params;

  try {
    const body = (await request.json()) as UpdateDocumentInput;

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.docJson !== undefined) updateData.docJson = body.docJson;
    if (body.segments !== undefined) updateData.segments = body.segments;
    if (body.extraSegmentsMap !== undefined) updateData.extraSegmentsMap = body.extraSegmentsMap;

    // Create version snapshot before updating if requested
    if (body.versionLabel) {
      await prisma.documentVersion.create({
        data: {
          documentId: id,
          docJson: existing.docJson,
          label: body.versionLabel,
        },
      });
    }

    const updated = await prisma.document.update({
      where: { id },
      data: updateData,
    });

    log.info("Document updated", { id, versionLabel: body.versionLabel });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      sizeBytes: updated.sizeBytes,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    log.error("Failed to update document", err, { id });
    return NextResponse.json({ error: "문서 수정에 실패했습니다." }, { status: 500 });
  }
}

/** DELETE /api/documents/[id] — delete a document and all its versions */
export async function DELETE(request: Request, context: RouteContext) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const { id } = await context.params;

  try {
    await prisma.document.delete({ where: { id } });
    log.info("Document deleted", { id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("Failed to delete document", err, { id });
    return NextResponse.json({ error: "문서 삭제에 실패했습니다." }, { status: 500 });
  }
}
