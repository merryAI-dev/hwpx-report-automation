import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

type RouteContext = { params: Promise<{ id: string; versionId: string }> };

/** GET /api/documents/[id]/versions/[versionId] — get version detail with docJson */
export async function GET(request: Request, context: RouteContext) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const { id, versionId } = await context.params;

  try {
    const version = await prisma.documentVersion.findFirst({
      where: { id: versionId, documentId: id },
      select: {
        id: true,
        documentId: true,
        label: true,
        docJson: true,
        createdAt: true,
      },
    });

    if (!version) {
      return NextResponse.json({ error: "버전을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({
      id: version.id,
      documentId: version.documentId,
      label: version.label,
      docJson: version.docJson,
      createdAt: version.createdAt.toISOString(),
    });
  } catch (err) {
    log.error("Failed to get version detail", err, { documentId: id, versionId });
    return NextResponse.json({ error: "버전 조회 실패" }, { status: 500 });
  }
}
