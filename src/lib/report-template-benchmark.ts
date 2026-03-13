export type BenchmarkMetricId =
  | "sample_count"
  | "toc_extraction_accuracy"
  | "section_coverage"
  | "section_type_alignment"
  | "slide_grounding_coverage"
  | "document_masking_coverage"
  | "masked_source_leakage_rate"
  | "appendix_evidence_readiness"
  | "entity_focus_coverage"
  | "layout_similarity"
  | "table_structure_accuracy"
  | "prompt_iteration_win_rate"
  | "reviewer_edit_rate"
  | "critical_hallucination_rate"
  | "manual_correction_minutes";

export type ReportFamilyBenchmarkRun = {
  familyId: string;
  sampleCount: number;
  tocExtractionAccuracy: number;
  tocBenchmarkCases?: TocBenchmarkCase[];
  sectionCoverage: number;
  sectionPlanCases?: SectionPlanBenchmarkCase[];
  slideGroundingCoverage: number;
  documentMaskingCoverage: number;
  maskedSourceLeakageRate: number;
  layoutSimilarity: number;
  tableStructureAccuracy: number;
  promptIterationWinRate: number;
  reviewerEditRate: number;
  criticalHallucinationRate: number;
  manualCorrectionMinutes: number;
};

export type BenchmarkThresholds = {
  minSampleCount: number;
  tocExtractionAccuracy: number;
  sectionCoverage: number;
  sectionTypeAlignment: number;
  slideGroundingCoverage: number;
  documentMaskingCoverage: number;
  maskedSourceLeakageRate: number;
  appendixEvidenceReadiness: number;
  entityFocusCoverage: number;
  layoutSimilarity: number;
  tableStructureAccuracy: number;
  promptIterationWinRate: number;
  reviewerEditRate: number;
  criticalHallucinationRate: number;
  manualCorrectionMinutes: number;
  passingScore: number;
};

export type BenchmarkMetricResult = {
  id: BenchmarkMetricId;
  label: string;
  value: number;
  threshold: number;
  comparator: "gte" | "lte";
  critical: boolean;
  passed: boolean;
  score: number;
  weight: number;
  suggestedAction: string;
};

export type BenchmarkLoopStatus = "insufficient_evidence" | "retry" | "pass";

export type ReportFamilyBenchmarkEvaluation = {
  familyId: string;
  overallScore: number;
  status: BenchmarkLoopStatus;
  passed: boolean;
  shouldRetry: boolean;
  metrics: BenchmarkMetricResult[];
  blockers: BenchmarkMetricResult[];
  nextFocusAreas: string[];
  tocSummary: TocBenchmarkSummary | null;
  sectionPlanSummary: SectionPlanSummary | null;
};

export type TocBenchmarkEntry = {
  title: string;
  numbering?: string | null;
  required?: boolean;
};

export type TocBenchmarkCase = {
  caseId: string;
  goldEntries: TocBenchmarkEntry[];
  predictedEntries: TocBenchmarkEntry[];
};

export type TocBenchmarkCaseResult = {
  caseId: string;
  exactMatch: boolean;
  goldCount: number;
  predictedCount: number;
  missingRequiredEntries: string[];
  extraEntries: string[];
  orderPassed: boolean;
};

export type TocBenchmarkSummary = {
  exactMatchRate: number;
  requiredSectionMatchRate: number;
  caseResults: TocBenchmarkCaseResult[];
};

export type SectionPlanBenchmarkEntry = {
  tocTitle: string;
  sectionType?: string | null;
  evidenceExpectation?: string | null;
  focusEntities?: string[];
  required?: boolean;
};

export type SectionPlanBenchmarkCase = {
  caseId: string;
  expectedSections: SectionPlanBenchmarkEntry[];
  predictedSections: SectionPlanBenchmarkEntry[];
};

export type SectionPlanCaseResult = {
  caseId: string;
  sectionTypeMatchRate: number;
  appendixReadinessRate: number;
  entityCoverageRate: number;
  missingRequiredSections: string[];
  typeMismatches: string[];
  appendixGaps: string[];
  entityGaps: string[];
};

export type SectionPlanSummary = {
  sectionTypeExactMatchRate: number;
  appendixEvidenceReadinessRate: number;
  entityFocusCoverageRate: number;
  caseResults: SectionPlanCaseResult[];
};

