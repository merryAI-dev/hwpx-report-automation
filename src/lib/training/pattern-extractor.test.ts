import { describe, expect, it } from "vitest";
import {
  aggregateTransformationRules,
  extractPatterns,
  extractTransformationPairs,
  type BenchmarkPacketInput,
} from "./pattern-extractor";

// ─── Test Data ────────────────────────────────────────────────────────────────

const MYSC_PACKET: BenchmarkPacketInput = {
  familyId: "mysc-final-report",
  packetId: "mysc-marine-2025-final-pair",
  sourceArtifacts: {
    sourceDeckFileName: "source-deck.pptx",
    targetReportFileName: "target-report.pdf",
  },
  sectionMappings: {
    프로그램개요: {
      sectionType: "narrative",
      sourceTopics: ["운영사 소개", "프로그램 핵심 전략"],
      note: "Test note",
    },
    성과총괄표: {
      sectionType: "summary_table",
      sourceTopics: ["핵심 달성 목표", "기업 성과 총괄표"],
    },
    세부추진결과: {
      sectionType: "operations_timeline",
      sourceTopics: ["주요 추진 사항", "주요 일정"],
    },
    기업육성상세: {
      sectionType: "narrative",
      sourceTopics: ["기업별 상세내용", "기업별 상세 현황"],
    },
    우수사례: {
      sectionType: "case_study",
      sourceTopics: ["기업별 상세내용"],
    },
    만족도조사: {
      sectionType: "survey_summary",
      sourceTopics: ["만족도조사"],
    },
    향후전략: {
      sectionType: "strategy",
      sourceTopics: ["제언", "프로그램 제언"],
    },
  },
};

// ─── extractTransformationPairs ───────────────────────────────────────────────

describe("extractTransformationPairs", () => {
  it("produces pairs from sectionMappings", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it("maps 운영사 소개 topic to organization_overview slide type", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const orgPair = pairs.find((p) => p.slideType === "organization_overview");
    expect(orgPair).toBeDefined();
    expect(orgPair!.reportSectionType).toBe("narrative_overview");
  });

  it("maps 핵심 달성 목표 topic to kpi_dashboard slide type", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const kpiPair = pairs.find((p) => p.slideType === "kpi_dashboard");
    expect(kpiPair).toBeDefined();
    expect(kpiPair!.reportSectionType).toBe("performance_analysis_table");
  });

  it("maps timeline topics to timeline_gantt", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const timelinePair = pairs.find((p) => p.slideType === "timeline_gantt");
    expect(timelinePair).toBeDefined();
    expect(timelinePair!.reportSectionType).toBe("operations_timeline_detail");
  });

  it("maps 기업별 상세 topics to entity_detail_card", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const entityPair = pairs.find((p) => p.slideType === "entity_detail_card");
    expect(entityPair).toBeDefined();
    expect(entityPair!.reportSectionType).toMatch(/entity_case_study|narrative_overview/);
  });

  it("maps 만족도 topic to survey_result", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const surveyPair = pairs.find((p) => p.slideType === "survey_result");
    expect(surveyPair).toBeDefined();
    expect(surveyPair!.reportSectionType).toBe("survey_analysis");
  });

  it("maps 제언 topic to recommendation", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const recPair = pairs.find((p) => p.slideType === "recommendation");
    expect(recPair).toBeDefined();
    expect(recPair!.reportSectionType).toBe("strategy_recommendation");
  });

  it("includes reviewer note when present", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const withNote = pairs.filter((p) => p.reviewerNote);
    expect(withNote.length).toBeGreaterThan(0);
    expect(withNote[0].reviewerNote).toBe("Test note");
  });

  it("skips unknown slide topics gracefully", () => {
    const packetWithUnknown: BenchmarkPacketInput = {
      ...MYSC_PACKET,
      sectionMappings: {
        unknown_section: {
          sectionType: "narrative",
          sourceTopics: ["알수없는내용xyz123"],
        },
      },
    };
    const pairs = extractTransformationPairs(packetWithUnknown);
    // Should produce 0 pairs since topic can't be mapped
    expect(pairs).toHaveLength(0);
  });

  it("handles empty sectionMappings", () => {
    const emptyPacket: BenchmarkPacketInput = {
      ...MYSC_PACKET,
      sectionMappings: {},
    };
    const pairs = extractTransformationPairs(emptyPacket);
    expect(pairs).toHaveLength(0);
  });
});

// ─── aggregateTransformationRules ────────────────────────────────────────────

