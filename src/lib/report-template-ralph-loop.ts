import type {
  BenchmarkMetricId,
  ReportFamilyBenchmarkEvaluation,
} from "./report-template-benchmark";

export type RalphRetryBucket =
  | "collect_benchmark_packets"
  | "improve_toc_extractor"
  | "tighten_document_masking"
  | "strengthen_slide_grounding_prompt"
  | "improve_layout_renderer"
  | "promote_reviewer_feedback";

export type RalphRetryAction = {
  bucket: RalphRetryBucket;
  title: string;
  reason: string;
  steps: string[];
};

export type ReportFamilyRalphPlan = {
  familyId: string;
  shouldContinueLoop: boolean;
  actions: RalphRetryAction[];
};

const ACTION_ORDER: RalphRetryBucket[] = [
  "collect_benchmark_packets",
  "improve_toc_extractor",
  "tighten_document_masking",
  "strengthen_slide_grounding_prompt",
  "improve_layout_renderer",
  "promote_reviewer_feedback",
];

function bucketsFromFailedMetrics(failedMetricIds: Set<BenchmarkMetricId>): Set<RalphRetryBucket> {
  const buckets = new Set<RalphRetryBucket>();

  if (failedMetricIds.has("sample_count")) {
    buckets.add("collect_benchmark_packets");
  }
  if (failedMetricIds.has("toc_extraction_accuracy") || failedMetricIds.has("section_coverage")) {
    buckets.add("improve_toc_extractor");
  }
  if (
    failedMetricIds.has("document_masking_coverage") ||
    failedMetricIds.has("masked_source_leakage_rate")
  ) {
    buckets.add("tighten_document_masking");
  }
  if (
    failedMetricIds.has("slide_grounding_coverage") ||
    failedMetricIds.has("prompt_iteration_win_rate") ||
    failedMetricIds.has("critical_hallucination_rate")
  ) {
    buckets.add("strengthen_slide_grounding_prompt");
    buckets.add("promote_reviewer_feedback");
  }
  if (
    failedMetricIds.has("layout_similarity") ||
    failedMetricIds.has("table_structure_accuracy")
  ) {
    buckets.add("improve_layout_renderer");
  }

  return buckets;
}

function actionForBucket(bucket: RalphRetryBucket): RalphRetryAction {
  switch (bucket) {
    case "collect_benchmark_packets":
      return {
        bucket,
        title: "Benchmark packet 확대",
        reason: "샘플이 부족하면 family 일반화가 아니라 overfitting만 일어납니다.",
        steps: [
          "같은 family의 exemplar, gold report, evidence bundle을 최소 3건 이상 확보합니다.",
          "reviewer가 승인한 출력만 gold packet으로 승격합니다.",
        ],
      };
    case "improve_toc_extractor":
      return {
        bucket,
        title: "목차 추출 강화",
        reason: "목차 exact match가 깨지면 이후 생성도 모두 흔들립니다.",
        steps: [
          "cover, 목차, 본문 페이지를 분리해서 section detector를 다시 학습시킵니다.",
          "required section, numbering, 순서까지 gold TOC와 exact match 하도록 section map을 구축합니다.",
        ],
      };
    case "tighten_document_masking":
      return {
        bucket,
        title: "문서 마스킹 강화",
        reason: "슬라이드가 아닌 문서가 생성 컨텍스트에 남으면 leakage가 발생합니다.",
        steps: [
          "allowed source와 masked source를 family packet에서 명시적으로 분리합니다.",
          "generation prompt 앞단에 masking audit를 추가하고 leakage 사례를 hard-negative로 적재합니다.",
        ],
      };
    case "strengthen_slide_grounding_prompt":
      return {
        bucket,
        title: "슬라이드 grounded prompt 재설계",
        reason: "본문 생성은 target 보고서가 아니라 슬라이드에 grounded되어야 합니다.",
        steps: [
          "section별 slide chunk retrieval을 추가합니다.",
          "prompt에 TOC slot, slide summary, 금지 source 규칙을 명시합니다.",
        ],
      };
    case "improve_layout_renderer":
      return {
        bucket,
        title: "레이아웃 renderer 보강",
        reason: "제출형 보고서는 page blueprint와 표 구조 재현이 품질의 핵심입니다.",
        steps: [
          "report blueprint와 table component constraints를 수정합니다.",
          "visual diff 실패 케이스를 renderer regression fixture로 고정합니다.",
        ],
      };
    case "promote_reviewer_feedback":
      return {
        bucket,
        title: "Reviewer feedback를 reinforcement memory로 승격",
        reason: "반복 수정 사항이 prompt memory와 benchmark에 누적되어야 loop가 학습합니다.",
        steps: [
          "reviewer correction을 section-level diff example로 저장합니다.",
          "다음 iteration에서 few-shot prompt와 benchmark goldset에 함께 반영합니다.",
        ],
      };
  }
}

export function buildReportFamilyRalphPlan(
  evaluation: ReportFamilyBenchmarkEvaluation,
): ReportFamilyRalphPlan {
  const failedMetricIds = new Set(
    evaluation.metrics.filter((metric) => !metric.passed).map((metric) => metric.id),
  );
  const buckets = bucketsFromFailedMetrics(failedMetricIds);
  const actions = ACTION_ORDER.filter((bucket) => buckets.has(bucket)).map(actionForBucket);

  return {
    familyId: evaluation.familyId,
    shouldContinueLoop: evaluation.status === "retry",
    actions,
  };
}
