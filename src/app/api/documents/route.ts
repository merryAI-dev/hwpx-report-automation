import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";
import type { DocumentRecord, CreateDocumentInput } from "@/lib/persistence/types";

/** GET /api/documents — list all documents (most recent first) */
export async function GET(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  try {
    const docs = await prisma.document.findMany({
      select: {
        id: true,
        name: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    const records: DocumentRecord[] = docs.map((d) => ({
      id: d.id,
      name: d.name,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));

    return NextResponse.json({ documents: records });
  } catch (err) {
    log.error("Failed to list documents", err);
    return NextResponse.json({ error: "문서 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

/** POST /api/documents — create a new document */
export async function POST(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as CreateDocumentInput;
    if (!body.name || !body.docJson) {
      return NextResponse.json(
        { error: "name과 docJson은 필수입니다." },
        { status: 400 },
      );
    }

    // Validate document name
    const name = body.name.trim();
    if (name.length < 1 || name.length > 255) {
      return NextResponse.json(
        { error: "문서 이름은 1~255자여야 합니다." },
        { status: 400 },
      );
    }
    if (/[/\\<>:"|?*\x00-\x1f]/.test(name) || name.includes("..")) {
      return NextResponse.json(
        { error: "문서 이름에 허용되지 않는 문자가 포함되어 있습니다." },
        { status: 400 },
      );
    }

    // Accept hwpxBlob as base64 string
    const hwpxBuffer = body.hwpxBlob
      ? Buffer.from(body.hwpxBlob as unknown as string, "base64")
      : Buffer.alloc(0);

    const doc = await prisma.document.create({
      data: {
        name,
        hwpxBlob: hwpxBuffer,
        docJson: body.docJson,
        segments: body.segments || "[]",
        extraSegmentsMap: body.extraSegmentsMap || "{}",
        sizeBytes: hwpxBuffer.byteLength,
      },
    });

    log.info("Document created", { id: doc.id, name: doc.name, sizeBytes: doc.sizeBytes });

    return NextResponse.json({
      id: doc.id,
      name: doc.name,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (err) {
    log.error("Failed to create document", err);
    return NextResponse.json({ error: "문서 저장에 실패했습니다." }, { status: 500 });
  }
}
