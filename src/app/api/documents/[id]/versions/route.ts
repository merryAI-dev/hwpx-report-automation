import { NextResponse } from "next/server";
import { prisma } from "@/lib/persistence/client";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/[id]/versions — list versions for a document */
export async function GET(request: Request, context: RouteContext) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const { id } = await context.params;

  try {
    const doc = await prisma.document.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!doc) {
      return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    }

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: id },
      select: {
        id: true,
        documentId: true,
        label: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        documentId: v.documentId,
        label: v.label,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error("Failed to list document versions", err, { documentId: id });
    return NextResponse.json({ error: "버전 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
