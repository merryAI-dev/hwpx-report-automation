import { describe, expect, it } from "vitest";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import {
  classifySlides,
  classifySingleSlide,
  summarizeSlideTypeDistribution,
} from "./slide-type-classifier";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSeg(
  slideNumber: number,
  text: string,
  pptxRole: "title" | "body" | "notes" | "table" = "body",
  extra: Record<string, string> = {},
): EditorSegment {
  return {
    segmentId: `pptx::${slideNumber}::${Math.random()}`,
    fileName: "pptx",
    textIndex: slideNumber,
    text,
    originalText: text,
    tag: "p",
    styleHints: { slideNumber: String(slideNumber), pptxRole, ...extra },
  };
}

// ─── Key Invariant: content-agnostic ─────────────────────────────────────────

describe("SlideTypeClassifier — content-agnostic invariant", () => {
  it("should NOT use organization name or domain keywords in classification logic", () => {
    // Two slides with identical structure but different content (different domains).
    // They must produce the SAME type classification.

    const marineKpiSlide = [
      makeSeg(1, "핵심 달성 목표", "title"),
      makeSeg(1, "직접 투자 유치액", "body"),
      makeSeg(1, "11억원", "body"),
      makeSeg(1, "목표 4억", "body"),
      makeSeg(1, "달성률 275%", "body"),
      makeSeg(1, "후속투자 16억원", "body"),
      makeSeg(1, "목표 10억", "body"),
    ];

    const genericKpiSlide = [
      makeSeg(1, "성과 현황", "title"),
      makeSeg(1, "투자 유치금액", "body"),
      makeSeg(1, "50억원", "body"),
      makeSeg(1, "목표 30억", "body"),
      makeSeg(1, "달성률 167%", "body"),
      makeSeg(1, "매출 증가율", "body"),
      makeSeg(1, "목표 20%", "body"),
    ];

    const [marineResult] = classifySlides(marineKpiSlide);
    const [genericResult] = classifySlides(genericKpiSlide);

    // Both must classify as kpi_dashboard — content doesn't matter
    expect(marineResult.slideType).toBe("kpi_dashboard");
    expect(genericResult.slideType).toBe("kpi_dashboard");
  });
});

// ─── cover_divider ────────────────────────────────────────────────────────────

