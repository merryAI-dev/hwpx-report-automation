"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import styles from "./StyleModal.module.css";

const HWP_FONTS = [
  "바탕", "바탕체", "궁서", "궁서체", "굴림", "굴림체", "돋움", "돋움체",
  "맑은 고딕", "나눔고딕", "나눔명조", "Arial", "Times New Roman",
];

const FONT_SIZES = [7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 72];

type CharStyleState = {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  textColor: string;
  bgColor: string;
};

function readCurrentCharStyle(editor: Editor): CharStyleState {
  const tsAttrs = editor.getAttributes("textStyle") as {
    fontFamily?: string;
    fontSize?: string;
    color?: string;
  };
  const sizePx = Number.parseInt(tsAttrs.fontSize ?? "0", 10);
  return {
    fontFamily: tsAttrs.fontFamily || "바탕",
    fontSize: sizePx > 0 ? sizePx : 10,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strikethrough: editor.isActive("strike"),
    textColor: tsAttrs.color || "#000000",
    bgColor: "#ffffff",
  };
}

type CharStyleModalProps = {
  editor: Editor;
  onClose: () => void;
};

export function CharStyleModal({ editor, onClose }: CharStyleModalProps) {
  const [state, setState] = useState<CharStyleState>(() => readCurrentCharStyle(editor));

  const update = <K extends keyof CharStyleState>(key: K, value: CharStyleState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const onApply = () => {
    const chain = editor.chain().focus();

    // Font
    chain.setFontFamily(state.fontFamily);
    chain.setMark("textStyle", { fontSize: `${state.fontSize}pt` });

    // Bold / Italic / Underline / Strike
    if (state.bold) chain.setBold(); else chain.unsetBold();
    if (state.italic) chain.setItalic(); else chain.unsetItalic();
    if (state.underline) chain.setUnderline(); else chain.unsetUnderline();
    if (state.strikethrough) chain.setStrike(); else chain.unsetStrike();

    // Text color
    if (state.textColor && state.textColor !== "#000000") {
      chain.setColor(state.textColor);
    } else {
      chain.unsetColor();
    }

    // Background (highlight) color
    if (state.bgColor && state.bgColor !== "#ffffff") {
      chain.setHighlight({ color: state.bgColor });
    } else {
      chain.unsetHighlight();
    }

    chain.run();
    onClose();
  };

  const preview: React.CSSProperties = {
    fontFamily: state.fontFamily,
    fontSize: `${state.fontSize}pt`,
    fontWeight: state.bold ? "bold" : "normal",
    fontStyle: state.italic ? "italic" : "normal",
    textDecoration: [
      state.underline ? "underline" : "",
      state.strikethrough ? "line-through" : "",
    ]
      .filter(Boolean)
      .join(" ") || "none",
    color: state.textColor,
    backgroundColor: state.bgColor,
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.titleBar}>
          <span>글자 모양</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {/* ── 기본 설정 ── */}
          <fieldset className={styles.fieldset}>
            <legend>글꼴</legend>
            <div className={styles.grid2}>
              <label className={styles.numField}>
                <span className={styles.numLabel}>글꼴</span>
                <select
                  className={styles.select}
                  value={state.fontFamily}
                  onChange={(e) => update("fontFamily", e.target.value)}
                >
                  {HWP_FONTS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.numField}>
                <span className={styles.numLabel}>크기 (pt)</span>
                <select
                  className={styles.select}
                  value={state.fontSize}
                  onChange={(e) => update("fontSize", Number(e.target.value))}
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          {/* ── 속성 ── */}
          <fieldset className={styles.fieldset}>
            <legend>속성</legend>
            <div className={styles.checkRow}>
              <CheckBox label="굵게" checked={state.bold} onChange={(v) => update("bold", v)} />
              <CheckBox label="기울임" checked={state.italic} onChange={(v) => update("italic", v)} />
              <CheckBox label="밑줄" checked={state.underline} onChange={(v) => update("underline", v)} />
              <CheckBox label="취소선" checked={state.strikethrough} onChange={(v) => update("strikethrough", v)} />
            </div>
          </fieldset>

          {/* ── 색상 ── */}
          <fieldset className={styles.fieldset}>
            <legend>색상</legend>
            <div className={styles.colorRow}>
              <label className={styles.colorField}>
                <span>글자 색</span>
                <input
                  type="color"
                  value={state.textColor}
                  onChange={(e) => update("textColor", e.target.value)}
                />
              </label>
              <label className={styles.colorField}>
                <span>배경 색</span>
                <input
                  type="color"
                  value={state.bgColor}
                  onChange={(e) => update("bgColor", e.target.value)}
                />
              </label>
            </div>
          </fieldset>

          {/* ── 미리보기 ── */}
          <fieldset className={styles.fieldset}>
            <legend>미리보기</legend>
            <div className={styles.preview} style={preview}>
              가나다 AaBbCc 123 한글 영문
            </div>
          </fieldset>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.applyBtn} onClick={onApply}>설정</button>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

function CheckBox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.checkLabel}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
