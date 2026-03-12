export type ReportSourceFormat =
  | "hwp"
  | "hwpx"
  | "docx"
  | "pptx"
  | "pdf"
  | "xlsx"
  | "image";

export type ReadinessDimensionId =
  | "family_intake"
  | "toc_bootstrap"
  | "slide_grounding"
  | "layout_generation"
  | "prompt_loop"
  | "ops_learning";

export type ReadinessStage =
  | "foundation"
  | "guided_pilot"
  | "scale_ready"
  | "factory_ready";

export type ReadinessFindingSeverity = "blocker" | "warning" | "note";

export type ReportAutomationSignals = {
  sourceFormats: ReportSourceFormat[];
  canExtractLayoutFromPdf: boolean;
  canDetectSectionsFromExemplar: boolean;
  canExtractTableOfContents: boolean;
  canVersionTemplateSchema: boolean;
  canUseCanonicalSectionSchema: boolean;
  canMaskNonSlideDocuments: boolean;
  canGenerateFromSlides: boolean;
  hasSlideGroundingPrompt: boolean;
  hasPromptReinforcementLoop: boolean;
  canRenderTablesAndCharts: boolean;
  canPreserveHeadersFooters: boolean;
  canRunVisualDiff: boolean;
  hasHumanReviewQueue: boolean;
  hasRegressionCorpus: boolean;
  corpusFamilyCount: number;
  exemplarCountPerFamily: number;
  tocExtractionAccuracy: number;
  slideGroundingCoverage: number;
  maskingCoverage: number;
  layoutFidelityScore: number;
  promptIterationWinRate: number;
  reviewTurnaroundHours?: number | null;
};

export type ReadinessDimensionResult = {
  id: ReadinessDimensionId;
  label: string;
  weight: number;
  score: number;
  weightedScore: number;
  summary: string;
};

export type ReadinessFinding = {
  id: string;
  severity: ReadinessFindingSeverity;
  dimensionId: ReadinessDimensionId;
  message: string;
  recommendedAction: string;
};

export type ReportAutomationReadinessReport = {
  overallScore: number;
  stage: ReadinessStage;
  dimensions: ReadinessDimensionResult[];
  findings: ReadinessFinding[];
  passesGate: boolean;
  topRisks: ReadinessFinding[];
};

const DIMENSION_LABELS: Record<ReadinessDimensionId, string> = {
  family_intake: "Family Intake",
  toc_bootstrap: "TOC Bootstrap",
  slide_grounding: "Slide Grounding",
  layout_generation: "Layout Generation",
  prompt_loop: "Prompt Loop",
  ops_learning: "Ops Learning",
};

const DIMENSION_WEIGHTS: Record<ReadinessDimensionId, number> = {
  family_intake: 0.14,
  toc_bootstrap: 0.2,
  slide_grounding: 0.22,
  layout_generation: 0.18,
  prompt_loop: 0.16,
  ops_learning: 0.1,
};

const FORMAT_POINTS: Record<ReportSourceFormat, number> = {
  pdf: 25,
  pptx: 20,
  docx: 15,
  hwpx: 15,
  hwp: 10,
  xlsx: 10,
  image: 5,
};

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

function ratio(value: number, target: number): number {
  if (target <= 0) {
    return 0;
  }
  return Math.min(1, clampCount(value) / target);
}

function scoreFamilyIntake(signals: ReportAutomationSignals): number {
  const uniqueFormats = Array.from(new Set(signals.sourceFormats));
  const formatScore = uniqueFormats.reduce((sum, format) => sum + FORMAT_POINTS[format], 0);

  return Math.min(
    100,
    formatScore +
      (signals.canExtractLayoutFromPdf ? 20 : 0) +
      (signals.canDetectSectionsFromExemplar ? 20 : 0),
  );
}

function scoreTocBootstrap(signals: ReportAutomationSignals): number {
  return (
    (signals.canExtractTableOfContents ? 25 : 0) +
    (signals.canVersionTemplateSchema ? 20 : 0) +
    (signals.canUseCanonicalSectionSchema ? 20 : 0) +
    clampPercent(signals.tocExtractionAccuracy) * 25 +
    ratio(signals.exemplarCountPerFamily, 3) * 10
  );
}

function scoreSlideGrounding(signals: ReportAutomationSignals): number {
  return (
    (signals.canMaskNonSlideDocuments ? 25 : 0) +
    (signals.canGenerateFromSlides ? 25 : 0) +
    (signals.hasSlideGroundingPrompt ? 15 : 0) +
    clampPercent(signals.slideGroundingCoverage) * 20 +
    clampPercent(signals.maskingCoverage) * 15
  );
}

