import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { prisma } from "@/lib/persistence/client";
import { aggregateTransformationRules } from "@/lib/training/pattern-extractor";
import type { TransformationPair } from "@/lib/training/types";

type RouteContext = { params: Promise<{ packetId: string }> };

/**
 * GET /api/training/packets/[packetId]
 * Returns the packet with parsed JSON fields and inferred rules summary.
 */
export const GET = withApiAuth<Request, RouteContext>(
  async (_req, _session, context) => {
    try {
      const { packetId } = await (
        context?.params ?? Promise.resolve({ packetId: "" })
      );

      const packet = await prisma.trainingPacket.findUnique({
        where: { id: packetId },
        include: { family: true },
      });

      if (!packet) {
        return NextResponse.json(
          { error: "Training packet을 찾을 수 없습니다." },
          { status: 404 },
        );
      }

      const slideClassifications = JSON.parse(packet.slideClassificationsJson);
      const transformationPairs: TransformationPair[] = JSON.parse(
        packet.transformationPairsJson,
      );
      const inferredRules = aggregateTransformationRules(transformationPairs);

      return NextResponse.json({
        packet: {
          ...packet,
          slideClassifications,
          reportSectionClassifications: JSON.parse(
            packet.reportSectionClassificationsJson,
          ),
          transformationPairs,
          sourceArtifacts: JSON.parse(packet.sourceArtifactsJson),
        },
        inferredRules,
        summary: {
          totalPairs: transformationPairs.length,
          totalRules: inferredRules.length,
          topRule: inferredRules[0] ?? null,
        },
      });
    } catch (err) {
      return handleApiError(err, "/api/training/packets/[packetId]");
    }
  },
);

/**
 * PATCH /api/training/packets/[packetId]
 * Update packet status (pending → reviewed → gold).
 */
export const PATCH = withApiAuth<Request, RouteContext>(
  async (req, session, context) => {
    try {
      const { packetId } = await (
        context?.params ?? Promise.resolve({ packetId: "" })
      );
      const body = (await req.json()) as { status?: string };
      const validStatuses = ["pending", "reviewed", "gold"];

      if (!body.status || !validStatuses.includes(body.status)) {
        return NextResponse.json(
          { error: `status는 ${validStatuses.join(", ")} 중 하나여야 합니다.` },
          { status: 400 },
        );
      }

      const packet = await prisma.trainingPacket.update({
        where: { id: packetId },
        data: {
          status: body.status,
          reviewerEmail: session.email,
          reviewedAt: body.status !== "pending" ? new Date() : null,
        },
      });

      return NextResponse.json({ packet });
    } catch (err) {
      return handleApiError(err, "/api/training/packets/[packetId]");
    }
  },
);