type MetricDefinition = {
  id: BenchmarkMetricId;
  label: string;
  comparator: "gte" | "lte";
  thresholdKey: keyof BenchmarkThresholds;
  critical: boolean;
  weight: number;
  suggestedAction: string;
};

export const DEFAULT_REPORT_FAMILY_THRESHOLDS: BenchmarkThresholds = {
  minSampleCount: 3,
  tocExtractionAccuracy: 1,
  sectionCoverage: 0.9,
  sectionTypeAlignment: 1,
  slideGroundingCoverage: 0.85,
  documentMaskingCoverage: 0.95,
  maskedSourceLeakageRate: 0.02,
  appendixEvidenceReadiness: 1,
  entityFocusCoverage: 0.9,
  layoutSimilarity: 0.85,
  tableStructureAccuracy: 0.85,
  promptIterationWinRate: 0.6,
  reviewerEditRate: 0.2,
  criticalHallucinationRate: 0.01,
  manualCorrectionMinutes: 40,
  passingScore: 85,
};

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "sample_count",
    label: "Benchmark sample count",
    comparator: "gte",
    thresholdKey: "minSampleCount",
    critical: true,
    weight: 0.05,
    suggestedAction: "같은 report family에 대해 exemplar packet을 더 수집하세요.",
  },
  {
    id: "toc_extraction_accuracy",
    label: "TOC exact-match rate",
    comparator: "gte",
    thresholdKey: "tocExtractionAccuracy",
    critical: true,
    weight: 0.13,
    suggestedAction: "목차 detector가 required section, numbering, 순서를 전부 맞추도록 exact-match 기준으로 강화하세요.",
  },
  {
    id: "section_coverage",
    label: "Section coverage",
    comparator: "gte",
    thresholdKey: "sectionCoverage",
    critical: false,
    weight: 0.06,
    suggestedAction: "section planner와 slot filler를 강화하세요.",
  },
  {
    id: "section_type_alignment",
    label: "Section type alignment",
    comparator: "gte",
    thresholdKey: "sectionTypeAlignment",
    critical: true,
    weight: 0.07,
    suggestedAction: "family packet의 section type과 planner output scaffold를 exact-match 수준으로 맞추세요.",
  },
  {
    id: "slide_grounding_coverage",
    label: "Slide grounding coverage",
    comparator: "gte",
    thresholdKey: "slideGroundingCoverage",
    critical: true,
    weight: 0.12,
    suggestedAction: "슬라이드 chunk retrieval과 section별 grounding prompt를 강화하세요.",
  },
  {
    id: "document_masking_coverage",
    label: "Document masking coverage",
    comparator: "gte",
    thresholdKey: "documentMaskingCoverage",
    critical: true,
    weight: 0.11,
    suggestedAction: "슬라이드 외 source를 generation context에서 더 강하게 masking하세요.",
  },
  {
    id: "masked_source_leakage_rate",
    label: "Masked source leakage rate",
    comparator: "lte",
    thresholdKey: "maskedSourceLeakageRate",
    critical: true,
    weight: 0.09,
    suggestedAction: "leakage detector와 source allowlist를 넣어 masked 문서 유입을 차단하세요.",
  },
  {
    id: "appendix_evidence_readiness",
    label: "Appendix evidence readiness",
    comparator: "gte",
    thresholdKey: "appendixEvidenceReadiness",
    critical: true,
    weight: 0.05,
    suggestedAction: "부록/증빙 섹션은 appendix bundle requirement까지 family schema에 맞춰 강제하세요.",
  },
  {
    id: "entity_focus_coverage",
    label: "Entity focus coverage",
    comparator: "gte",
    thresholdKey: "entityFocusCoverage",
    critical: false,
    weight: 0.04,
    suggestedAction: "사례형 섹션은 기업 단위 entity retrieval과 section focus rules를 보강하세요.",
  },
  {
    id: "layout_similarity",
    label: "Layout similarity",
    comparator: "gte",
    thresholdKey: "layoutSimilarity",
    critical: true,
    weight: 0.08,
    suggestedAction: "report blueprint와 visual diff gate를 강화하세요.",
  },
  {
    id: "table_structure_accuracy",
    label: "Table structure accuracy",
    comparator: "gte",
    thresholdKey: "tableStructureAccuracy",
    critical: false,
    weight: 0.06,
    suggestedAction: "표 component와 row/col merge rules를 보강하세요.",
  },
  {
    id: "prompt_iteration_win_rate",
    label: "Prompt iteration win rate",
    comparator: "gte",
    thresholdKey: "promptIterationWinRate",
    critical: false,
    weight: 0.07,
    suggestedAction: "reviewer correction과 failure packet을 prompt memory로 되먹이세요.",
  },
  {
    id: "reviewer_edit_rate",
    label: "Reviewer edit rate",
    comparator: "lte",
    thresholdKey: "reviewerEditRate",
    critical: false,
    weight: 0.02,
    suggestedAction: "reviewer가 반복 수정하는 section을 benchmark goldset에 편입하세요.",
  },
  {
    id: "critical_hallucination_rate",
    label: "Critical hallucination rate",
    comparator: "lte",
    thresholdKey: "criticalHallucinationRate",
    critical: true,
    weight: 0.04,
    suggestedAction: "hallucination 사례를 hard-negative benchmark로 등록하세요.",
  },
  {
    id: "manual_correction_minutes",
    label: "Manual correction minutes",
    comparator: "lte",
    thresholdKey: "manualCorrectionMinutes",
    critical: false,
    weight: 0.01,
    suggestedAction: "교정 시간이 긴 구간을 section template 수준에서 자동화하세요.",
  },
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeTocToken(value: string | null | undefined): string {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[.)]+$/g, "")
    .trim()
    .toLowerCase();
}

