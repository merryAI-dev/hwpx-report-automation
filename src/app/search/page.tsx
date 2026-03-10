"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResponse, SearchResult, SearchResultType } from "@/lib/server/search-store";
import styles from "./page.module.css";

type FilterType = "all" | SearchResultType;

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return "방금 전";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}

function statusBadgeClass(status: string): string {
  if (status === "draft") return `${styles.statusBadge} ${styles.statusBadgeDraft}`;
  if (status === "ready" || status === "approved") return `${styles.statusBadge} ${styles.statusBadgeReady}`;
  if (status === "archived" || status === "deprecated") return `${styles.statusBadge} ${styles.statusBadgeArchived}`;
  return styles.statusBadge;
}

function ResultCard({ result }: { result: SearchResult }) {
  const href = result.type === "document" ? `/documents/${result.id}` : `/templates/${result.id}`;
  const icon = result.type === "document" ? "📄" : "📋";

  return (
    <Link href={href} className={styles.resultCard}>
      <div className={styles.resultHeader}>
        <span className={styles.typeIcon}>{icon}</span>
        <span className={styles.resultTitle}>{result.title}</span>
        <span className={statusBadgeClass(result.status)}>{result.status}</span>
      </div>
      <div className={styles.resultSubtitle}>{result.subtitle}</div>
      <div className={styles.resultFooter}>
        {result.highlight ? <span className={styles.highlight}>{result.highlight}</span> : null}
        <span className={styles.relativeTime}>{relativeTime(result.updatedAt)}</span>
      </div>
    </Link>
  );
}

function SkeletonList() {
  return (
    <div className={styles.skeleton}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonCard} />
      ))}
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>🔍</div>
      <div className={styles.emptyTitle}>"{query}"에 대한 결과가 없습니다</div>
      <div className={styles.emptyTips}>
        다른 키워드로 검색해보세요.<br />
        문서 제목, 상태, 형식 또는 템플릿 이름으로 검색할 수 있습니다.
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string, f: FilterType) => {
    if (!q.trim()) {
      setResponse(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const typeParam = f === "all" ? "all" : f;
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${typeParam}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { results?: SearchResponse; error?: string };
      if (res.ok && data.results) {
        setResponse(data.results);
      } else {
        setResponse(null);
      }
    } catch {
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResponse(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void doSearch(value, filter);
    }, 300);
  };

  const onFilterChange = (f: FilterType) => {
    setFilter(f);
    if (query.trim()) {
      void doSearch(query, f);
    }
  };

  const filters: Array<{ value: FilterType; label: string }> = [
    { value: "all", label: "전체" },
    { value: "document", label: "문서" },
    { value: "template", label: "템플릿" },
  ];

  const hasResults = response && response.results.length > 0;
  const hasQuery = query.trim().length > 0;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <div className={styles.kicker}>Workspace Search</div>
            <h1 className={styles.title}>전체 검색</h1>
          </div>
          <Link href="/" className={styles.backLink}>← 편집기로</Link>
        </header>

        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            type="search"
            className={styles.searchInput}
            placeholder="문서 제목, 템플릿 이름으로 검색..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={styles.filterTabs}>
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              className={filter === f.value ? `${styles.filterTab} ${styles.filterTabActive}` : styles.filterTab}
              onClick={() => onFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {response && hasQuery && !loading ? (
          <div className={styles.meta}>
            {response.total}개 결과 · {response.durationMs}ms
          </div>
        ) : null}

        {loading ? <SkeletonList /> : null}

        {!loading && hasResults ? (
          <div className={styles.resultList}>
            {response.results.map((result) => (
              <ResultCard key={`${result.type}-${result.id}`} result={result} />
            ))}
          </div>
        ) : null}

        {!loading && hasQuery && response && !hasResults ? (
          <EmptyState query={query} />
        ) : null}

        {!loading && !hasQuery ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔍</div>
            <div className={styles.emptyTitle}>검색어를 입력하세요</div>
            <div className={styles.emptyTips}>
              문서 제목, 상태(draft/ready), 파일 형식(hwpx/docx),<br />
              템플릿 이름 또는 문서 유형으로 검색할 수 있습니다.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
