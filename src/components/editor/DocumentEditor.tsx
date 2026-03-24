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
  const lastLocalContentRef = useRef<JSONContent | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions({ onAiCommand, onNewParaCreated, getHwpxDocumentModel }),
    content: content || { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    onUpdate: ({ editor: tiptapEditor }) => {
      const doc = tiptapEditor.getJSON();
      lastLocalContentRef.current = doc;
      onUpdateDoc(doc);
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

  // content 참조가 바뀔 때만 setContent — 최초 마운트 및 로컬 편집 에코 제외
  const prevContentRef = useRef<JSONContent | null>(null);
  const initialContentRef = useRef<JSONContent | null>(content);
  useEffect(() => {
    if (!editor || !content) {
      return;
    }
    // 최초 마운트 시 skip: useEditor 초기값으로 이미 설정됨
    if (prevContentRef.current === null) {
      prevContentRef.current = content;
      return;
    }
    // 참조 동일성 체크: store에서 같은 객체이면 skip (O(1))
    if (prevContentRef.current === content) {
      return;
    }
    // 로컬 편집 에코 skip: 방금 editor에서 내보낸 동일 JSON이면 무시
    if (lastLocalContentRef.current === content) {
      prevContentRef.current = content;
      lastLocalContentRef.current = null;
      return;
    }
    prevContentRef.current = content;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);
  void initialContentRef; // suppress unused variable warning

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
