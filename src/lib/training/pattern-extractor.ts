/**
 * Pattern Extractor
 *
 * Extracts abstract TransformationRules from a PPTX+Report training pair.
 * Uses benchmark packet sectionMappings as the bridge between the source
 * slide structure and the target report section structure.
 *
 * The key output is a set of TransformationRules that describe HOW
 * a slide type maps to a report section type — structural patterns only,
 * not content.
 */

import type {
  ReportSectionTypeId,
  SlideTypeId,
  TransformationPair,
  TransformationPattern,
  TransformationRule,
} from "./types";
import type { SlideClassification } from "./types";

// ─── Packet sectionType → ReportSectionTypeId mapping ────────────────────────

/** Maps packet sectionType strings to our canonical ReportSectionTypeId. */
const PACKET_SECTION_TYPE_MAP: Record<string, ReportSectionTypeId> = {
  narrative: "narrative_overview",
  summary_table: "performance_analysis_table",
  operations_timeline: "operations_timeline_detail",
  case_study: "entity_case_study",
  survey_summary: "survey_analysis",
  strategy: "strategy_recommendation",
  appendix_evidence: "appendix_evidence",
};

function mapPacketSectionType(raw: string | undefined): ReportSectionTypeId {
  if (!raw) return "narrative_overview";
  return PACKET_SECTION_TYPE_MAP[raw] ?? "narrative_overview";
}

// ─── Slide topic → SlideTypeId heuristic mapping ──────────────────────────────

/**
 * Maps common source topic strings to abstract SlideTypeId values.
 * These are structural-role mappings, not content-specific.
 * Each entry covers a structural pattern that recurs across report families.
 */
const TOPIC_TO_SLIDE_TYPE: Array<{
  patterns: RegExp[];
  slideType: SlideTypeId;
}> = [
  {
    patterns: [/소개|overview|about|연혁|현황|미션|비전/i],
    slideType: "organization_overview",
  },
  {
    patterns: [/kpi|달성|목표|성과지표|핵심.*목표/i],
    slideType: "kpi_dashboard",
  },
  {
    patterns: [/일정|추진|timeline|schedule|주요.*사항|세부.*추진/i],
    slideType: "timeline_gantt",
  },
  {
    patterns: [/기업별|상세내용|기업.*상세|기업.*현황|entity|company/i],
    slideType: "entity_detail_card",
  },
  {
    patterns: [/총괄표|성과.*총괄|종합표|summary.*table/i],
    slideType: "comparison_table",
  },
  {
    patterns: [/만족도|설문|survey|satisfaction/i],
    slideType: "survey_result",
  },
  {
    // "제언" / "향후" are unambiguous recommendation signals
    // Avoid matching "전략" alone — "핵심 전략" is org overview, not a recommendation
    patterns: [/제언|향후.*전략|향후.*계획|recommendation/i, /^전략$|^제언$|^향후$/],
    slideType: "recommendation",
  },
  {
    patterns: [/홍보|보도자료|알럼나이|사후관리|모집|선발/i],
    slideType: "bullet_summary",
  },
];

function inferSlideTypeFromTopic(topic: string): SlideTypeId {
  for (const { patterns, slideType } of TOPIC_TO_SLIDE_TYPE) {
    if (patterns.some((re) => re.test(topic))) return slideType;
  }
  return "unknown";
}

// ─── TransformationPattern inference ─────────────────────────────────────────

