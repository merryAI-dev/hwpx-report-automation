"use client";

type AiSuggestionPanelProps = {
  instruction: string;
  suggestion: string;
  selectedText: string;
  batchTargetCount: number;
  batchSuggestionCount: number;
  batchDiffItems: Array<{ id: string; before: string; after: string }>;
  isBusy: boolean;
  onChangeInstruction: (instruction: string) => void;
  onRequestSuggestion: () => void;
  onApplySuggestion: () => void;
  onRequestBatchSuggestion: () => void;
  onApplyBatchSuggestion: () => void;
};

export function AiSuggestionPanel({
  instruction,
  suggestion,
  selectedText,
  batchTargetCount,
  batchSuggestionCount,
  batchDiffItems,
  isBusy,
  onChangeInstruction,
  onRequestSuggestion,
  onApplySuggestion,
  onRequestBatchSuggestion,
  onApplyBatchSuggestion,
}: AiSuggestionPanelProps) {
  return (
    <div className="ai-panel">
      <label className="sidebar-label">선택 텍스트</label>
      <div className="sidebar-box">{selectedText || "에디터에서 텍스트를 선택하세요."}</div>

      <label className="sidebar-label">AI 지시문</label>
      <textarea
        className="sidebar-textarea"
        value={instruction}
        onChange={(event) => onChangeInstruction(event.target.value)}
      />

      <div className="sidebar-actions">
        <button type="button" className="btn" disabled={isBusy} onClick={onRequestSuggestion}>
          AI 제안 생성
        </button>
        <button type="button" className="btn" disabled={isBusy || !suggestion} onClick={onApplySuggestion}>
          제안 적용
        </button>
      </div>

      <label className="sidebar-label">AI 제안 결과</label>
      <div className="sidebar-box">{suggestion || "아직 제안이 없습니다."}</div>

      <label className="sidebar-label">섹션 일괄 수정</label>
      <div className="sidebar-box">
        현재 대상 {batchTargetCount}개 / 생성된 제안 {batchSuggestionCount}개
      </div>
      <div className="sidebar-actions">
        <button
          type="button"
          className="btn"
          disabled={isBusy || batchTargetCount === 0}
          onClick={onRequestBatchSuggestion}
        >
          섹션 일괄 제안 생성
        </button>
        <button
          type="button"
          className="btn"
          disabled={isBusy || batchSuggestionCount === 0}
          onClick={onApplyBatchSuggestion}
        >
          섹션 일괄 적용
        </button>
      </div>

      <label className="sidebar-label">일괄 제안 Diff</label>
      {batchDiffItems.length ? (
        <ul className="batch-diff-list">
          {batchDiffItems.map((item) => (
            <li key={item.id} className="batch-diff-item">
              <strong>{item.id}</strong>
              <div className="batch-diff-grid">
                <div className="batch-diff-col">
                  <small>Before</small>
                  <p>{item.before}</p>
                </div>
                <div className="batch-diff-col">
                  <small>After</small>
                  <p>{item.after}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sidebar-box">변경된 일괄 제안이 없습니다.</div>
      )}
    </div>
  );
}
