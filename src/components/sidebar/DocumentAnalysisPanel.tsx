"use client";

import { useState } from "react";
import type { TemplateCatalog } from "@/lib/template-catalog";
import type { DocumentAnalysis, ReportFamilyPlanState } from "@/store/document-store";
import {
  COMPLEX_OBJECT_TYPE_LABELS,
  hasComplexObjectSignal,
  type ComplexObjectReport,
} from "@/lib/editor/hwpx-complex-objects";

type DocumentAnalysisPanelProps = {
  analysis: DocumentAnalysis | null;
  complexObjectReport: ComplexObjectReport | null;
  templateCatalog: TemplateCatalog | null;
  isLoading: boolean;
  terminologyDict: Record<string, string>;
  onUpdateEntry: (variant: string, canonical: string) => void;
  onRemoveEntry: (variant: string) => void;
  onApplyTerminology: () => void;
  isBusy: boolean;
  compatibilityWarnings: string[];
  collaborationStats: {
    historyCount: number;
    aiActionCount: number;
  };
  performanceStats: {
    segmentCount: number;
    complexity: "low" | "medium" | "high";
  };
  qaStats: {
    integrityIssueCount: number;
    exportWarningCount: number;
    compatibilityWarningCount: number;
  };
  reportFamilyPlanState: ReportFamilyPlanState;
  reportFamilyDraftState: {
    isLoading: boolean;
    error: string | null;
  };
  canGenerateReportFamilyPlan: boolean;
  onGenerateReportFamilyPlan: () => void;
  canGenerateReportFamilyDraft: boolean;
  onGenerateReportFamilyDraft: () => void;
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 8,
          background: "#e2e8f0",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, score))}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 28, textAlign: "right" }}>
        {score}
      </span>
    </div>
  );
}

