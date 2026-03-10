"use client";

import { useState } from "react";
import type { TemplateCatalog } from "@/lib/template-catalog";
import type { DocumentAnalysis } from "@/store/document-store";
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
}: DocumentAnalysisPanelProps) {
  const [expandTerms, setExpandTerms] = useState(true);
  const [expandTemplateFields, setExpandTemplateFields] = useState(true);

  const hasComplexObjects = hasComplexObjectSignal(complexObjectReport);
  const hasTemplateCatalog = !!templateCatalog && (
    templateCatalog.fieldCount > 0 || templateCatalog.issues.length > 0
  );

  if (isLoading && !analysis && !hasTemplateCatalog && !hasComplexObjects) {
    return <p className="sidebar-empty">문서 분석 중...</p>;
  }

  if (!analysis && !hasTemplateCatalog && !hasComplexObjects) {
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

          {analysis.inconsistentTerms.filter((term) => !term.variants.some((v) => terminologyDict[v])).length > 0 && (
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
                {expandTerms ? "▾" : "▸"} 용어 불일치 ({analysis.inconsistentTerms.filter((term) => !term.variants.some((v) => terminologyDict[v])).length}건)
              </button>
              {expandTerms && (
                <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 4 }}>
                  {analysis.inconsistentTerms.filter((term) => !term.variants.some((v) => terminologyDict[v])).map((term, i) => (
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