function inferTransformationPattern(
  slideType: SlideTypeId,
  reportSectionType: ReportSectionTypeId,
): TransformationPattern {
  if (
    slideType === "kpi_dashboard" &&
    reportSectionType === "performance_analysis_table"
  ) {
    return "kpi_to_achievement_table";
  }
  if (
    slideType === "comparison_table" &&
    reportSectionType === "performance_analysis_table"
  ) {
    return "table_with_narrative_interpretation";
  }
  if (
    slideType === "timeline_gantt" &&
    reportSectionType === "operations_timeline_detail"
  ) {
    return "bullet_to_chronological_narrative";
  }
  if (
    slideType === "entity_detail_card" &&
    reportSectionType === "entity_case_study"
  ) {
    return "card_to_multi_page_detail";
  }
  if (
    slideType === "organization_overview" &&
    reportSectionType === "narrative_overview"
  ) {
    return "overview_to_narrative_section";
  }
  if (
    slideType === "survey_result" &&
    reportSectionType === "survey_analysis"
  ) {
    return "survey_to_analysis_section";
  }
  if (
    slideType === "recommendation" &&
    reportSectionType === "strategy_recommendation"
  ) {
    return "recommendation_to_strategy_section";
  }
  if (
    slideType === "cover_divider" &&
    (reportSectionType === "toc_cover" || reportSectionType === "appendix_evidence")
  ) {
    return "divider_to_chapter_heading";
  }
  if (reportSectionType === "appendix_evidence") {
    return "table_with_narrative_interpretation";
  }
  // Default: visual elements become text
  return "visual_to_text_description";
}

/** Estimated expansion factor: how much longer the report section is vs the slide. */
function inferExpansionFactor(
  slideType: SlideTypeId,
  reportSectionType: ReportSectionTypeId,
): number {
  // entity_detail_card → multi-page case study is the biggest expansion
  if (
    slideType === "entity_detail_card" &&
    reportSectionType === "entity_case_study"
  ) {
    return 4.0;
  }
  // Operations timeline: slides have bullets, report has full chronological prose
  if (reportSectionType === "operations_timeline_detail") return 3.0;
  // Narrative sections expand significantly from bullet slides
  if (reportSectionType === "narrative_overview") return 2.5;
  // KPI → table with narrative is about 2x
  if (reportSectionType === "performance_analysis_table") return 2.0;
  // Survey → analysis is roughly 1.5x
  if (reportSectionType === "survey_analysis") return 1.5;
  // Appendix evidence stays similar
  if (reportSectionType === "appendix_evidence") return 1.2;
  // Default
  return 2.0;
}

/** Output components that appear in the report section. */
function inferOutputComponents(
  reportSectionType: ReportSectionTypeId,
): string[] {
  switch (reportSectionType) {
    case "performance_analysis_table":
      return ["achievement_table", "interpretation_paragraph"];
    case "operations_timeline_detail":
      return ["chronological_narrative", "activity_list", "result_annotation"];
    case "narrative_overview":
      return ["background_paragraph", "context_paragraph"];
    case "entity_case_study":
      return ["entity_heading", "growth_narrative", "kpi_summary", "evidence_reference"];
    case "survey_analysis":
      return ["satisfaction_score", "analysis_paragraph", "comparison_note"];
    case "strategy_recommendation":
      return ["recommendation_paragraph", "action_items"];
    case "appendix_evidence":
      return ["evidence_table", "reference_list"];
    case "toc_cover":
      return ["chapter_heading"];
    default:
      return ["paragraph"];
  }
}

// ─── Core Extraction Logic ────────────────────────────────────────────────────

export type PacketSectionMapping = {
  sectionType?: string;
  sourceTopics?: string[];
  sourceKeywords?: string[];
  note?: string;
};

export type BenchmarkPacketInput = {
  familyId: string;
  packetId: string;
  sourceArtifacts: {
    sourceDeckFileName: string;
    targetReportFileName: string;
  };
  sectionMappings?: Record<string, PacketSectionMapping>;
};

/**
 * Extract TransformationPairs from a benchmark packet's sectionMappings.
 *
 * Each report section entry in sectionMappings produces one or more pairs
 * by matching source topics to the classified slide types.
 */
