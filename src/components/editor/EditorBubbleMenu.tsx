"use client";

/**
 * Tiptap v3 BubbleMenu implementation.
 *
 * v2에서는 @tiptap/react가 React 컴포넌트로 BubbleMenu를 제공했지만,
 * v3에서는 제거됨. v3 방식:
 *   1. 실제 DOM 엘리먼트를 imperative하게 생성
 *   2. BubbleMenuPlugin(Floating UI 기반)에 해당 엘리먼트 전달 → show/hide/position 위임
 *   3. createPortal로 React 콘텐츠를 해당 DOM 엘리먼트 안에 렌더
 */

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { BubbleMenuPlugin } from "@tiptap/extension-bubble-menu";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import styles from "./EditorBubbleMenu.module.css";

const BUBBLE_MENU_KEY = new PluginKey("editorBubbleMenu");

type EditorBubbleMenuProps = {
  editor: Editor | null;
};

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  // 실제 DOM 엘리먼트 (Plugin이 소유 → Floating UI로 위치 계산)
  const portalNode = useMemo(() => {
    if (typeof document === "undefined") {
      return null;
    }
    const el = document.createElement("div");
    el.style.zIndex = "50";
    return el;
  }, []);

  // 1단계: 컴포넌트 마운트 시 DOM 엘리먼트 생성
  useEffect(() => {
    if (!portalNode) return;
    document.body.appendChild(portalNode);

    return () => {
      if (portalNode.parentNode) {
        portalNode.parentNode.removeChild(portalNode);
      }
    };
  }, [portalNode]);

  // 2단계: 에디터와 DOM 엘리먼트가 모두 준비되면 Plugin 등록
  useEffect(() => {
    if (!editor || !portalNode) return;

    const plugin = BubbleMenuPlugin({
      pluginKey: BUBBLE_MENU_KEY,
      editor,
      element: portalNode,
      shouldShow: ({ state }) => {
        const { from, to } = state.selection;
        // 텍스트 선택이 있을 때만 표시
        return from !== to;
      },
      options: {
        placement: "top",
        offset: 8,
        flip: true,
        shift: true,
      },
    });

    editor.registerPlugin(plugin);

    return () => {
      editor.unregisterPlugin(BUBBLE_MENU_KEY);
    };
  }, [editor, portalNode]);

  // 3단계: createPortal로 React 트리를 DOM 엘리먼트 안에 렌더
  if (!portalNode || !editor) return null;

  return createPortal(
    <div className={styles.bubbleMenu}>
      {([1, 2, 3, 4] as const).map((level) => (
        <button
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          className={editor.isActive("heading", { level }) ? styles.active : ""}
        >
          H{level}
        </button>
      ))}
      <button
        onClick={() => editor.chain().focus().setParagraph().run()}
        className={editor.isActive("paragraph") ? styles.active : ""}
      >
        P
      </button>
      <div className={styles.divider} />
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive("bold") ? styles.active : ""}
      >
        <b>B</b>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive("italic") ? styles.active : ""}
      >
        <i>I</i>
      </button>
    </div>,
    portalNode,
  );
}
