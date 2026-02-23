"use client";

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
  if (collapsed) {
    return null;
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.panelTitleBar}>
        {TAB_LABELS[activeTab] ?? ""}
      </div>
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
