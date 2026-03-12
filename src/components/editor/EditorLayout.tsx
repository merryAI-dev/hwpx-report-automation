"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import styles from "./EditorLayout.module.css";

type EditorLayoutProps = {
  children: ReactNode;
};

function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = stored === "dark" || (!stored && prefersDark);
    setDark(initial);
    document.documentElement.classList.toggle("dark", initial);
  }, []);

  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  return { dark, toggle };
}

/**
 * Wraps the document editor in an HWP-like canvas:
 * gray background + centered A4 white paper with shadow.
 * Includes a dark mode toggle button.
 */
export function EditorLayout({ children }: EditorLayoutProps) {
  const { dark, toggle } = useDarkMode();

  return (
    <div className={styles.canvas}>
      <button
        className={styles.themeToggle}
        onClick={toggle}
        title={dark ? "라이트 모드로 전환" : "다크 모드로 전환"}
        aria-label={dark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      >
        {dark ? "☀️" : "🌙"}
      </button>
      <div className={styles.paper}>{children}</div>
    </div>
  );
}