function normalizeSectionTitle(value: string | null | undefined): string {
  return normalizeTocToken(value);
}

function normalizeEntities(values: string[] | null | undefined): string[] {
  return (values || []).map(normalizeSectionTitle).filter(Boolean).sort();
}

function toTocEntryKey(entry: TocBenchmarkEntry): string {
  return `${normalizeTocToken(entry.numbering)}::${normalizeTocToken(entry.title)}`;
}

function toTocEntryLabel(entry: TocBenchmarkEntry): string {
  const numbering = (entry.numbering || "").trim();
  const title = entry.title.trim();
  return numbering ? `${numbering} ${title}` : title;
}

export function evaluateTocBenchmarkCases(cases: TocBenchmarkCase[]): TocBenchmarkSummary {
  if (!cases.length) {
    return {
      exactMatchRate: 0,
      requiredSectionMatchRate: 0,
      caseResults: [],
    };
  }

  let exactMatchCount = 0;
  let requiredCount = 0;
  let matchedRequiredCount = 0;

  const caseResults = cases.map((testCase) => {
    const goldKeys = testCase.goldEntries.map(toTocEntryKey);
    const predictedKeys = testCase.predictedEntries.map(toTocEntryKey);
    const goldSet = new Set(goldKeys);
    const predictedSet = new Set(predictedKeys);

    const requiredEntries = testCase.goldEntries.filter((entry) => entry.required !== false);
    requiredCount += requiredEntries.length;

    const missingRequiredEntries = requiredEntries
      .filter((entry) => !predictedSet.has(toTocEntryKey(entry)))
      .map(toTocEntryLabel);
    matchedRequiredCount += requiredEntries.length - missingRequiredEntries.length;

    const extraEntries = testCase.predictedEntries
      .filter((entry) => !goldSet.has(toTocEntryKey(entry)))
      .map(toTocEntryLabel);

    const alignedGoldOrder = goldKeys.filter((key) => predictedSet.has(key));
    const alignedPredictedOrder = predictedKeys.filter((key) => goldSet.has(key));
    const orderPassed =
      alignedGoldOrder.length === alignedPredictedOrder.length &&
      alignedGoldOrder.every((key, index) => alignedPredictedOrder[index] === key);

    const exactMatch =
      goldKeys.length === predictedKeys.length &&
      goldKeys.every((key, index) => predictedKeys[index] === key);

    if (exactMatch) {
      exactMatchCount += 1;
    }

    return {
      caseId: testCase.caseId,
      exactMatch,
      goldCount: goldKeys.length,
      predictedCount: predictedKeys.length,
      missingRequiredEntries,
      extraEntries,
      orderPassed,
    } satisfies TocBenchmarkCaseResult;
  });

  return {
    exactMatchRate: clampPercent(exactMatchCount / cases.length),
    requiredSectionMatchRate: requiredCount > 0 ? clampPercent(matchedRequiredCount / requiredCount) : 1,
    caseResults,
  };
}

function formatExpectedSectionLabel(entry: SectionPlanBenchmarkEntry): string {
  return entry.tocTitle.trim();
}