export function extractTransformationPairs(
  packet: BenchmarkPacketInput,
  slideClassifications?: SlideClassification[],
): TransformationPair[] {
  const pairs: TransformationPair[] = [];
  const mappings = packet.sectionMappings ?? {};

  // Build a quick lookup: slideTitle → SlideTypeId (from classifier output)
  const classifiedTopicTypes = new Map<string, SlideTypeId>();
  if (slideClassifications) {
    for (const cls of slideClassifications) {
      classifiedTopicTypes.set(String(cls.slideNumber), cls.slideType);
    }
  }

  let pairIndex = 0;
  for (const [sectionTitle, mapping] of Object.entries(mappings)) {
    const reportSectionType = mapPacketSectionType(mapping.sectionType);
    const sourceTopics = mapping.sourceTopics ?? [];

    // For each source topic, create a transformation pair
    for (const topic of sourceTopics) {
      // Prefer classifier output; fall back to heuristic inference
      const slideType = inferSlideTypeFromTopic(topic);

      if (slideType === "unknown") continue; // Skip unresolved topics

      pairs.push({
        slideNumber: pairIndex++, // Virtual slide index for ordering
        slideType,
        reportSectionId: sectionTitle,
        reportSectionType,
        transformationPattern: inferTransformationPattern(slideType, reportSectionType),
        expansionFactor: inferExpansionFactor(slideType, reportSectionType),
        reviewerNote: mapping.note,
      });
    }
  }

  return pairs;
}

/**
 * Aggregate TransformationPairs into deduplicated TransformationRules.
 *
 * Rules are aggregated by (slideType, reportSectionType) pair.
 * Confidence is derived from the number of supporting examples.
 */
export function aggregateTransformationRules(
  pairs: TransformationPair[],
): TransformationRule[] {
  const ruleMap = new Map<
    string,
    {
      slideType: SlideTypeId;
      reportSectionType: ReportSectionTypeId;
      patterns: TransformationPattern[];
      expansionFactors: number[];
      count: number;
    }
  >();

  for (const pair of pairs) {
    const key = `${pair.slideType}::${pair.reportSectionType}`;
    if (!ruleMap.has(key)) {
      ruleMap.set(key, {
        slideType: pair.slideType,
        reportSectionType: pair.reportSectionType,
        patterns: [],
        expansionFactors: [],
        count: 0,
      });
    }
    const entry = ruleMap.get(key)!;
    entry.patterns.push(pair.transformationPattern);
    entry.expansionFactors.push(pair.expansionFactor);
    entry.count++;
  }

  const rules: TransformationRule[] = [];
  for (const [key, entry] of ruleMap.entries()) {
    // Pick the most common pattern
    const patternCounts = new Map<TransformationPattern, number>();
    for (const p of entry.patterns) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
    const topPattern = [...patternCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];

    const avgExpansion =
      entry.expansionFactors.reduce((a, b) => a + b, 0) /
      entry.expansionFactors.length;

    // Confidence: 1 example = 0.4, 3+ = 0.8, 5+ = 0.95
    const confidence = Math.min(0.4 + (entry.count - 1) * 0.15, 0.95);

    rules.push({
      ruleId: key,
      slideType: entry.slideType,
      reportSectionType: entry.reportSectionType,
      transformationPattern: topPattern,
      structuralExpansionFactor: Math.round(avgExpansion * 10) / 10,
      outputComponents: inferOutputComponents(entry.reportSectionType),
      confidence,
      supportingExampleCount: entry.count,
    });
  }

  // Sort by confidence descending
  return rules.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Full pipeline: benchmark packet → TransformationRules
 * This is the main entry point for the pattern extractor.
 */
export function extractPatterns(
  packet: BenchmarkPacketInput,
  slideClassifications?: SlideClassification[],
): {
  pairs: TransformationPair[];
  rules: TransformationRule[];
  stats: {
    totalPairs: number;
    uniqueSlideTypes: number;
    uniqueSectionTypes: number;
    topRuleByConfidence: TransformationRule | null;
  };
} {
  const pairs = extractTransformationPairs(packet, slideClassifications);
  const rules = aggregateTransformationRules(pairs);

  const slideTypes = new Set(pairs.map((p) => p.slideType));
  const sectionTypes = new Set(pairs.map((p) => p.reportSectionType));

  return {
    pairs,
    rules,
    stats: {
      totalPairs: pairs.length,
      uniqueSlideTypes: slideTypes.size,
      uniqueSectionTypes: sectionTypes.size,
      topRuleByConfidence: rules[0] ?? null,
    },
  };
}
