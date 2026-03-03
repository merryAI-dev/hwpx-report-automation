"use client";

type StatusBarProps = {
  fileName: string;
  nodeCount: number;
  editCount: number;
  dirtyFileCount: number;
  isDirty: boolean;
  status: string;
  charCount?: number;
  wordCount?: number;
};

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function estimateReadingTime(charCount: number): string {
  // Korean average reading speed: ~500 chars/min
  const minutes = Math.max(1, Math.ceil(charCount / 500));
  return `${minutes}분`;
}

export function StatusBar({
  fileName,
  nodeCount,
  editCount,
  dirtyFileCount,
  isDirty,
  status,
  charCount = 0,
  wordCount = 0,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>파일: {fileName || "없음"}</span>
      <span>요소: {nodeCount}</span>
      <span>수정: {editCount}</span>
      <span>변경됨: {dirtyFileCount}</span>
      {charCount > 0 && (
        <>
          <span>{formatCount(charCount)}자</span>
          <span>{formatCount(wordCount)}단어</span>
          <span>읽기 {estimateReadingTime(charCount)}</span>
        </>
      )}
      <span>{isDirty ? "수정됨" : "저장됨"}</span>
      <strong>{status}</strong>
    </footer>
  );
}