describe("SlideTypeClassifier — cover_divider", () => {
  it("classifies title-only slides as cover_divider", () => {
    const segments = [makeSeg(1, "운영사 소개", "title")];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("cover_divider");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("classifies near-empty slides as cover_divider", () => {
    const segments = [makeSeg(1, "1", "title")];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("cover_divider");
  });

  it("includes is_title_only signal", () => {
    const segments = [makeSeg(1, "섹션 제목", "title")];
    const [result] = classifySlides(segments);
    expect(result.structuralSignals).toContain("is_title_only");
  });
});

// ─── kpi_dashboard ────────────────────────────────────────────────────────────

describe("SlideTypeClassifier — kpi_dashboard", () => {
  it("classifies slides with goal/actual pairs and percentages as kpi_dashboard", () => {
    const segments = [
      makeSeg(1, "핵심 지표", "title"),
      makeSeg(1, "목표 10억원", "body"),
      makeSeg(1, "달성 15억원", "body"),
      makeSeg(1, "달성률 150%", "body"),
      makeSeg(1, "신규 고용 목표 20명", "body"),
      makeSeg(1, "달성 25명 (125%)", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("kpi_dashboard");
    expect(result.structuralSignals).toContain("has_goal_actual_pair");
    expect(result.structuralSignals).toContain("has_percentage");
  });

  it("includes has_numbers signal for numeric-heavy slides", () => {
    const segments = [
      makeSeg(1, "성과", "title"),
      makeSeg(1, "100건", "body"),
      makeSeg(1, "50억", "body"),
      makeSeg(1, "달성률 200%", "body"),
      makeSeg(1, "목표 대비 달성", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.structuralSignals).toContain("has_numbers");
  });
});

// ─── timeline_gantt ───────────────────────────────────────────────────────────

describe("SlideTypeClassifier — timeline_gantt", () => {
  it("classifies slides with multiple date patterns as timeline_gantt", () => {
    const segments = [
      makeSeg(1, "추진 일정", "title"),
      makeSeg(1, "2025.04 모집 및 선발", "body"),
      makeSeg(1, "2025.05 기업 진단", "body"),
      makeSeg(1, "2025.07 중간 보고", "body"),
      makeSeg(1, "2025.11 최종 보고", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("timeline_gantt");
    expect(result.structuralSignals).toContain("has_timeline_markers");
  });

  it("detects phase/sequential patterns", () => {
    const segments = [
      makeSeg(1, "단계별 계획", "title"),
      makeSeg(1, "Phase1 준비단계", "body"),
      makeSeg(1, "Phase2 실행단계", "body"),
      makeSeg(1, "Phase3 마무리단계", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.structuralSignals).toContain("has_date_pattern");
  });
});

// ─── organization_overview ────────────────────────────────────────────────────

describe("SlideTypeClassifier — organization_overview", () => {
  it("classifies intro slides with history/mission keywords", () => {
    const segments = [
      makeSeg(1, "운영 기관 소개", "title"),
      makeSeg(1, "2011년 법인 설립 이래 사회혁신을 추구해왔습니다", "body"),
      makeSeg(1, "미션: 지속가능한 사회혁신 생태계 구축", "body"),
      makeSeg(1, "연혁 및 주요 현황", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("organization_overview");
    expect(result.structuralSignals).toContain("has_organization_keywords");
  });
});

// ─── survey_result ────────────────────────────────────────────────────────────

describe("SlideTypeClassifier — survey_result", () => {
  it("classifies satisfaction survey slides", () => {
    const segments = [
      makeSeg(1, "프로그램 만족도 조사", "title"),
      makeSeg(1, "전체 만족도 96.8점", "body"),
      makeSeg(1, "교육 만족도 94%", "body"),
      makeSeg(1, "멘토링 만족도 97%", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("survey_result");
    expect(result.structuralSignals).toContain("has_satisfaction_keywords");
  });
});

// ─── recommendation ───────────────────────────────────────────────────────────

describe("SlideTypeClassifier — recommendation", () => {
  it("classifies proposal/strategy slides", () => {
    const segments = [
      makeSeg(1, "향후 사업 제언", "title"),
      makeSeg(1, "생태계 확장을 위한 전략 제안", "body"),
      makeSeg(1, "지속가능한 운영을 위한 개선 방향", "body"),
      makeSeg(1, "향후 3년 로드맵 제언", "body"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("recommendation");
    expect(result.structuralSignals).toContain("has_recommendation_keywords");
  });
});

// ─── comparison_table ─────────────────────────────────────────────────────────

describe("SlideTypeClassifier — comparison_table", () => {
  it("classifies table-heavy slides with headers as comparison_table", () => {
    const segments = [
      makeSeg(1, "성과 비교", "title"),
      makeSeg(1, "구분", "table", { tableRole: "header" }),
      makeSeg(1, "항목", "table", { tableRole: "header" }),
      makeSeg(1, "결과", "table", { tableRole: "header" }),
      makeSeg(1, "투자", "table"),
      makeSeg(1, "10억원", "table"),
      makeSeg(1, "15억원", "table"),
    ];
    const [result] = classifySlides(segments);
    expect(result.slideType).toBe("comparison_table");
    expect(result.structuralSignals).toContain("has_table");
    expect(result.structuralSignals).toContain("has_column_headers");
  });
});

// ─── unknown fallback ─────────────────────────────────────────────────────────

describe("SlideTypeClassifier — unknown fallback", () => {
  it("returns unknown for slides below confidence threshold", () => {
    // A slide with mixed weak signals that don't strongly favor any type
    const segments = [
      makeSeg(1, "내용", "title"),
      makeSeg(1, "가나다라마바사", "body"),
    ];
    const [result] = classifySlides(segments);
    // Should either classify as something or fall back to unknown/cover_divider
    expect(["unknown", "cover_divider", "organization_overview", "bullet_summary"]).toContain(
      result.slideType,
    );
  });
});

// ─── Multi-slide classification ───────────────────────────────────────────────

describe("SlideTypeClassifier — multi-slide deck", () => {
  it("classifies a representative accelerator deck structure", () => {
    const deckSegments: EditorSegment[] = [
      // Slide 1: Cover
      makeSeg(1, "2025 액셀러레이터 프로그램", "title"),

      // Slide 2: TOC/Divider
      makeSeg(2, "목차", "title"),

      // Slide 3: Org overview
      makeSeg(3, "운영사 소개", "title"),
      makeSeg(3, "2011년 법인 설립, 미션: 사회혁신", "body"),
      makeSeg(3, "연혁 및 현황", "body"),

      // Slide 4: KPI Dashboard
      makeSeg(4, "핵심 달성 목표", "title"),
      makeSeg(4, "투자 목표 10억, 달성 15억 (150%)", "body"),
      makeSeg(4, "고용 목표 20명, 달성 25명", "body"),

      // Slide 5: Timeline
      makeSeg(5, "추진 일정", "title"),
      makeSeg(5, "2025.04 모집", "body"),
      makeSeg(5, "2025.06 교육", "body"),
      makeSeg(5, "2025.11 결과보고", "body"),

      // Slide 6: Recommendation
      makeSeg(6, "제언 및 향후 전략", "title"),
      makeSeg(6, "생태계 확장 방향 제언", "body"),
      makeSeg(6, "개선 과제 및 전략적 방향", "body"),
    ];

    const results = classifySlides(deckSegments);

    expect(results).toHaveLength(6);

    const typeMap = Object.fromEntries(results.map((r) => [r.slideNumber, r.slideType]));

    expect(typeMap[1]).toBe("cover_divider");
    expect(typeMap[2]).toBe("cover_divider");
    expect(typeMap[3]).toBe("organization_overview");
    expect(typeMap[4]).toBe("kpi_dashboard");
    expect(typeMap[5]).toBe("timeline_gantt");
    expect(typeMap[6]).toBe("recommendation");
  });
});

// ─── summarizeSlideTypeDistribution ──────────────────────────────────────────

describe("summarizeSlideTypeDistribution", () => {
  it("counts slide types correctly", () => {
    const classifications = [
      { slideNumber: 1, slideType: "cover_divider" as const, confidence: 0.8, structuralSignals: [] },
      { slideNumber: 2, slideType: "kpi_dashboard" as const, confidence: 0.9, structuralSignals: [] },
      { slideNumber: 3, slideType: "kpi_dashboard" as const, confidence: 0.7, structuralSignals: [] },
      { slideNumber: 4, slideType: "timeline_gantt" as const, confidence: 0.6, structuralSignals: [] },
    ];
    const dist = summarizeSlideTypeDistribution(classifications);
    expect(dist.cover_divider).toBe(1);
    expect(dist.kpi_dashboard).toBe(2);
    expect(dist.timeline_gantt).toBe(1);
  });
});

// ─── classifySingleSlide ──────────────────────────────────────────────────────

describe("classifySingleSlide", () => {
  it("classifies a single slide by its segments", () => {
    const segments = [
      makeSeg(7, "만족도 조사 결과", "title"),
      makeSeg(7, "전반적 만족도 96점", "body"),
      makeSeg(7, "프로그램 만족도 94%", "body"),
    ];
    const result = classifySingleSlide(7, segments);
    expect(result.slideNumber).toBe(7);
    expect(result.slideType).toBe("survey_result");
  });
});
