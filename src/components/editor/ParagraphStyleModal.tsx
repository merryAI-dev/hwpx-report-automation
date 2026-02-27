"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import styles from "./StyleModal.module.css";

type ParagraphStyleModalProps = {
  editor: Editor;
  onClose: () => void;
};

type ParagraphStyleState = {
  align: "left" | "center" | "right" | "justify";
  leftIndent: number;   // mm
  rightIndent: number;  // mm
  firstLine: number;    // mm (positive = indent, negative = outdent)
  lineHeight: number;   // % (e.g. 160)
  spaceBefore: number;  // pt
  spaceAfter: number;   // pt
};

/** 1 HWPUNIT = 25.4/7200 mm */
const HWPUNIT_PER_MM = 7200 / 25.4;
/** 1 pt = 100 HWPUNIT */
const HWPUNIT_PER_PT = 100;

/** Read current paragraph attrs from editor selection */
function readCurrentParaStyle(editor: Editor): ParagraphStyleState {
  const attrs = editor.getAttributes("paragraph") as {
    hwpxAlign?: string | null;
    hwpxLineSpacing?: number | null;
    hwpxLeftIndent?: number | null;
    hwpxRightIndent?: number | null;
    hwpxFirstLineIndent?: number | null;
    hwpxSpaceBefore?: number | null;
    hwpxSpaceAfter?: number | null;
    textAlign?: string | null;
  };

  // Convert HWPUNIT → display units, round to 1 decimal
  const toMm = (v: number | null | undefined) =>
    v ? Math.round((v / HWPUNIT_PER_MM) * 10) / 10 : 0;
  const toPt = (v: number | null | undefined) =>
    v ? Math.round((v / HWPUNIT_PER_PT) * 10) / 10 : 0;

  const rawAlign = attrs.hwpxAlign?.toLowerCase() ?? attrs.textAlign ?? "left";
  const align = (["left", "center", "right", "justify"].includes(rawAlign)
    ? rawAlign
    : "left") as ParagraphStyleState["align"];

  return {
    align,
    leftIndent: toMm(attrs.hwpxLeftIndent),
    rightIndent: toMm(attrs.hwpxRightIndent),
    firstLine: toMm(attrs.hwpxFirstLineIndent),
    lineHeight: attrs.hwpxLineSpacing ?? 160,
    spaceBefore: toPt(attrs.hwpxSpaceBefore),
    spaceAfter: toPt(attrs.hwpxSpaceAfter),
  };
}

export function ParagraphStyleModal({ editor, onClose }: ParagraphStyleModalProps) {
  const [state, setState] = useState<ParagraphStyleState>(() => readCurrentParaStyle(editor));

  const update = <K extends keyof ParagraphStyleState>(key: K, value: ParagraphStyleState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const onApply = () => {
    // Convert display units → HWPUNIT
    const mmToHwpunit = (mm: number) => Math.round(mm * HWPUNIT_PER_MM);
    const ptToHwpunit = (pt: number) => Math.round(pt * HWPUNIT_PER_PT);

    const chain = editor.chain().focus();

    // Text alignment (TipTap textAlign for visual rendering)
    chain.setTextAlign(state.align);

    // HWPX paraPr attrs for roundtrip export
    chain.updateAttributes("paragraph", {
      hwpxAlign: state.align.toUpperCase(),
      hwpxLineSpacing: state.lineHeight,
      hwpxLeftIndent: mmToHwpunit(state.leftIndent),
      hwpxRightIndent: mmToHwpunit(state.rightIndent),
      hwpxFirstLineIndent: mmToHwpunit(state.firstLine),
      hwpxSpaceBefore: ptToHwpunit(state.spaceBefore),
      hwpxSpaceAfter: ptToHwpunit(state.spaceAfter),
    });

    chain.run();
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.titleBar}>
          <span>문단 모양</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {/* ── 정렬 ── */}
          <fieldset className={styles.fieldset}>
            <legend>정렬</legend>
            <div className={styles.row}>
              {(["left", "center", "right", "justify"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={state.align === a ? `${styles.alignBtn} ${styles.alignBtnActive}` : styles.alignBtn}
                  onClick={() => update("align", a)}
                >
                  {{
                    left: "왼쪽",
                    center: "가운데",
                    right: "오른쪽",
                    justify: "양쪽",
                  }[a]}
                </button>
              ))}
            </div>
          </fieldset>

          {/* ── 여백 ── */}
          <fieldset className={styles.fieldset}>
            <legend>여백</legend>
            <div className={styles.grid2}>
              <NumField label="왼쪽 (mm)" value={state.leftIndent} step={1} min={0} max={150} onChange={(v) => update("leftIndent", v)} />
              <NumField label="오른쪽 (mm)" value={state.rightIndent} step={1} min={0} max={150} onChange={(v) => update("rightIndent", v)} />
              <NumField label="첫 줄 들여쓰기 (mm)" value={state.firstLine} step={1} min={-50} max={50} onChange={(v) => update("firstLine", v)} />
            </div>
          </fieldset>

          {/* ── 간격 ── */}
          <fieldset className={styles.fieldset}>
            <legend>간격</legend>
            <div className={styles.grid2}>
              <NumField label="줄 간격 (%)" value={state.lineHeight} step={5} min={80} max={300} onChange={(v) => update("lineHeight", v)} />
              <NumField label="문단 위 간격 (pt)" value={state.spaceBefore} step={1} min={0} max={100} onChange={(v) => update("spaceBefore", v)} />
              <NumField label="문단 아래 간격 (pt)" value={state.spaceAfter} step={1} min={0} max={100} onChange={(v) => update("spaceAfter", v)} />
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

function NumField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className={styles.numField}>
      <span className={styles.numLabel}>{label}</span>
      <input
        type="number"
        className={styles.numInput}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