export function evaluateSectionPlanBenchmarkCases(
  cases: SectionPlanBenchmarkCase[],
): SectionPlanSummary {
  if (!cases.length) {
    return {
      sectionTypeExactMatchRate: 1,
      appendixEvidenceReadinessRate: 1,
      entityFocusCoverageRate: 1,
      caseResults: [],
    };
  }

  let sectionTypeExpectedCount = 0;
  let sectionTypeMatchedCount = 0;
  let appendixExpectedCount = 0;
  let appendixMatchedCount = 0;
  let entityExpectedCount = 0;
  let entityMatchedCount = 0;

  const caseResults = cases.map((testCase) => {
    const predictedByTitle = new Map(
      testCase.predictedSections.map((entry) => [normalizeSectionTitle(entry.tocTitle), entry]),
    );

    const missingRequiredSections: string[] = [];
    const typeMismatches: string[] = [];
    const appendixGaps: string[] = [];
    const entityGaps: string[] = [];

    let caseSectionTypeExpected = 0;
    let caseSectionTypeMatched = 0;
    let caseAppendixExpected = 0;
    let caseAppendixMatched = 0;
    let caseEntityExpected = 0;
    let caseEntityMatched = 0;

    for (const expected of testCase.expectedSections) {
      const predicted = predictedByTitle.get(normalizeSectionTitle(expected.tocTitle));

      if ((expected.required ?? true) && !predicted) {
        missingRequiredSections.push(formatExpectedSectionLabel(expected));
      }

      if (expected.sectionType) {
        caseSectionTypeExpected += 1;
        sectionTypeExpectedCount += 1;
        const matched =
          normalizeSectionTitle(predicted?.sectionType) === normalizeSectionTitle(expected.sectionType);
        if (matched) {
          caseSectionTypeMatched += 1;
          sectionTypeMatchedCount += 1;
        } else {
          typeMismatches.push(
            `${formatExpectedSectionLabel(expected)}: expected ${expected.sectionType}, got ${predicted?.sectionType || "missing"}`,
          );
        }
      }

      if (expected.evidenceExpectation === "appendix_bundle_required") {
        caseAppendixExpected += 1;
        appendixExpectedCount += 1;
        const matched = normalizeSectionTitle(predicted?.evidenceExpectation) === "appendix_bundle_required";
        if (matched) {
          caseAppendixMatched += 1;
          appendixMatchedCount += 1;
        } else {
          appendixGaps.push(formatExpectedSectionLabel(expected));
        }
      }

      const expectedEntities = normalizeEntities(expected.focusEntities);
      if (expectedEntities.length) {
        caseEntityExpected += 1;
        entityExpectedCount += 1;
        const predictedEntities = normalizeEntities(predicted?.focusEntities);
        const matched = expectedEntities.every((entity) => predictedEntities.includes(entity));
        if (matched) {
          caseEntityMatched += 1;
          entityMatchedCount += 1;
        } else {
          entityGaps.push(formatExpectedSectionLabel(expected));
        }
      }
    }

    return {
      caseId: testCase.caseId,
      sectionTypeMatchRate:
        caseSectionTypeExpected > 0
          ? clampPercent(caseSectionTypeMatched / caseSectionTypeExpected)
          : 1,
      appendixReadinessRate:
        caseAppendixExpected > 0
          ? clampPercent(caseAppendixMatched / caseAppendixExpected)
          : 1,
      entityCoverageRate:
        caseEntityExpected > 0
          ? clampPercent(caseEntityMatched / caseEntityExpected)
          : 1,
      missingRequiredSections,
      typeMismatches,
      appendixGaps,
      entityGaps,
    } satisfies SectionPlanCaseResult;
  });

  return {
    sectionTypeExactMatchRate:
      sectionTypeExpectedCount > 0
        ? clampPercent(sectionTypeMatchedCount / sectionTypeExpectedCount)
        : 1,
    appendixEvidenceReadinessRate:
      appendixExpectedCount > 0
        ? clampPercent(appendixMatchedCount / appendixExpectedCount)
        : 1,
    entityFocusCoverageRate:
      entityExpectedCount > 0
        ? clampPercent(entityMatchedCount / entityExpectedCount)
        : 1,
    caseResults,
  };
}