export function DocumentAnalysisPanel({
  analysis,
  complexObjectReport,
  templateCatalog,
  isLoading,
  terminologyDict,
  onUpdateEntry,
  onRemoveEntry,
  onApplyTerminology,
  isBusy,
  compatibilityWarnings,
  collaborationStats,
  performanceStats,
  qaStats,
  reportFamilyPlanState,
  reportFamilyDraftState,
  canGenerateReportFamilyPlan,
  onGenerateReportFamilyPlan,
  canGenerateReportFamilyDraft,
  onGenerateReportFamilyDraft,
}: DocumentAnalysisPanelProps) {
  const [expandTerms, setExpandTerms] = useState(true);
  const [expandTemplateFields, setExpandTemplateFields] = useState(true);

  const hasComplexObjects = hasComplexObjectSignal(complexObjectReport);
  const hasTemplateCatalog = !!templateCatalog && (
    templateCatalog.fieldCount > 0 || templateCatalog.issues.length > 0
  );

  if (isLoading && !analysis && !hasTemplateCatalog && !hasComplexObjects && !reportFamilyPlanState.isLoading) {
    return <p className="sidebar-empty">문서 분석 중...</p>;
  }

  if (!analysis && !hasTemplateCatalog && !hasComplexObjects && !reportFamilyPlanState.plan) {
    return <p className="sidebar-empty">문서를 열면 자동으로 분석됩니다.</p>;
  }

  const dictEntries = Object.entries(terminologyDict);
  const activeComplexCounts = complexObjectReport
    ? Object.entries(complexObjectReport.counts).filter(([, count]) => count > 0)
    : [];

  return (
    <div className="ai-panel">
      {/* Polaris readiness 1~5 */}
      <div>
        <label className="sidebar-label">1. 호환성 진단</label>
        {compatibilityWarnings.length ? (
          <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
            {compatibilityWarnings.slice(0, 6).map((warning) => (
              <li
                key={warning}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  background: "#fff7ed",
                  border: "1px solid #fdba74",
                  borderRadius: 2,
                  color: "#7c2d12",
                }}
              >
                {warning}
              </li>
            ))}
          </ul>
        ) : (
          <div className="sidebar-box">내보내기 호환성 경고 없음</div>
        )}
      </div>

      <div>
        <label className="sidebar-label">2. 객체 커버리지</label>
        <div className="sidebar-box">
          {compatibilityWarnings.some((w) => w.includes("객체 노드") || w.includes("개체"))
            ? "일부 개체가 HWPX에 완전히 반영되지 않을 수 있습니다."
            : "현재 문서 기준 개체/표 반영 경고 없음"}
        </div>
      </div>

      <div>
        <label className="sidebar-label">3. 협업 추적</label>
        <div className="sidebar-box">
          이력 {collaborationStats.historyCount}건 / AI 작업 {collaborationStats.aiActionCount}건
        </div>
      </div>

      <div>
        <label className="sidebar-label">4. 성능 상태</label>
        <div className="sidebar-box">
          문단 {performanceStats.segmentCount}개 / 복잡도 {performanceStats.complexity}
        </div>
      </div>

      <div>
        <label className="sidebar-label">5. QA 게이트</label>
        <div className="sidebar-box">
          무결성 경고 {qaStats.integrityIssueCount}건 · 내보내기 경고 {qaStats.exportWarningCount}건 · 호환성 경고 {qaStats.compatibilityWarningCount}건
        </div>
      </div>

      <div>
        <label className="sidebar-label">6. 리포트 패밀리 계획</label>
        <div className="sidebar-box" style={{ display: "grid", gap: 10, background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              PPTX 기반 보고서 family용 TOC, masking, slide-grounded prompt 계획입니다.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onGenerateReportFamilyPlan}
                disabled={isBusy || reportFamilyPlanState.isLoading || !canGenerateReportFamilyPlan}
                style={{
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  background: canGenerateReportFamilyPlan ? "#ffffff" : "#f8fafc",
                  color: canGenerateReportFamilyPlan ? "#0f172a" : "#94a3b8",
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: canGenerateReportFamilyPlan ? "pointer" : "not-allowed",
                }}
              >
                {reportFamilyPlanState.isLoading ? "계획 계산 중..." : "계획 다시 계산"}
              </button>
              <button
                type="button"
                onClick={onGenerateReportFamilyDraft}
                disabled={
                  isBusy ||
                  reportFamilyDraftState.isLoading ||
                  !canGenerateReportFamilyDraft
                }
                style={{
                  borderRadius: 10,
                  border: "1px solid #1d4ed8",
                  background: canGenerateReportFamilyDraft ? "#1d4ed8" : "#dbeafe",
                  color: canGenerateReportFamilyDraft ? "#eff6ff" : "#93c5fd",
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: canGenerateReportFamilyDraft ? "pointer" : "not-allowed",
                }}
              >
                {reportFamilyDraftState.isLoading ? "초안 생성 중..." : "보고서 초안 생성"}
              </button>
            </div>
          </div>

          {reportFamilyPlanState.error ? (
            <div
              style={{
                fontSize: 12,
                padding: "6px 8px",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                borderRadius: 8,
                color: "#9f1239",
              }}
            >
              {reportFamilyPlanState.error}
            </div>
          ) : null}

          {reportFamilyDraftState.error ? (
            <div
              style={{
                fontSize: 12,
                padding: "6px 8px",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                borderRadius: 8,
                color: "#9f1239",
              }}
            >
              {reportFamilyDraftState.error}
            </div>
          ) : null}

          {!canGenerateReportFamilyPlan && !reportFamilyPlanState.plan ? (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              현재는 PPTX 문서를 열었을 때만 slide-grounded 계획을 자동 계산합니다.
            </div>
          ) : null}

          {canGenerateReportFamilyDraft ? (
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
              계획이 계산되면 현재 슬라이드 문서를 닫고 target TOC 기준의 새 보고서 초안을 생성합니다.
            </div>
          ) : null}

          {reportFamilyPlanState.plan ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {reportFamilyPlanState.plan.familyId ? (
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#e2e8f0", color: "#334155", fontWeight: 600 }}>
                    Family {reportFamilyPlanState.plan.familyId}
                  </span>
                ) : null}
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f1f5f9", color: "#475569", fontWeight: 600 }}>
                  {reportFamilyPlanState.plan.schemaSource === "registered_packet" ? "registered packet schema" : reportFamilyPlanState.plan.schemaSource === "synthetic_outline" ? "outline-derived schema" : "target document schema"}
                </span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontWeight: 600 }}>
                  TOC {reportFamilyPlanState.plan.toc.length}
                </span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontWeight: 600 }}>
                  Allowed {reportFamilyPlanState.plan.sourcePolicy.allowedSourceIds.length}
                </span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                  Masked {reportFamilyPlanState.plan.sourcePolicy.maskedSourceIds.length}
                </span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9", fontWeight: 600 }}>
                  Section prompts {reportFamilyPlanState.plan.sectionPlans.length}
                </span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                  Mapped {reportFamilyPlanState.plan.sectionPlans.filter((section) => section.alignmentStrategy === "registered_mapping").length}
                </span>
                {reportFamilyPlanState.plan.planQuality ? (
                  <>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#ecfeff", color: "#155e75", fontWeight: 600 }}>
                      Mapping {Math.round(reportFamilyPlanState.plan.planQuality.mappingCoverage * 100)}%
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#eef2ff", color: "#3730a3", fontWeight: 600 }}>
                      Type {Math.round(reportFamilyPlanState.plan.planQuality.sectionTypeAlignment * 100)}%
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#fff7ed", color: "#9a3412", fontWeight: 600 }}>
                      Appendix {Math.round(reportFamilyPlanState.plan.planQuality.appendixEvidenceReadiness * 100)}%
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f0fdf4", color: "#166534", fontWeight: 600 }}>
                      Entity {Math.round(reportFamilyPlanState.plan.planQuality.entityCoverage * 100)}%
                    </span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#f8fafc", color: "#475569", fontWeight: 600 }}>
                      Evidence {reportFamilyPlanState.plan.planQuality.evidenceBundleCount}
                    </span>
                  </>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>추출된 목차</div>
                <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                  {reportFamilyPlanState.plan.toc.slice(0, 6).map((entry) => (
                    <li key={entry.id} style={{ fontSize: 12, color: "#334155" }}>
                      {entry.numbering ? `${entry.numbering} ` : ""}{entry.title}
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>생성 소스 정책</div>
                <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                  {reportFamilyPlanState.plan.sourcePolicy.reasons.map((reason) => (
                    <li key={reason} style={{ fontSize: 12, color: "#475569" }}>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              {reportFamilyPlanState.plan.planQuality ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>패밀리 schema 품질</div>
                  <div
                    style={{
                      fontSize: 12,
                      padding: "8px 10px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      color: "#334155",
                      lineHeight: 1.6,
                    }}
                  >
                    등록 섹션 {reportFamilyPlanState.plan.planQuality.registeredSectionCount}개 중 {reportFamilyPlanState.plan.planQuality.mappedSectionCount}개가 현재 slide cluster에 연결됐습니다.
                    <br />
                    상태: {reportFamilyPlanState.plan.planQuality.status === "pass" ? "family schema aligned" : "retry required"}
                  </div>
                  {reportFamilyPlanState.plan.planQuality.missingMappings.length ||
                  reportFamilyPlanState.plan.planQuality.typeMismatches.length ||
                  reportFamilyPlanState.plan.planQuality.appendixGaps.length ||
                  reportFamilyPlanState.plan.planQuality.entityGaps.length ? (
                    <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                      {reportFamilyPlanState.plan.planQuality.missingMappings.slice(0, 3).map((title) => (
                        <li
                          key={`missing-${title}`}
                          style={{
                            fontSize: 12,
                            padding: "6px 8px",
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: 8,
                            color: "#475569",
                          }}
                        >
                          missing mapping: {title}
                        </li>
                      ))}
                      {reportFamilyPlanState.plan.planQuality.typeMismatches.slice(0, 2).map((issue) => (
                        <li
                          key={`type-${issue}`}
                          style={{
                            fontSize: 12,
                            padding: "6px 8px",
                            background: "#eef2ff",
                            border: "1px solid #c7d2fe",
                            borderRadius: 8,
                            color: "#3730a3",
                          }}
                        >
                          type mismatch: {issue}
                        </li>
                      ))}
                      {reportFamilyPlanState.plan.planQuality.appendixGaps.slice(0, 2).map((title) => (
                        <li
                          key={`appendix-${title}`}
                          style={{
                            fontSize: 12,
                            padding: "6px 8px",
                            background: "#fff7ed",
                            border: "1px solid #fed7aa",
                            borderRadius: 8,
                            color: "#9a3412",
                          }}
                        >
                          appendix gap: {title}
                        </li>
                      ))}
                      {reportFamilyPlanState.plan.planQuality.entityGaps.slice(0, 2).map((title) => (
                        <li
                          key={`entity-${title}`}
                          style={{
                            fontSize: 12,
                            padding: "6px 8px",
                            background: "#f0fdf4",
                            border: "1px solid #bbf7d0",
                            borderRadius: 8,
                            color: "#166534",
                          }}
                        >
                          entity gap: {title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>대표 섹션 매핑</div>
                <ul style={{ listStyle: "none", display: "grid", gap: 6 }}>
                  {reportFamilyPlanState.plan.sectionPlans
                    .filter((section) => section.supportingChunks.length > 0)
                    .slice(0, 4)
                    .map((section) => (
                      <li
                        key={section.tocEntryId}
                        style={{
                          fontSize: 12,
                          padding: "6px 8px",
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          color: "#334155",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <strong style={{ color: "#0f172a" }}>{section.tocTitle}</strong>
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#ede9fe", color: "#6d28d9", fontWeight: 700 }}>
                            {section.sectionType}
                          </span>
                          {section.evidenceExpectation === "appendix_bundle_required" ? (
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                              appendix bundle
                            </span>
                          ) : null}
                          {section.chunkingStrategy === "slide_entity" ? (
                            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "#ecfeff", color: "#155e75", fontWeight: 700 }}>
                              entity chunks
                            </span>
                          ) : null}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          {section.supportingChunks.map((chunk) => chunk.title).join(", ")}
                        </div>
                        {section.focusEntities.length ? (
                          <div style={{ marginTop: 2, color: "#64748b" }}>
                            entity: {section.focusEntities.join(", ")}
                          </div>
                        ) : null}
                        {section.evidenceBundles.length ? (
                          <div style={{ marginTop: 2, color: "#7c2d12" }}>
                            evidence: {section.evidenceBundles.map((bundle) => bundle.fileName).join(", ")}
                          </div>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>

              {reportFamilyPlanState.plan.retryPlan?.actions.length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>다음 RALPH 액션</div>
                  <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                    {reportFamilyPlanState.plan.retryPlan.actions.slice(0, 4).map((action) => (
                      <li key={action.bucket} style={{ fontSize: 12, color: "#475569" }}>
                        <strong style={{ color: "#0f172a" }}>{action.title}</strong>: {action.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {hasComplexObjects && complexObjectReport ? (
        <div>
          <label className="sidebar-label">복합 객체</label>
          <div
            className="sidebar-box"
            style={{ display: "grid", gap: 8, background: "#f8fafc" }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {complexObjectReport.sectionCount > 1 ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "#e0f2fe",
                    color: "#0c4a6e",
                    fontWeight: 600,
                  }}
                >
                  섹션 {complexObjectReport.sectionCount}
                </span>
              ) : null}
              {activeComplexCounts.map(([type, count]) => (
                <span
                  key={type}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "#fff7ed",
                    color: "#9a3412",
                    fontWeight: 600,
                  }}
                >
                  {COMPLEX_OBJECT_TYPE_LABELS[type as keyof typeof COMPLEX_OBJECT_TYPE_LABELS]} {count}
                </span>
              ))}
            </div>
            {complexObjectReport.warnings.length ? (
              <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                {complexObjectReport.warnings.map((warning) => (
                  <li
                    key={warning}
                    style={{
                      fontSize: 12,
                      padding: "4px 8px",
                      background: "#fff7ed",
                      border: "1px solid #fed7aa",
                      borderRadius: 2,
                      color: "#9a3412",
                    }}
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
            {complexObjectReport.occurrences.length ? (
              <div style={{ display: "grid", gap: 2 }}>
                {complexObjectReport.occurrences.slice(0, 6).map((occurrence) => (
                  <div
                    key={`${occurrence.fileName}-${occurrence.type}-${occurrence.localName}`}
                    style={{ fontSize: 11, color: "#64748b" }}
                  >
                    {occurrence.fileName} · {occurrence.localName} × {occurrence.count}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? <p style={{ fontSize: 12, color: "#64748b" }}>문서 분석 중...</p> : null}

      {analysis ? (
        <>
          <div>
            <label className="sidebar-label">문서 유형</label>
            <div className="sidebar-box" style={{ fontWeight: 600 }}>
              {analysis.documentType}
            </div>
          </div>

          <div>
            <label className="sidebar-label">가독성 점수</label>
            <ScoreBar score={analysis.readabilityScore} />
          </div>

          {analysis.globalIssues.length > 0 && (
            <div>
              <label className="sidebar-label">발견된 이슈</label>
              <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
                {analysis.globalIssues.map((issue, i) => (
                  <li
                    key={`issue-${i}`}
                    style={{
                      fontSize: 12,
                      padding: "4px 8px",
                      background: "#fffbeb",
                      border: "1px solid #f5d899",
                      borderRadius: 2,
                      color: "#7c4a03",
                    }}
                  >
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.inconsistentTerms.length > 0 && (
            <div>
              <button
                type="button"
                className="sidebar-label"
                onClick={() => setExpandTerms(!expandTerms)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {expandTerms ? "▾" : "▸"} 용어 불일치 ({analysis.inconsistentTerms.length}건)
              </button>
              {expandTerms && (
                <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 4 }}>
                  {analysis.inconsistentTerms.map((term, i) => (
                    <li
                      key={`term-${i}`}
                      style={{
                        fontSize: 12,
                        padding: "6px 8px",
                        background: "#f8fbff",
                        border: "1px solid #dbe6f1",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ color: "#64748b", marginBottom: 2 }}>
                        {term.variants.join(", ")}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 11, color: "#888" }}>→</span>
                        <strong>{term.suggestedTerm}</strong>
                        {!terminologyDict[term.variants[0]] && (
                          <button
                            type="button"
                            style={{
                              marginLeft: "auto",
                              fontSize: 11,
                              padding: "1px 6px",
                              border: "1px solid #b4b4b4",
                              borderRadius: 2,
                              background: "#f0f0f0",
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              for (const v of term.variants) {
                                if (v !== term.suggestedTerm) {
                                  onUpdateEntry(v, term.suggestedTerm);
                                }
                              }
                            }}
                          >
                            사전 추가
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : null}

      {templateCatalog ? (
        <div>
          <label className="sidebar-label">템플릿 카탈로그</label>
          <div
            className="sidebar-box"
            style={{ display: "grid", gap: 6, fontSize: 12, background: "#f8fafc" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>버전</span>
              <strong>{templateCatalog.version}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>필드 수</span>
              <strong>{templateCatalog.fieldCount}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>태그 수</span>
              <strong>{templateCatalog.rawTagCount}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>이슈 수</span>
              <strong style={{ color: templateCatalog.issues.length ? "#dc2626" : "#16a34a" }}>
                {templateCatalog.issues.length}
              </strong>
            </div>
          </div>

          {templateCatalog.issues.length > 0 && (
            <ul style={{ listStyle: "none", display: "grid", gap: 4, marginTop: 6 }}>
              {templateCatalog.issues.slice(0, 6).map((issue, index) => (
                <li
                  key={`template-issue-${index}`}
                  style={{
                    fontSize: 12,
                    padding: "4px 8px",
                    background: issue.severity === "error" ? "#fef2f2" : "#fff7ed",
                    border: `1px solid ${issue.severity === "error" ? "#fecaca" : "#fed7aa"}`,
                    borderRadius: 2,
                    color: issue.severity === "error" ? "#991b1b" : "#9a3412",
                  }}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          {templateCatalog.fields.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="sidebar-label"
                onClick={() => setExpandTemplateFields(!expandTemplateFields)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {expandTemplateFields ? "▾" : "▸"} 필드 목록 ({templateCatalog.fields.length}건)
              </button>
              {expandTemplateFields && (
                <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 4 }}>
                  {templateCatalog.fields.slice(0, 12).map((field) => (
                    <li
                      key={field.key}
                      style={{
                        fontSize: 12,
                        padding: "6px 8px",
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong>{field.label}</strong>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 5px",
                            borderRadius: 999,
                            background: "#e2e8f0",
                            color: "#334155",
                          }}
                        >
                          {field.type}
                        </span>
                        {field.required && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 5px",
                              borderRadius: 999,
                              background: "#fee2e2",
                              color: "#991b1b",
                            }}
                          >
                            required
                          </span>
                        )}
                        <span style={{ marginLeft: "auto", color: "#64748b" }}>
                          {field.occurrences.length}회
                        </span>
                      </div>
                      <div style={{ color: "#64748b", marginTop: 2 }}>{field.key}</div>
                      {field.options.length > 0 && (
                        <div style={{ color: "#475569", marginTop: 2 }}>
                          options: {field.options.join(", ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}

      {dictEntries.length > 0 && (
        <div>
          <label className="sidebar-label">용어 사전 ({dictEntries.length}건)</label>
          <ul style={{ listStyle: "none", display: "grid", gap: 4 }}>
            {dictEntries.map(([variant, canonical]) => (
              <li
                key={variant}
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span style={{ color: "#ef4444", textDecoration: "line-through" }}>{variant}</span>
                <span style={{ color: "#888" }}>→</span>
                <strong>{canonical}</strong>
                <button
                  type="button"
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    padding: "0 4px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "#888",
                  }}
                  onClick={() => onRemoveEntry(variant)}
                  title="삭제"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="sidebar-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              disabled={isBusy || !dictEntries.length}
              onClick={onApplyTerminology}
            >
              일괄 치환 ({dictEntries.length}건)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
