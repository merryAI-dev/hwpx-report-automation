"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SidebarTab } from "@/store/document-store";
import styles from "./Sidebar.module.css";

const TAB_LABELS: Record<SidebarTab, string> = {
  outline: "문서 개요",
  ai: "AI 제안",
  chat: "AI 채팅",
  analysis: "문서 분석",
  history: "수정 이력",
};

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 300;

type SidebarProps = {
  collapsed: boolean;
  activeTab: SidebarTab;
  outline: ReactNode;
  ai: ReactNode;
  chat: ReactNode;
  analysis: ReactNode;
  history: ReactNode;
};

export function Sidebar({
  collapsed,
  activeTab,
  outline,
  ai,
  chat,
  analysis,
  history,
}: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startWidth.current = width;
      setDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      // 사이드바가 오른쪽에 있으므로 왼쪽으로 드래그 = 넓어짐
      const delta = startX.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };

    const onMouseUp = () => setDragging(false);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging]);

  if (collapsed) return null;

  return (
    <aside className={styles.panel} style={{ width, userSelect: dragging ? "none" : undefined }}>
      {/* 리사이즈 핸들 — 왼쪽 엣지 */}
      <div
        className={`${styles.resizeHandle} ${dragging ? styles.dragging : ""}`}
        onMouseDown={onMouseDown}
      />

      <div className={styles.panelTitleBar}>{TAB_LABELS[activeTab] ?? ""}</div>

      <div className={activeTab === "chat" ? styles.panelContentChat : styles.panelContent}>
        {activeTab === "outline" ? outline : null}
        {activeTab === "ai" ? ai : null}
        {activeTab === "chat" ? chat : null}
        {activeTab === "analysis" ? analysis : null}
        {activeTab === "history" ? history : null}
      </div>
    </aside>
  );
}
