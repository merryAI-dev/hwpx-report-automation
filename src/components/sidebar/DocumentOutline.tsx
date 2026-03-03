"use client";

import type { OutlineItem } from "@/lib/editor/document-store";

type DocumentOutlineProps = {
  outline: OutlineItem[];
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string) => void;
};

export function DocumentOutline({ outline, selectedSegmentId, onSelectSegment }: DocumentOutlineProps) {
  if (!outline.length) {
    return <p className="sidebar-empty">헤딩 기반 개요가 없습니다.</p>;
  }

  return (
    <ul className="outline-list">
      {outline.map((item) => {
        const segmentId = item.segmentId;
        return (
          <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>
            {segmentId ? (
              <button
                type="button"
                className={segmentId === selectedSegmentId ? "outline-item-btn active" : "outline-item-btn"}
                onClick={() => onSelectSegment?.(segmentId)}
              >
                {item.text}
              </button>
            ) : (
              <span>{item.text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
