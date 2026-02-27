"use client";

import { useEffect } from "react";
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createEditorExtensions } from "@/lib/editor/extensions";

type SelectionPayload = {
  selectedSegmentId: string | null;
  selectedText: string;
};

type DocumentEditorProps = {
  content: JSONContent | null;
  editable?: boolean;
  onUpdateDoc: (doc: JSONContent) => void;
  onSelectionChange: (payload: SelectionPayload) => void;
  onEditorReady: (editor: Editor | null) => void;
  onAiCommand?: () => void;
};

function resolveSelectedSegmentId(editor: Editor): string | null {
  const parentAttrs = editor.state.selection.$from.parent.attrs as { segmentId?: string };
  return parentAttrs.segmentId || null;
}

export function DocumentEditor({
  content,
  editable = true,
  onUpdateDoc,
  onSelectionChange,
  onEditorReady,
  onAiCommand,
}: DocumentEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions({ onAiCommand }),
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    onUpdate: ({ editor: tiptapEditor }) => {
      onUpdateDoc(tiptapEditor.getJSON());
    },
    onSelectionUpdate: ({ editor: tiptapEditor }) => {
      const { from, to } = tiptapEditor.state.selection;
      const selectedText = tiptapEditor.state.doc.textBetween(from, to, " ").trim();
      onSelectionChange({
        selectedSegmentId: resolveSelectedSegmentId(tiptapEditor),
        selectedText,
      });
    },
  });

  useEffect(() => {
    onEditorReady(editor);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || !content) {
      return;
    }
    const next = JSON.stringify(content);
    const current = JSON.stringify(editor.getJSON());
    if (next === current) {
      return;
    }
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  return (
    <div className="document-editor-wrap">
      <EditorContent editor={editor} className="document-editor" />
    </div>
  );
}
