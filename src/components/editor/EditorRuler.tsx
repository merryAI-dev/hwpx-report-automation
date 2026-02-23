"use client";

import styles from "./EditorRuler.module.css";

/**
 * Horizontal ruler that matches the A4 paper width (794px content area).
 * Tick marks every 10mm; numbers at 20mm, 40mm, … in centimeters.
 * A4 printable width ≈ 180mm (with 15mm margins each side).
 */
const PAPER_WIDTH_MM = 190; // full printable span shown in ruler
const MM_PER_TICK = 5;
const PX_PER_MM = 794 / 210; // A4 = 210mm wide

export function EditorRuler() {
  const ticks: { mm: number; major: boolean }[] = [];
  for (let mm = 0; mm <= PAPER_WIDTH_MM; mm += MM_PER_TICK) {
    ticks.push({ mm, major: mm % 10 === 0 });
  }

  return (
    <div className={styles.rulerWrap}>
      <div className={styles.ruler}>
        {ticks.map(({ mm, major }) => (
          <span
            key={mm}
            className={major ? styles.tickMajor : styles.tickMinor}
            style={{ left: `${mm * PX_PER_MM}px` }}
          >
            {major && mm > 0 ? <span className={styles.label}>{mm / 10}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
