import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/persistence/client";

/**
 * GET  /api/training/packets?familyId=xxx   - List packets for a family
 * POST /api/training/packets                - Create a training packet
 */

export const GET = withApiAuth(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const familyId = searchParams.get("familyId");

    const packets = await prisma.trainingPacket.findMany({
      where: familyId ? { familyId } : undefined,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ packets });
  } catch (err) {
    return handleApiError(err, "/api/training/packets");
  }
});

export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as {
      familyId?: string;
      sourceArtifacts?: { slideDeckFile: string; reportFile: string };
      slideClassifications?: unknown[];
      reportSectionClassifications?: unknown[];
      transformationPairs?: unknown[];
    };

    if (!body.familyId) {
      throw new ValidationError("familyId 필드가 필요합니다.");
    }
    if (!body.sourceArtifacts) {
      throw new ValidationError("sourceArtifacts 필드가 필요합니다.");
    }

    const family = await prisma.reportFamily.findUnique({
      where: { id: body.familyId },
    });
    if (!family) {
      throw new ValidationError(`ReportFamily '${body.familyId}'를 찾을 수 없습니다.`);
    }

    const packet = await prisma.trainingPacket.create({
      data: {
        familyId: body.familyId,
        sourceArtifactsJson: JSON.stringify(body.sourceArtifacts),
        slideClassificationsJson: JSON.stringify(body.slideClassifications ?? []),
        reportSectionClassificationsJson: JSON.stringify(
          body.reportSectionClassifications ?? [],
        ),
        transformationPairsJson: JSON.stringify(body.transformationPairs ?? []),
        status: "pending",
        reviewerEmail: email,
      },
    });

    return NextResponse.json({ packet }, { status: 201 });
  } catch (err) {
    return handleApiError(err, "/api/training/packets");
  }
});