function metricValue(
  metricId: BenchmarkMetricId,
  run: ReportFamilyBenchmarkRun,
  tocSummary: TocBenchmarkSummary | null,
  sectionPlanSummary: SectionPlanSummary | null,
): number {
  switch (metricId) {
    case "sample_count":
      return clampCount(run.sampleCount);
    case "toc_extraction_accuracy":
      return tocSummary ? clampPercent(tocSummary.exactMatchRate) : clampPercent(run.tocExtractionAccuracy);
    case "section_coverage":
      return clampPercent(run.sectionCoverage);
    case "section_type_alignment":
      return sectionPlanSummary ? clampPercent(sectionPlanSummary.sectionTypeExactMatchRate) : 1;
    case "slide_grounding_coverage":
      return clampPercent(run.slideGroundingCoverage);
    case "document_masking_coverage":
      return clampPercent(run.documentMaskingCoverage);
    case "masked_source_leakage_rate":
      return clampPercent(run.maskedSourceLeakageRate);
    case "appendix_evidence_readiness":
      return sectionPlanSummary
        ? clampPercent(sectionPlanSummary.appendixEvidenceReadinessRate)
        : 1;
    case "entity_focus_coverage":
      return sectionPlanSummary ? clampPercent(sectionPlanSummary.entityFocusCoverageRate) : 1;
    case "layout_similarity":
      return clampPercent(run.layoutSimilarity);
    case "table_structure_accuracy":
      return clampPercent(run.tableStructureAccuracy);
    case "prompt_iteration_win_rate":
      return clampPercent(run.promptIterationWinRate);
    case "reviewer_edit_rate":
      return clampPercent(run.reviewerEditRate);
    case "critical_hallucination_rate":
      return clampPercent(run.criticalHallucinationRate);
    case "manual_correction_minutes":
      return clampCount(run.manualCorrectionMinutes);
  }
}

function metricPassed(value: number, threshold: number, comparator: "gte" | "lte"): boolean {
  return comparator === "gte" ? value >= threshold : value <= threshold;
}

function metricScore(value: number, threshold: number, comparator: "gte" | "lte"): number {
  if (metricPassed(value, threshold, comparator)) {
    return 100;
  }

  if (comparator === "gte") {
    if (threshold <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, (value / threshold) * 100));
  }

  if (value <= 0) {
    return 100;
  }

  return Math.max(0, Math.min(100, (threshold / value) * 100));
}

export function evaluateReportFamilyBenchmark(
  run: ReportFamilyBenchmarkRun,
  thresholds: BenchmarkThresholds = DEFAULT_REPORT_FAMILY_THRESHOLDS,
): ReportFamilyBenchmarkEvaluation {
  const tocSummary = run.tocBenchmarkCases?.length
    ? evaluateTocBenchmarkCases(run.tocBenchmarkCases)
    : null;
  const sectionPlanSummary = run.sectionPlanCases?.length
    ? evaluateSectionPlanBenchmarkCases(run.sectionPlanCases)
    : null;

  const metrics = METRIC_DEFINITIONS.map((definition) => {
    const value = metricValue(definition.id, run, tocSummary, sectionPlanSummary);
    const threshold = thresholds[definition.thresholdKey] as number;
    return {
      id: definition.id,
      label: definition.label,
      value,
      threshold,
      comparator: definition.comparator,
      critical: definition.critical,
      passed: metricPassed(value, threshold, definition.comparator),
      score: roundScore(metricScore(value, threshold, definition.comparator)),
      weight: definition.weight,
      suggestedAction: definition.suggestedAction,
    } satisfies BenchmarkMetricResult;
  });

  const overallScore = roundScore(
    metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0),
  );
  const blockers = metrics.filter((metric) => metric.critical && !metric.passed);
  const insufficientEvidence = metrics.some(
    (metric) => metric.id === "sample_count" && !metric.passed,
  );

  const status: BenchmarkLoopStatus = insufficientEvidence
    ? "insufficient_evidence"
    : blockers.length > 0 || overallScore < thresholds.passingScore
      ? "retry"
      : "pass";

  const sortedFailures = [...metrics]
    .filter((metric) => !metric.passed)
    .sort((left, right) => left.score - right.score);

  return {
    familyId: run.familyId,
    overallScore,
    status,
    passed: status === "pass",
    shouldRetry: status === "retry",
    metrics,
    blockers,
    nextFocusAreas: sortedFailures.slice(0, 5).map((metric) => metric.suggestedAction),
    tocSummary,
    sectionPlanSummary,
  };
}