function scoreLayoutGeneration(signals: ReportAutomationSignals): number {
  return (
    (signals.canRenderTablesAndCharts ? 25 : 0) +
    (signals.canPreserveHeadersFooters ? 20 : 0) +
    (signals.canRunVisualDiff ? 10 : 0) +
    clampPercent(signals.layoutFidelityScore) * 45
  );
}

function reviewTurnaroundScore(reviewTurnaroundHours?: number | null): number {
  if (!Number.isFinite(reviewTurnaroundHours)) {
    return 0;
  }
  if ((reviewTurnaroundHours ?? 0) <= 24) {
    return 15;
  }
  if ((reviewTurnaroundHours ?? 0) <= 48) {
    return 10;
  }
  if ((reviewTurnaroundHours ?? 0) <= 72) {
    return 5;
  }
  return 0;
}

function scorePromptLoop(signals: ReportAutomationSignals): number {
  return (
    (signals.hasPromptReinforcementLoop ? 35 : 0) +
    (signals.hasHumanReviewQueue ? 20 : 0) +
    clampPercent(signals.promptIterationWinRate) * 30 +
    reviewTurnaroundScore(signals.reviewTurnaroundHours)
  );
}

function scoreOpsLearning(signals: ReportAutomationSignals): number {
  return (
    (signals.hasRegressionCorpus ? 35 : 0) +
    ratio(signals.corpusFamilyCount, 5) * 25 +
    ratio(signals.exemplarCountPerFamily, 5) * 20 +
    clampPercent(signals.promptIterationWinRate) * 20
  );
}

function buildDimension(
  id: ReadinessDimensionId,
  score: number,
  summary: string,
): ReadinessDimensionResult {
  const normalizedScore = roundScore(score);
  const weight = DIMENSION_WEIGHTS[id];
  return {
    id,
    label: DIMENSION_LABELS[id],
    weight,
    score: normalizedScore,
    weightedScore: roundScore(normalizedScore * weight),
    summary,
  };
}

function deriveStage(overallScore: number, blockers: number): ReadinessStage {
  if (overallScore >= 90 && blockers === 0) {
    return "factory_ready";
  }
  if (overallScore >= 70 && blockers === 0) {
    return "scale_ready";
  }
  if (overallScore >= 45) {
    return "guided_pilot";
  }
  return "foundation";
}

