"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "편집기" },
  { href: "/report-family/wizard", label: "보고서 생성" },
  { href: "/documents", label: "문서 관리" },
  { href: "/dashboard", label: "대시보드" },
  { href: "/settings", label: "설정" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="border-b border-[var(--color-notion-border)] bg-[var(--color-notion-bg)]">
      <div className="flex h-11 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="mr-2 text-sm font-semibold tracking-tight text-[var(--color-notion-text)]"
          >
            HWPX Studio
          </Link>
          {/* Desktop nav */}
          <div className="hidden items-center gap-0.5 sm:flex">
            {NAV_ITEMS.map(({ href, label }) => {
              const isActive =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-[var(--color-notion-bg-hover)] text-[var(--color-notion-text)]"
                      : "text-[var(--color-notion-text-secondary)] hover:bg-[var(--color-notion-bg-hover)] hover:text-[var(--color-notion-text)]"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="rounded-md p-1 text-[var(--color-notion-text-secondary)] hover:bg-[var(--color-notion-bg-hover)] sm:hidden"
            aria-label="메뉴 열기"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-[var(--color-notion-border)] px-4 py-2 sm:hidden">
          {NAV_ITEMS.map(({ href, label }) => {
            const isActive =
              href === "/"
                ? pathname === "/"
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-[var(--color-notion-bg-hover)] text-[var(--color-notion-text)]"
                    : "text-[var(--color-notion-text-secondary)] hover:bg-[var(--color-notion-bg-hover)]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
