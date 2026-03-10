"use client";

import { useEffect, useState, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import styles from "./InlineAiPopup.module.css";

type InlineAiPopupProps = {
  editor: Editor | null;
  onAction: (action: string, selectedText: string) => void;
};

type PopupPosition = {
  top: number;
  left: number;
};

const ACTIONS = [
  { id: "다듬기", label: "✨ 다듬기" },
  { id: "요약", label: "📝 요약" },
  { id: "번역", label: "🔄 번역" },
  { id: "확장", label: "💡 확장" },
] as const;

export function InlineAiPopup({ editor, onAction }: InlineAiPopupProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<PopupPosition>({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState("");

  const updatePopup = useCallback(() => {
    if (!editor) {
      setVisible(false);
      return;
    }

    const { from, to } = editor.state.selection;
    if (from === to) {
      setVisible(false);
      return;
    }

    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) {
      setVisible(false);
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      setVisible(false);
      return;
    }

    const range = domSelection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!rect.width && !rect.height) {
      setVisible(false);
      return;
    }

    const POPUP_HEIGHT = 40;
    const POPUP_MARGIN = 6;

    setSelectedText(text);
    setPosition({
      top: rect.top + window.scrollY - POPUP_HEIGHT - POPUP_MARGIN,
      left: rect.left + window.scrollX + rect.width / 2,
    });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    editor.on("selectionUpdate", updatePopup);
    editor.on("blur", () => setVisible(false));

    return () => {
      editor.off("selectionUpdate", updatePopup);
      editor.off("blur", () => setVisible(false));
    };
  }, [editor, updatePopup]);

  if (!visible) return null;

  return (
    <div
      className={styles.popup}
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className={styles.actionBtn}
          onClick={() => {
            onAction(action.id, selectedText);
            setVisible(false);
          }}
          title={action.label}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
