"use client";

import type { Editor } from "@tiptap/core";
import { TableControls } from "./TableControls";

type EditorToolbarProps = {
  editor: Editor | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onAiCommand: () => void;
};

export function EditorToolbar({
  editor,
  sidebarCollapsed,
  onToggleSidebar,
  onAiCommand,
}: EditorToolbarProps) {
  const disabled = !editor;

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={editor?.isActive("bold") ? "toolbar-btn active" : "toolbar-btn"}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className={editor?.isActive("italic") ? "toolbar-btn active" : "toolbar-btn"}
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          Italic
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={disabled}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </button>
      </div>

      <TableControls editor={editor} />

      <div className="toolbar-group">
        <button type="button" className="toolbar-btn" disabled={disabled} onClick={onAiCommand}>
          AI 수정
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={disabled}
          onClick={() => editor?.chain().focus().insertContent("#").run()}
        >
          # 명령어
        </button>
        <button type="button" className="toolbar-btn" onClick={onToggleSidebar}>
          {sidebarCollapsed ? "사이드바 열기" : "사이드바 닫기"}
        </button>
      </div>
    </div>
  );
}

