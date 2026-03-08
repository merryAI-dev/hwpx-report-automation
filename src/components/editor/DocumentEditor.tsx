"use client";

import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createEditorExtensions } from "@/lib/editor/extensions";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import type { HwpxDocumentModel } from "@/types/hwpx-model";

type SelectionPayload = {
  selectedSegmentId: string | null;
  selectedText: string;
};

type DocumentEditorProps = {
  content: JSONContent | null;
  editable?: boolean;
  formMode?: boolean;
  onUpdateDoc: (doc: JSONContent) => void;
  onSelectionChange: (payload: SelectionPayload) => void;
  onEditorReady: (editor: Editor | null) => void;
  onAiCommand?: () => void;
  onDiffSegmentClick?: (segmentId: string) => void;
  onNewParaCreated?: (paraId: string, sectionFileName: string) => void;
  getHwpxDocumentModel?: () => HwpxDocumentModel | null;
};

function resolveSelectedSegmentId(editor: Editor): string | null {
  const parentAttrs = editor.state.selection.$from.parent.attrs as { segmentId?: string };
  return parentAttrs.segmentId || null;
}

export function DocumentEditor({
  content,
  editable = true,
  formMode = false,
  onUpdateDoc,
  onSelectionChange,
  onEditorReady,
  onAiCommand,
  onDiffSegmentClick,
  onNewParaCreated,
  getHwpxDocumentModel,
}: DocumentEditorProps) {
  const isLocalUpdateRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions({ onAiCommand, onNewParaCreated, getHwpxDocumentModel }),
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    onUpdate: ({ editor: tiptapEditor }) => {
      isLocalUpdateRef.current = true;
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
    if (isLocalUpdateRef.current) {
      isLocalUpdateRef.current = false;
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
    <div
      className={`document-editor-wrap ${formMode ? "form-mode-active" : ""}`}
      onClick={(e) => {
        if (!onDiffSegmentClick) return;
        const target = (e.target as HTMLElement).closest("[data-diff-segment]");
        if (!target) return;
        const segmentId = target.getAttribute("data-diff-segment");
        if (segmentId) {
          onDiffSegmentClick(segmentId);
        }
      }}
    >
      <EditorBubbleMenu editor={editor} />
      <EditorContent editor={editor} className="document-editor" />
    </div>
  );
}
