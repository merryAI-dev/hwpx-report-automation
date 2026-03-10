"use client";

import type { Editor } from "@tiptap/core";

type TableControlsProps = {
  editor: Editor | null;
  groupClassName: string;
  buttonClassName: string;
};

export function TableControls({ editor, groupClassName, buttonClassName }: TableControlsProps) {
  const disabled = !editor;

  return (
    <div className={groupClassName}>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 4, withHeaderRow: false }).run()}
      >
        표 삽입
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled || !editor?.can().addRowAfter()}
        onClick={() => editor?.chain().focus().addRowAfter().run()}
      >
        행 추가
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled || !editor?.can().addColumnAfter()}
        onClick={() => editor?.chain().focus().addColumnAfter().run()}
      >
        열 추가
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled || !editor?.can().deleteRow()}
        onClick={() => editor?.chain().focus().deleteRow().run()}
      >
        행 삭제
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled || !editor?.can().deleteTable()}
        onClick={() => editor?.chain().focus().deleteTable().run()}
      >
        표 삭제
      </button>
    </div>
  );
}
