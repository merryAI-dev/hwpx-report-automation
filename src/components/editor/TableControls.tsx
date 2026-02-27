"use client";

import type { Editor } from "@tiptap/core";

type TableControlsProps = {
  editor: Editor | null;
};

export function TableControls({ editor }: TableControlsProps) {
  const disabled = !editor;

  return (
    <div className="toolbar-group">
      <button
        type="button"
        className="toolbar-btn"
        disabled={disabled}
        onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 4, withHeaderRow: false }).run()}
      >
        표 삽입
      </button>
      <button
        type="button"
        className="toolbar-btn"
        disabled={disabled || !editor?.can().addRowAfter()}
        onClick={() => editor?.chain().focus().addRowAfter().run()}
      >
        행 추가
      </button>
      <button
        type="button"
        className="toolbar-btn"
        disabled={disabled || !editor?.can().addColumnAfter()}
        onClick={() => editor?.chain().focus().addColumnAfter().run()}
      >
        열 추가
      </button>
      <button
        type="button"
        className="toolbar-btn"
        disabled={disabled || !editor?.can().deleteTable()}
        onClick={() => editor?.chain().focus().deleteTable().run()}
      >
        표 삭제
      </button>
    </div>
  );
}

