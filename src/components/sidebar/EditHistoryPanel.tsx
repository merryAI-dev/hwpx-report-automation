"use client";

import type { EditHistoryItem } from "@/store/document-store";

type EditHistoryPanelProps = {
  history: EditHistoryItem[];
};

export function EditHistoryPanel({ history }: EditHistoryPanelProps) {
  if (!history.length) {
    return <p className="sidebar-empty">아직 기록이 없습니다.</p>;
  }

  return (
    <ul className="history-list">
      {history.map((item) => (
        <li key={item.id}>
          <strong>{item.summary}</strong>
          <small>{new Date(item.timestamp).toLocaleString()}</small>
          <span>변경 {item.editCount}건</span>
        </li>
      ))}
    </ul>
  );
}

