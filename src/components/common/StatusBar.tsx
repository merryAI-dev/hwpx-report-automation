"use client";

type StatusBarProps = {
  fileName: string;
  nodeCount: number;
  editCount: number;
  dirtyFileCount: number;
  isDirty: boolean;
  status: string;
};

export function StatusBar({
  fileName,
  nodeCount,
  editCount,
  dirtyFileCount,
  isDirty,
  status,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>파일: {fileName || "없음"}</span>
      <span>노드: {nodeCount}</span>
      <span>수정: {editCount}</span>
      <span>dirty 파일: {dirtyFileCount}</span>
      <span>{isDirty ? "수정됨" : "저장됨"}</span>
      <strong>{status}</strong>
    </footer>
  );
}

