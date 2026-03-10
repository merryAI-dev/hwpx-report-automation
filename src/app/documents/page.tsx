"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceDocumentSummary } from "@/lib/workspace-types";
import type { TenantQuotaSummary } from "@/lib/server/quota-store";
import styles from "../workspace.module.css";

function badgeClass(status: WorkspaceDocumentSummary["status"]): string {
  if (status === "ready") return `${styles.badge} ${styles.badgeReady}`;
  if (status === "archived") return `${styles.badge} ${styles.badgeArchived}`;
  return `${styles.badge} ${styles.badgeDraft}`;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<TenantQuotaSummary | null>(null);

  const loadDocuments = useCallback(async (q: string) => {
    setLoading(true);
    setError("");
    try {
      const search = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const response = await fetch(`/api/documents${search}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { documents?: WorkspaceDocumentSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "문서 목록을 불러오지 못했습니다.");
      }
      setDocuments(payload.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문서 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQuota = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/quota", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { quota?: TenantQuotaSummary; error?: string };
      if (response.ok) {
        setQuota(payload.quota || null);
      }
    } catch {
      // quota fetch failure is non-blocking
    }
  }, []);

  useEffect(() => {
    void loadDocuments("");
    void loadQuota();
  }, [loadDocuments, loadQuota]);

  const totals = useMemo(() => ({
    draft: documents.filter((row) => row.status === "draft").length,
    ready: documents.filter((row) => row.status === "ready").length,
    archived: documents.filter((row) => row.status === "archived").length,
  }), [documents]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.kicker}>Document Workspace</div>
            <h1 className={styles.title}>문서함</h1>
            <p className={styles.subtitle}>
              테넌트 문서를 저장, 재오픈, 버전 추적할 수 있는 워크스페이스입니다. 현재 문서에서 저장하면 여기로 영속화됩니다.
            </p>
          </div>
          <div className={styles.nav}>
            <Link className={styles.navLink} href="/templates">템플릿함</Link>
            <Link className={styles.navLink} href="/batch">배치 생성</Link>
            <Link className={styles.primaryLink} href="/">새 문서 열기</Link>
          </div>
        </header>

        {quota ? (
          <section className={styles.panel}>
            <div className={styles.row}>
              <h2 className={styles.cardTitle}>할당량</h2>
              <span className={styles.muted}>
                문서 {quota.documentCount} / {quota.maxDocuments}개 사용됨
              </span>
            </div>
            <div style={{ background: "#e5e7eb", borderRadius: "4px", height: "8px", overflow: "hidden", marginTop: "0.5rem" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (quota.documentCount / quota.maxDocuments) * 100)}%`,
                  background: quota.documentsOverLimit ? "#ef4444" : "#3b82f6",
                  borderRadius: "4px",
                  transition: "width 0.3s",
                }}
              />
            </div>
            {quota.documentsOverLimit ? (
              <div className={styles.error}>문서 할당량 초과: 새 문서를 저장할 수 없습니다.</div>
            ) : null}
          </section>
        ) : null}

        <section className={styles.cards}>
          <div className={styles.card}>
            <div className={styles.muted}>초안</div>
            <div className={styles.cardTitle}>{totals.draft}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.muted}>Ready</div>
            <div className={styles.cardTitle}>{totals.ready}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.muted}>보관</div>
            <div className={styles.cardTitle}>{totals.archived}</div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.row}>
            <form
              className={styles.formRow}
              onSubmit={(event) => {
                event.preventDefault();
                void loadDocuments(query);
              }}
              style={{ flex: 1 }}
            >
              <input
                className={styles.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="제목 또는 포맷으로 검색"
              />
            </form>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadDocuments(query)}>
              새로고침
            </button>
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
          {loading ? <div className={styles.empty}>문서 목록을 불러오는 중입니다.</div> : null}
          {!loading && !documents.length ? <div className={styles.empty}>저장된 문서가 없습니다.</div> : null}
          {!loading && documents.length ? (
            <div className={styles.cards}>
              {documents.map((document) => (
                <article key={document.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.cardTitle}>{document.title}</div>
                      <div className={styles.muted}>{document.sourceFormat.toUpperCase()} · v{document.currentVersionNumber}</div>
                    </div>
                    <span className={badgeClass(document.status)}>{document.status}</span>
                  </div>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>필드 {document.templateFieldCount}</span>
                    <span className={styles.badge}>경고 {document.validationSummary?.warningCount || 0}</span>
                    <span className={styles.badge}>차단 {document.validationSummary?.blockingCount || 0}</span>
                  </div>
                  <div className={styles.muted}>
                    업데이트 {new Date(document.updatedAt).toLocaleString("ko-KR")} · {document.updatedByDisplayName}
                  </div>
                  <div className={styles.nav}>
                    <Link className={styles.primaryLink} href={`/?documentId=${document.id}`}>편집 열기</Link>
                    <Link className={styles.navLink} href={`/documents/${document.id}`}>세부정보</Link>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
