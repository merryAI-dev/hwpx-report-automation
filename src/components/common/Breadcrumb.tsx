"use client";

import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbProps = {
  items: BreadcrumbItem[];
};

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav aria-label="breadcrumb" className="mb-4 text-sm text-[var(--color-notion-text-secondary)]">
      <ol className="flex items-center gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-[var(--color-notion-text-tertiary)]">/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-[var(--color-notion-text)] hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="text-[var(--color-notion-text)]">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
