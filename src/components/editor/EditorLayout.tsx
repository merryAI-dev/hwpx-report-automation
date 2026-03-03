"use client";

import type { ReactNode } from "react";
import styles from "./EditorLayout.module.css";

type EditorLayoutProps = {
  children: ReactNode;
};

/**
 * Wraps the document editor in an HWP-like canvas:
 * gray background + centered A4 white paper with shadow.
 */
export function EditorLayout({ children }: EditorLayoutProps) {
  return (
    <div className={styles.canvas}>
      <div className={styles.paper}>{children}</div>
    </div>
  );
}
