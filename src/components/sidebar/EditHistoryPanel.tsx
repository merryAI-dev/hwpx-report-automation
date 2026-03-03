"use client";

import type { EditHistoryItem } from "@/store/document-store";

type EditHistoryPanelProps = {
  history: EditHistoryItem[];
  onRestoreItem: (id: string) => void;
  disabled?: boolean;
};

function actorLabel(actor: EditHistoryItem["actor"]): string {
  if (actor === "ai") return "AI";
  if (actor === "user") return "사용자";
  return "시스템";
}

export function EditHistoryPanel({ history, onRestoreItem, disabled = false }: EditHistoryPanelProps) {
  if (!history.length) {
    return <p className="sidebar-empty">아직 기록이 없습니다.</p>;
  }

  return (
    <ul className="history-list">
      {history.map((item) => (
        <li key={item.id}>
          <strong>{item.summary}</strong>
          <span style={{ fontSize: 10, color: "#1e3a8a", fontWeight: 600 }}>
            {actorLabel(item.actor)}
          </span>
          <small>{new Date(item.timestamp).toLocaleString()}</small>
          <span>변경 {item.editCount}건</span>
          <button
            type="button"
            className="btn"
            disabled={disabled || !item.snapshotDoc}
            onClick={() => onRestoreItem(item.id)}
            title={item.snapshotDoc ? "이 시점으로 문서 복원" : "복원 가능한 스냅샷 없음"}
          >
            이 시점 복원
          </button>
        </li>
      ))}
    </ul>
  );
}
