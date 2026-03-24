import type { ReportFamilyPlan, SectionPromptPlan } from "@/lib/report-family-planner";

type BuildReportFamilyPromptContextParams = {
  plan: ReportFamilyPlan | null;
  segmentId?: string | null;
  text: string;
  sectionTitle?: string;
  prevText?: string;
  nextText?: string;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeToken(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/[^0-9a-zA-Z가-힣]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scoreTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function segmentBelongsToSection(section: SectionPromptPlan, segmentId: string | null | undefined): boolean {
  if (!segmentId) {
    return false;
  }
  return (
    section.supportingChunks.some((chunk) => chunk.segmentIds.includes(segmentId)) ||
    section.evidenceBundles.some((bundle) => bundle.segmentIds.includes(segmentId))
  );
}

function sectionScore(
  section: SectionPromptPlan,
  params: BuildReportFamilyPromptContextParams,
): number {
  const bodyText = normalizeWhitespace(
    [params.sectionTitle, params.text, params.prevText, params.nextText].filter(Boolean).join(" "),
  );
  let score = 0;

  if (segmentBelongsToSection(section, params.segmentId)) {
    score += 6;
  }
  if (
    params.sectionTitle &&
    normalizeToken(params.sectionTitle) === normalizeToken(section.tocTitle)
  ) {
    score += 3;
  }

  score += Math.max(
    scoreTokenOverlap(bodyText, section.tocTitle) * 2.2,
    scoreTokenOverlap(
      bodyText,
      section.supportingChunks.map((chunk) => `${chunk.title} ${chunk.summary}`).join(" "),
    ) * 1.6,
  );

  if (
    section.focusEntities.some((entity) => normalizeToken(bodyText).includes(normalizeToken(entity)))
  ) {
    score += 1.5;
  }

  if (section.evidenceExpectation === "appendix_bundle_required" && section.evidenceBundles.length) {
    score += scoreTokenOverlap(
      bodyText,
      section.evidenceBundles.map((bundle) => `${bundle.title} ${bundle.summary}`).join(" "),
    );
  }

  return score;
}

export function matchReportFamilySection(
  params: BuildReportFamilyPromptContextParams,
): SectionPromptPlan | null {
  if (!params.plan?.sectionPlans.length || !normalizeWhitespace(params.text)) {
    return null;
  }

  const ranked = params.plan.sectionPlans
    .map((section) => ({
      section,
      score: sectionScore(section, params),
    }))
    .sort((left, right) => right.score - left.score);

  if (!ranked.length || ranked[0]!.score < 0.6) {
    return null;
  }

  return ranked[0]!.section;
}

export function buildReportFamilyPromptContext(
  params: BuildReportFamilyPromptContextParams,
): string {
  const matched = matchReportFamilySection(params);
  if (!matched || !params.plan) {
    return "";
  }

  const lines: string[] = [
    "[report-family-plan]",
    `family: ${params.plan.familyId || params.plan.familyName}`,
    `section: ${matched.tocTitle}`,
    `section_type: ${matched.sectionType}`,
    `evidence_expectation: ${matched.evidenceExpectation}`,
    `chunking_strategy: ${matched.chunkingStrategy}`,
  ];

  if (matched.focusEntities.length) {
    lines.push(`focus_entities: ${matched.focusEntities.join(", ")}`);
  }

  if (matched.outputScaffold.length) {
    lines.push("output_scaffold:");
    for (const line of matched.outputScaffold.slice(0, 3)) {
      lines.push(`- ${line}`);
    }
  }

  if (matched.supportingChunks.length) {
    lines.push("preferred_supporting_slides:");
    for (const chunk of matched.supportingChunks.slice(0, 2)) {
      lines.push(`- ${chunk.title}`);
    }
  }

  if (matched.evidenceBundles.length) {
    lines.push("appendix_evidence_candidates:");
    for (const bundle of matched.evidenceBundles.slice(0, 2)) {
      lines.push(`- ${bundle.fileName} | ${bundle.title}`);
    }
  }

  lines.push("follow the matched section plan over generic rewriting.");
  return lines.join("\n");
}
