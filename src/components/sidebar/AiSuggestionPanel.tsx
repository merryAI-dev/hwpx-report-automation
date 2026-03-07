"use client";

import { useMemo } from "react";
import { diffWords } from "diff";
import type { InstructionPreset, PresetKey } from "@/lib/editor/ai-presets";
import type { BatchJobState, VerificationResult } from "@/store/document-store";

function InlineDiff({ before, after }: { before: string; after: string }) {
  const changes = diffWords(before, after);
  return (
    <p style={{ fontSize: 11, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
      {changes.map((change, i) => {
        if (change.removed) {
          return (
            <span key={`d-${i}`} className="diff-text-removed">
              {change.value}
            </span>
          );
        }
        if (change.added) {
          return (
            <span key={`d-${i}`} className="diff-text-added">
              {change.value}
            </span>
          );
        }
        return <span key={`d-${i}`}>{change.value}</span>;
      })}
    </p>
  );
}

type AiSuggestionPanelProps = {
  instruction: string;
  suggestion: string;
  selectedText: string;
  batchTargetCount: number;
  batchSuggestionCount: number;
  batchDiffItems: Array<{ id: string; before: string; after: string }>;
  batchJob: BatchJobState | null;
  isBusy: boolean;
  onChangeInstruction: (instruction: string) => void;
  onRequestSuggestion: () => void;
  onApplySuggestion: () => void;
  onRequestBatchSuggestion: () => void;
  onApplyBatchSuggestion: () => void;
  // Phase 2-1: Accept/Reject
  batchDecisions: Record<string, "accepted" | "rejected">;
  onSetBatchDecision: (id: string, decision: "accepted" | "rejected") => void;
  onApplySelectedBatchSuggestion: () => void;
  // Phase 2-3: Presets
  presets: InstructionPreset[];
  selectedPreset: PresetKey;
  onSelectPreset: (key: PresetKey) => void;
  // Phase 2-6: Verification
  verificationResult: VerificationResult | null;
  verificationLoading: boolean;
  onVerifySuggestion: () => void;
  // Batch mode
  batchMode: "section" | "document";
  onSetBatchMode: (mode: "section" | "document") => void;
};

export function AiSuggestionPanel({
  instruction,
  suggestion,
  selectedText,
  batchTargetCount,
  batchSuggestionCount,
  batchDiffItems,
  batchJob,
  isBusy,
  onChangeInstruction,
  onRequestSuggestion,
  onApplySuggestion,
  onRequestBatchSuggestion,
  onApplyBatchSuggestion,
  batchDecisions,
  onSetBatchDecision,
  onApplySelectedBatchSuggestion,
  presets,
  selectedPreset,
  onSelectPreset,
  verificationResult,
  verificationLoading,
  onVerifySuggestion,
  batchMode,
  onSetBatchMode,
}: AiSuggestionPanelProps) {
  const { acceptedCount, rejectedCount } = useMemo(() => {
    const ids = new Set(batchDiffItems.map((d) => d.id));
    let accepted = 0;
    let rejected = 0;
    for (const [id, decision] of Object.entries(batchDecisions)) {
      if (!ids.has(id)) continue;
      if (decision === "accepted") accepted++;
      else if (decision === "rejected") rejected++;
    }
    return { acceptedCount: accepted, rejectedCount: rejected };
  }, [batchDecisions, batchDiffItems]);

  return (
    <div className="ai-panel">
      {/* ── 선택 텍스트 ── */}
      <label className="sidebar-label">선택 텍스트</label>
      <div className="sidebar-box">{selectedText || "에디터에서 텍스트를 선택하세요."}</div>

      {/* ── 프리셋 + 지시문 ── */}
      <label className="sidebar-label">지시문 프리셋</label>
      <select
        className="sidebar-textarea"
        style={{ minHeight: "auto", height: 26, resize: "none", padding: "0 6px" }}
        value={selectedPreset}
        onChange={(e) => {
          const key = e.target.value as PresetKey;
          onSelectPreset(key);
          const preset = presets.find((p) => p.key === key);
          if (preset && preset.instruction) {
            onChangeInstruction(preset.instruction);
          }
        }}
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>

      <label className="sidebar-label">AI 지시문</label>
      <textarea
        className="sidebar-textarea"
        value={instruction}
        onChange={(event) => onChangeInstruction(event.target.value)}
      />

      {/* ── 단일 제안 ── */}
      <div className="sidebar-actions">
        <button type="button" className="btn" disabled={isBusy} onClick={onRequestSuggestion}>
          AI 제안 생성
        </button>
        <button type="button" className="btn" disabled={isBusy || !suggestion} onClick={onApplySuggestion}>
          제안 적용
        </button>
        <button
          type="button"
          className="btn"
          disabled={isBusy || !suggestion || verificationLoading}
          onClick={onVerifySuggestion}
          title="AI 수정 검증"
        >
          {verificationLoading ? "검증 중..." : "검증"}
        </button>
      </div>

      {/* Verification result */}
      {verificationResult && (
        <div
          style={{
            padding: "4px 8px",
            fontSize: 12,
            borderRadius: 2,
            border: verificationResult.passed ? "1px solid #86efac" : "1px solid #fcd34d",
            background: verificationResult.passed ? "#dcfce7" : "#fffbeb",
            color: verificationResult.passed ? "#166534" : "#7c4a03",
          }}
        >
          {verificationResult.passed ? (
            <span>&#10003; 검증 통과</span>
          ) : (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>&#9888; 검증 이슈</div>
              {verificationResult.issues.map((issue, i) => (
                <div key={`vr-${i}`} style={{ paddingLeft: 8, marginTop: 2 }}>
                  - {issue}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="sidebar-label">AI 제안 결과</label>
      <div className="sidebar-box">{suggestion || "아직 제안이 없습니다."}</div>

      {/* ── 일괄 수정 범위 ── */}
      <label className="sidebar-label">일괄 수정 범위</label>
      <div className="sidebar-actions">
        <button
          type="button"
          className={`btn ${batchMode === "section" ? "primary" : ""}`}
          onClick={() => onSetBatchMode("section")}
        >
          섹션
        </button>
        <button
          type="button"
          className={`btn ${batchMode === "document" ? "primary" : ""}`}
          onClick={() => onSetBatchMode("document")}
        >
          전체 문서
        </button>
      </div>

      {/* ── 일괄 수정 ── */}
      <label className="sidebar-label">일괄 수정</label>
      <div className="sidebar-box">
        현재 대상 {batchTargetCount}개 / 생성된 제안 {batchSuggestionCount}개
        {batchJob ? (
          <div style={{ marginTop: 6, fontSize: 11, color: "#4b5563" }}>
            작업 {batchJob.status} / 청크 {batchJob.completedChunks}/{batchJob.totalChunks} / 결과 {batchJob.resultCount}개
            {batchJob.error ? <div style={{ color: "#b91c1c", marginTop: 4 }}>{batchJob.error}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="sidebar-actions">
        <button
          type="button"
          className="btn"
          disabled={isBusy || batchTargetCount === 0}
          onClick={onRequestBatchSuggestion}
        >
          일괄 제안 생성
        </button>
        <button
          type="button"
          className="btn"
          disabled={isBusy || batchSuggestionCount === 0}
          onClick={onApplyBatchSuggestion}
        >
          전체 적용
        </button>
      </div>

      {/* ── Accept/Reject individual diffs ── */}
      {acceptedCount + rejectedCount > 0 && (
        <div className="sidebar-actions">
          <button
            type="button"
            className="btn"
            disabled={isBusy || acceptedCount === 0}
            onClick={onApplySelectedBatchSuggestion}
          >
            선택 적용 ({acceptedCount}건 수락 / {rejectedCount}건 거부)
          </button>
        </div>
      )}

      <label className="sidebar-label">일괄 제안 Diff</label>
      {batchDiffItems.length ? (
        <ul className="batch-diff-list">
          {batchDiffItems.map((item) => {
            const decision = batchDecisions[item.id];
            return (
              <li
                key={item.id}
                className="batch-diff-item"
                data-batch-diff-id={item.id}
                style={decision === "rejected" ? { opacity: 0.5 } : undefined}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.id}
                  </strong>
                  <button
                    type="button"
                    className="batch-decision-btn"
                    data-state={decision === "accepted" ? "accepted" : undefined}
                    onClick={() => onSetBatchDecision(item.id, "accepted")}
                    title="수락"
                  >
                    &#10003;
                  </button>
                  <button
                    type="button"
                    className="batch-decision-btn"
                    data-state={decision === "rejected" ? "rejected" : undefined}
                    onClick={() => onSetBatchDecision(item.id, "rejected")}
                    title="거부"
                  >
                    &#10007;
                  </button>
                </div>
                <InlineDiff before={item.before} after={item.after} />
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="sidebar-box">변경된 일괄 제안이 없습니다.</div>
      )}
    </div>
  );
}
