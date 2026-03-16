import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { buildPromptMemoriesForFamily } from "@/lib/feedback/prompt-memory-builder";
import { prisma } from "@/lib/persistence/client";

/**
 * POST /api/feedback/promote
 *
 * Scans accumulated PreferenceData for a family and promotes recurring patterns
 * into PromptMemory entries. Run this after collecting enough feedback
 * (or on a scheduled basis) to trigger prompt improvement.
 *
 * Body:
 *   familyId  - ReportFamily ID to process
 */
export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as { familyId?: string };

    if (!body.familyId) {
      throw new ValidationError("familyId 필드가 필요합니다.");
    }

    const family = await prisma.reportFamily.findUnique({
      where: { id: body.familyId },
    });
    if (!family) {
      throw new ValidationError(`ReportFamily '${body.familyId}'를 찾을 수 없습니다.`);
    }

    const preferenceCount = await prisma.preferenceData.count({
      where: { familyId: body.familyId },
    });

    const createdIds = await buildPromptMemoriesForFamily(body.familyId);

    log.info("PromptMemory promotion complete", {
      familyId: body.familyId,
      familyName: family.name,
      preferenceCount,
      memoriesCreated: createdIds.length,
      email,
    });

    // Return current active memories for this family
    const memories = await prisma.promptMemory.findMany({
      where: { familyId: body.familyId, status: "active" },
      orderBy: { priority: "desc" },
    });

    return NextResponse.json({
      memoriesCreated: createdIds.length,
      createdIds,
      totalActiveMemories: memories.length,
      memories,
    });
  } catch (err) {
    return handleApiError(err, "/api/feedback/promote");
  }
});

/**
 * GET /api/feedback/promote?familyId=xxx
 *
 * List active PromptMemory entries for a family.
 */
export const GET = withApiAuth(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const familyId = searchParams.get("familyId");
    const sectionType = searchParams.get("sectionType") ?? undefined;

    const memories = await prisma.promptMemory.findMany({
      where: {
        ...(familyId ? { familyId } : {}),
        ...(sectionType ? { sectionType } : {}),
        status: "active",
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ memories });
  } catch (err) {
    return handleApiError(err, "/api/feedback/promote");
  }
});
