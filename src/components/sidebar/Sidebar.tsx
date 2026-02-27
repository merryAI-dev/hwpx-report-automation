"use client";

import type { ReactNode } from "react";
import type { SidebarTab } from "@/store/document-store";

type SidebarProps = {
  collapsed: boolean;
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  outline: ReactNode;
  ai: ReactNode;
  history: ReactNode;
};

export function Sidebar({
  collapsed,
  activeTab,
  onChangeTab,
  outline,
  ai,
  history,
}: SidebarProps) {
  if (collapsed) {
    return null;
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={activeTab === "outline" ? "sidebar-tab active" : "sidebar-tab"}
          onClick={() => onChangeTab("outline")}
        >
          문서 개요
        </button>
        <button
          type="button"
          className={activeTab === "ai" ? "sidebar-tab active" : "sidebar-tab"}
          onClick={() => onChangeTab("ai")}
        >
          AI 제안
        </button>
        <button
          type="button"
          className={activeTab === "history" ? "sidebar-tab active" : "sidebar-tab"}
          onClick={() => onChangeTab("history")}
        >
          수정 이력
        </button>
      </div>

      <div className="sidebar-content">
        {activeTab === "outline" ? outline : null}
        {activeTab === "ai" ? ai : null}
        {activeTab === "history" ? history : null}
      </div>
    </aside>
  );
}

