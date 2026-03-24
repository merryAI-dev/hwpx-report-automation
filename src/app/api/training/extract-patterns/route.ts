import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { extractPatterns } from "@/lib/training/pattern-extractor";
import { classifySlides } from "@/lib/training/slide-type-classifier";
import type { BenchmarkPacketInput } from "@/lib/training/pattern-extractor";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import { prisma } from "@/lib/persistence/client";

/**
 * POST /api/training/extract-patterns
 *
 * Extracts abstract structural transformation patterns from a PPTX+Report pair.
 * Uses the benchmark packet sectionMappings as the alignment bridge.
 *
 * Body:
 *   familyId       - existing ReportFamily id
 *   packet         - BenchmarkPacketInput (sectionMappings etc.)
 *   slideSegments  - EditorSegment[] from pptx-to-prosemirror (optional)
 *   saveToDb       - if true, creates a TrainingPacket record (default: false)
 */
export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as {
      familyId?: string;
      packet?: BenchmarkPacketInput;
      slideSegments?: EditorSegment[];
      saveToDb?: boolean;
    };

    if (!body.packet) {
      throw new ValidationError("packet 필드가 필요합니다.");
    }
    if (!body.packet.familyId) {
      throw new ValidationError("packet.familyId 필드가 필요합니다.");
    }

    const familyId = body.familyId ?? body.packet.familyId;

    // Classify slides if segments provided
    const slideClassifications = body.slideSegments?.length
      ? classifySlides(body.slideSegments)
      : undefined;

    // Extract patterns
    const result = extractPatterns(body.packet, slideClassifications);

    log.info("Training pattern extraction complete", {
      familyId,
      pairsFound: result.stats.totalPairs,
      rulesFound: result.rules.length,
      uniqueSlideTypes: result.stats.uniqueSlideTypes,
      email,
    });

    // Optionally persist to DB
    let packetId: string | null = null;
    if (body.saveToDb) {
      // Verify family exists
      const family = await prisma.reportFamily.findUnique({
        where: { id: familyId },
      });
      if (!family) {
        throw new ValidationError(`ReportFamily '${familyId}'를 찾을 수 없습니다.`);
      }

      const packet = await prisma.trainingPacket.create({
        data: {
          familyId,
          sourceArtifactsJson: JSON.stringify(body.packet.sourceArtifacts),
          slideClassificationsJson: JSON.stringify(slideClassifications ?? []),
          transformationPairsJson: JSON.stringify(result.pairs),
          status: "pending",
          reviewerEmail: email,
        },
      });
      packetId = packet.id;
    }

    return NextResponse.json({
      packetId,
      slideClassifications: slideClassifications ?? [],
      transformationPairs: result.pairs,
      inferredRules: result.rules,
      stats: result.stats,
      warnings: [],
    });
  } catch (err) {
    return handleApiError(err, "/api/training/extract-patterns");
  }
});
