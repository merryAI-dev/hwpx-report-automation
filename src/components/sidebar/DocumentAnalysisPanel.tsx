"use client";

import { useState } from "react";
import type { DocumentAnalysis } from "@/store/document-store";

type DocumentAnalysisPanelProps = {
  analysis: DocumentAnalysis | null;
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

  if (isLoading) {
    return <p className="sidebar-empty">문서 분석 중...</p>;
  }

  if (!analysis) {
    return <p className="sidebar-empty">문서를 열면 자동으로 분석됩니다.</p>;
  }

  const dictEntries = Object.entries(terminologyDict);

  return (
    <div className="ai-panel">
      {/* Document type */}
      <div>
        <label className="sidebar-label">문서 유형</label>
        <div className="sidebar-box" style={{ fontWeight: 600 }}>
          {analysis.documentType}
        </div>
      </div>

      {/* Readability score */}
      <div>
        <label className="sidebar-label">가독성 점수</label>
        <ScoreBar score={analysis.readabilityScore} />
      </div>

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
          {compatibilityWarnings.some((w) => w.includes("객체 노드"))
            ? "일부 객체 노드가 HWPX에 완전 반영되지 않을 수 있습니다."
            : "현재 문서 기준 객체/표 반영 경고 없음"}
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
          세그먼트 {performanceStats.segmentCount}개 / 복잡도 {performanceStats.complexity}
        </div>
      </div>

      <div>
        <label className="sidebar-label">5. QA 게이트</label>
        <div className="sidebar-box">
          무결성 경고 {qaStats.integrityIssueCount}건 · 내보내기 경고 {qaStats.exportWarningCount}건 · 호환성 경고 {qaStats.compatibilityWarningCount}건
        </div>
      </div>

      {/* Global issues */}
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

      {/* Inconsistent terms */}
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

      {/* Terminology dictionary */}
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