function buildFindings(signals: ReportAutomationSignals): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  if (!signals.sourceFormats.includes("pdf") || !signals.sourceFormats.includes("pptx")) {
    findings.push({
      id: "missing_slide_family_intake",
      severity: "blocker",
      dimensionId: "family_intake",
      message: "슬라이드형 exemplar과 제출용 PDF를 family bootstrap 입력으로 함께 다루지 못합니다.",
      recommendedAction: "PPTX/PDF를 같은 family packet의 1급 입력으로 모델링하세요.",
    });
  }

  if (!signals.canExtractLayoutFromPdf || !signals.canDetectSectionsFromExemplar) {
    findings.push({
      id: "missing_layout_extraction",
      severity: "blocker",
      dimensionId: "family_intake",
      message: "PDF/슬라이드에서 섹션, 표지, 표, 페이지 구조를 안정적으로 추출하지 못합니다.",
      recommendedAction: "layout parser와 section detector를 먼저 구축하세요.",
    });
  }

  if (!signals.canExtractTableOfContents) {
    findings.push({
      id: "missing_toc_extraction",
      severity: "blocker",
      dimensionId: "toc_bootstrap",
      message: "보고서 family의 목차를 exemplar에서 추출하지 못합니다.",
      recommendedAction: "목차 detector와 section graph builder를 도입하세요.",
    });
  }

  if (clampPercent(signals.tocExtractionAccuracy) < 0.85) {
    findings.push({
      id: "weak_toc_accuracy",
      severity: "warning",
      dimensionId: "toc_bootstrap",
      message: "목차 추출 정확도가 낮아 section schema가 불안정합니다.",
      recommendedAction: "cover/title/목차/본문 page를 분리해서 section matching을 강화하세요.",
    });
  }

  if (!signals.canMaskNonSlideDocuments) {
    findings.push({
      id: "missing_document_masking",
      severity: "blocker",
      dimensionId: "slide_grounding",
      message: "슬라이드가 아닌 문서 기반 소스를 마스킹 처리해 생성 입력에서 분리하지 못합니다.",
      recommendedAction: "allowed source와 masked source를 family packet에 명시적으로 구분하세요.",
    });
  }

  if (!signals.canGenerateFromSlides || !signals.hasSlideGroundingPrompt) {
    findings.push({
      id: "missing_slide_grounding_prompt",
      severity: "blocker",
      dimensionId: "slide_grounding",
      message: "슬라이드를 보고 보고서 서술을 쓰게 하는 generation prompt가 아직 없습니다.",
      recommendedAction: "slide summary, speaker note, TOC slot을 결합한 grounded prompt를 설계하세요.",
    });
  }

  if (clampPercent(signals.slideGroundingCoverage) < 0.8) {
    findings.push({
      id: "weak_slide_grounding",
      severity: "blocker",
      dimensionId: "slide_grounding",
      message: "생성된 본문이 실제 슬라이드 내용에 충분히 grounded되지 않습니다.",
      recommendedAction: "section별 slide chunk retrieval과 citation trace를 추가하세요.",
    });
  }

  if (clampPercent(signals.maskingCoverage) < 0.95) {
    findings.push({
      id: "weak_masking_coverage",
      severity: "blocker",
      dimensionId: "slide_grounding",
      message: "마스킹 대상 문서가 generation 입력에서 완전히 차단되지 않습니다.",
      recommendedAction: "masking pass와 leakage audit를 benchmark 항목으로 넣으세요.",
    });
  }

  if (clampPercent(signals.layoutFidelityScore) < 0.85) {
    findings.push({
      id: "weak_layout_fidelity",
      severity: "warning",
      dimensionId: "layout_generation",
      message: "최종 제출형 보고서의 페이지 구조와 표 레이아웃 재현도가 낮습니다.",
      recommendedAction: "report blueprint와 component constraints를 강화하세요.",
    });
  }

  if (!signals.hasPromptReinforcementLoop) {
    findings.push({
      id: "missing_prompt_reinforcement",
      severity: "blocker",
      dimensionId: "prompt_loop",
      message: "benchmark 실패를 prompt/schema 수정으로 되먹임하는 reinforcement loop가 없습니다.",
      recommendedAction: "실패 metric -> retry action 매핑을 제품 로직으로 만드세요.",
    });
  }

  if (clampPercent(signals.promptIterationWinRate) < 0.55) {
    findings.push({
      id: "weak_prompt_iteration_win_rate",
      severity: "warning",
      dimensionId: "prompt_loop",
      message: "한 번의 reflection/adjust 후 benchmark 개선율이 낮습니다.",
      recommendedAction: "reviewer correction을 prompt memory와 few-shot goldset으로 반영하세요.",
    });
  }

  if (!signals.hasRegressionCorpus || signals.corpusFamilyCount < 3) {
    findings.push({
      id: "thin_regression_corpus",
      severity: "blocker",
      dimensionId: "ops_learning",
      message: "문서 family 일반화를 검증할 만큼 regression corpus가 얕습니다.",
      recommendedAction: "family별 benchmark packet을 최소 3개 이상 확보하세요.",
    });
  }

  if (clampCount(signals.exemplarCountPerFamily) < 3) {
    findings.push({
      id: "not_enough_exemplars",
      severity: "warning",
      dimensionId: "ops_learning",
      message: "양식 1개만으로는 report family를 일반화할 수 없습니다.",
      recommendedAction: "같은 사업군 보고서 묶음을 더 모아 family schema를 안정화하세요.",
    });
  }

  return findings;
}

export function evaluateReportAutomationReadiness(
  signals: ReportAutomationSignals,
): ReportAutomationReadinessReport {
  const dimensions = [
    buildDimension(
      "family_intake",
      scoreFamilyIntake(signals),
      "슬라이드/PDF exemplar를 family packet으로 수집하고 구조를 파악하는 능력",
    ),
    buildDimension(
      "toc_bootstrap",
      scoreTocBootstrap(signals),
      "목차를 추출하고 canonical section schema로 정규화하는 능력",
    ),
    buildDimension(
      "slide_grounding",
      scoreSlideGrounding(signals),
      "문서 소스를 마스킹하고 슬라이드 기반으로 서술을 생성하는 능력",
    ),
    buildDimension(
      "layout_generation",
      scoreLayoutGeneration(signals),
      "제출형 페이지 레이아웃과 표 구조를 재현하는 능력",
    ),
    buildDimension(
      "prompt_loop",
      scorePromptLoop(signals),
      "benchmark 실패를 prompt/retrieval/schema 조정으로 연결하는 능력",
    ),
    buildDimension(
      "ops_learning",
      scoreOpsLearning(signals),
      "family benchmark corpus를 통해 시스템을 반복 학습시키는 능력",
    ),
  ];

  const overallScore = roundScore(
    dimensions.reduce((sum, dimension) => sum + dimension.weightedScore, 0),
  );
  const findings = buildFindings(signals);
  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const stage = deriveStage(overallScore, blockerCount);

  return {
    overallScore,
    stage,
    dimensions,
    findings,
    passesGate: blockerCount === 0,
    topRisks: findings.filter((finding) => finding.severity !== "note").slice(0, 5),
  };
}