describe("aggregateTransformationRules", () => {
  it("deduplicates pairs into rules", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const rules = aggregateTransformationRules(pairs);
    // Rules should be fewer than pairs (aggregated by type pair)
    expect(rules.length).toBeLessThan(pairs.length);
  });

  it("produces rules with confidence > 0", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const rules = aggregateTransformationRules(pairs);
    for (const rule of rules) {
      expect(rule.confidence).toBeGreaterThan(0);
      expect(rule.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("assigns higher confidence to rules with more examples", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const rules = aggregateTransformationRules(pairs);
    const sortedBySupport = [...rules].sort(
      (a, b) => b.supportingExampleCount - a.supportingExampleCount,
    );
    const sortedByConfidence = [...rules].sort(
      (a, b) => b.confidence - a.confidence,
    );
    // The rule with most examples should have highest confidence
    expect(sortedBySupport[0].ruleId).toBe(sortedByConfidence[0].ruleId);
  });

  it("includes outputComponents for each rule", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const rules = aggregateTransformationRules(pairs);
    for (const rule of rules) {
      expect(rule.outputComponents.length).toBeGreaterThan(0);
    }
  });

  it("assigns expansion factor > 1 for entity_case_study", () => {
    const pairs = extractTransformationPairs(MYSC_PACKET);
    const rules = aggregateTransformationRules(pairs);
    const entityRule = rules.find(
      (r) => r.reportSectionType === "entity_case_study",
    );
    if (entityRule) {
      expect(entityRule.structuralExpansionFactor).toBeGreaterThanOrEqual(3.0);
    }
  });
});

// ─── extractPatterns (full pipeline) ─────────────────────────────────────────

describe("extractPatterns — full pipeline", () => {
  it("returns pairs, rules, and stats", () => {
    const result = extractPatterns(MYSC_PACKET);
    expect(result.pairs).toBeDefined();
    expect(result.rules).toBeDefined();
    expect(result.stats).toBeDefined();
  });

  it("stats.totalPairs matches pairs array length", () => {
    const result = extractPatterns(MYSC_PACKET);
    expect(result.stats.totalPairs).toBe(result.pairs.length);
  });

  it("stats.uniqueSlideTypes > 0", () => {
    const result = extractPatterns(MYSC_PACKET);
    expect(result.stats.uniqueSlideTypes).toBeGreaterThan(0);
  });

  it("stats.topRuleByConfidence is the highest-confidence rule", () => {
    const result = extractPatterns(MYSC_PACKET);
    if (result.rules.length > 0) {
      expect(result.stats.topRuleByConfidence?.ruleId).toBe(
        result.rules[0].ruleId,
      );
    }
  });

  it("produces distinct slide types from marine accelerator packet", () => {
    const result = extractPatterns(MYSC_PACKET);
    const slideTypes = new Set(result.pairs.map((p) => p.slideType));
    // Marine accelerator deck should produce at least 4 distinct slide types
    expect(slideTypes.size).toBeGreaterThanOrEqual(4);
  });

  it("all TransformationRules have ruleId matching slideType::sectionType", () => {
    const result = extractPatterns(MYSC_PACKET);
    for (const rule of result.rules) {
      expect(rule.ruleId).toBe(`${rule.slideType}::${rule.reportSectionType}`);
    }
  });

  it("content-agnostic: same structure, different domain produces same rules", () => {
    // A generic program evaluation packet with the same structural mapping
    const genericPacket: BenchmarkPacketInput = {
      familyId: "generic-program-eval",
      packetId: "generic-eval-001",
      sourceArtifacts: {
        slideDeckFileName: "generic-slides.pptx",
        targetReportFileName: "generic-report.pdf",
      },
      sectionMappings: {
        program_overview: {
          sectionType: "narrative",
          sourceTopics: ["운영사 소개", "프로그램 핵심 전략"],
        },
        performance_summary: {
          sectionType: "summary_table",
          sourceTopics: ["핵심 달성 목표"],
        },
      },
    };

    const myscResult = extractPatterns(MYSC_PACKET);
    const genericResult = extractPatterns(genericPacket);

    // Find rules that match for both
    const myscRuleIds = new Set(myscResult.rules.map((r) => r.ruleId));
    const genericRuleIds = new Set(genericResult.rules.map((r) => r.ruleId));

    const overlap = [...genericRuleIds].filter((id) => myscRuleIds.has(id));
    // The structural mapping patterns should overlap (same slide→section type pairs)
    expect(overlap.length).toBeGreaterThan(0);
  });
});
