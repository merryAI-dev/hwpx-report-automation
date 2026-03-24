import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { handleApiError } from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/persistence/client";
import {
  extractDraftDiff,
  aggregateCorrectionPatterns,
} from "@/lib/feedback/section-diff-extractor";
import type { ReportFamilyDraftSection } from "@/lib/report-family-draft-generator";

/**
 * POST /api/feedback/capture
 *
 * Captures human feedback for an AI-generated draft section.
 * Computes a structural diff between AI and human versions and saves
 * HumanFeedback records + optional PreferenceData records.
 *
 * Body:
 *   generationRunId  - ID of the GenerationRun this feedback applies to
 *   familyId         - ReportFamily ID (required when no generationRunId)
 *   humanSections    - ReportFamilyDraftSection[] after human editing
 *   qualityScore     - optional 1-5 rating
 *   notes            - optional reviewer notes
 *   savePreferences  - if true, also create PreferenceData records
 */

export const POST = withApiAuth(async (req, { email }) => {
  try {
    const body = (await req.json()) as {
      generationRunId?: string;
      familyId?: string;
      humanSections?: ReportFamilyDraftSection[];
      qualityScore?: number;
      notes?: string;
      savePreferences?: boolean;
    };

    if (!body.humanSections?.length) {
      throw new ValidationError("humanSections 필드가 필요합니다.");
    }

    let aiSections: ReportFamilyDraftSection[] = [];
    let familyId = body.familyId ?? "";

    // Load GenerationRun if provided
    if (body.generationRunId) {
      const run = await prisma.generationRun.findUnique({
        where: { id: body.generationRunId },
      });
      if (!run) {
        throw new ValidationError(`GenerationRun '${body.generationRunId}'를 찾을 수 없습니다.`);
      }
      const draft = JSON.parse(run.draftJson) as { sections?: ReportFamilyDraftSection[] };
      aiSections = draft.sections ?? [];
      familyId = run.familyId;

      // Mark run as accepted
      await prisma.generationRun.update({
        where: { id: run.id },
        data: { status: "accepted" },
      });
    } else if (!familyId) {
      throw new ValidationError("generationRunId 또는 familyId가 필요합니다.");
    }

    // Compute structural diffs
    const diffs = extractDraftDiff(aiSections, body.humanSections);

    // Persist HumanFeedback records (one per section with changes)
    const feedbackIds: string[] = [];
    for (const diff of diffs) {
      const aiSection = aiSections.find((s) => s.tocEntryId === diff.tocEntryId);
      const humanSection = body.humanSections.find((s) => s.tocEntryId === diff.tocEntryId);

      const feedback = await prisma.humanFeedback.create({
        data: {
          generationRunId: body.generationRunId ?? null,
          feedbackType:
            diff.changeMagnitude < 0.05 ? "section_accept" : "section_edit",
          sectionId: diff.tocEntryId,
          aiContentJson: aiSection ? JSON.stringify(aiSection) : null,
          humanContentJson: humanSection ? JSON.stringify(humanSection) : null,
          diffJson: JSON.stringify({
            paragraphChanges: diff.paragraphChanges,
            tableDiff: diff.tableDiff,
            citationsDelta: diff.citationsDelta,
            changeMagnitude: diff.changeMagnitude,
          }),
          correctionPatternJson: JSON.stringify(diff.correctionPatterns),
          qualityScore: body.qualityScore ?? null,
          reviewerEmail: email,
          notes: body.notes ?? "",
        },
      });
      feedbackIds.push(feedback.id);
    }

    // Optionally create PreferenceData records for significantly changed sections
    const preferenceIds: string[] = [];
    if (body.savePreferences) {
      for (const diff of diffs) {
        if (diff.changeMagnitude < 0.1) continue; // Skip near-identical sections

        const aiSection = aiSections.find((s) => s.tocEntryId === diff.tocEntryId);
        const humanSection = body.humanSections.find((s) => s.tocEntryId === diff.tocEntryId);
        if (!aiSection || !humanSection) continue;

        const feedback = feedbackIds[diffs.indexOf(diff)];
        const pref = await prisma.preferenceData.create({
          data: {
            familyId,
            sectionType: diff.sectionType,
            chosenJson: JSON.stringify(humanSection),
            rejectedJson: JSON.stringify(aiSection),
            correctionPatternJson: JSON.stringify(diff.correctionPatterns),
            sourceFeedbackId: feedback ?? null,
          },
        });
        preferenceIds.push(pref.id);
      }
    }

    const patternSummary = aggregateCorrectionPatterns(diffs);

    return NextResponse.json({
      feedbackIds,
      preferenceIds,
      sectionCount: diffs.length,
      patternSummary,
    });
  } catch (err) {
    return handleApiError(err, "/api/feedback/capture");
  }
});
