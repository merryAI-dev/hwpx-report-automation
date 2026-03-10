"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceTemplateSummary } from "@/lib/workspace-types";
import styles from "../workspace.module.css";

function badgeClass(status: WorkspaceTemplateSummary["status"]): string {
  if (status === "approved") return `${styles.badge} ${styles.badgeApproved}`;
  if (status === "deprecated") return `${styles.badge} ${styles.badgeDeprecated}`;
  return `${styles.badge} ${styles.badgeDraft}`;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<WorkspaceTemplateSummary[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState("report");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadTemplates = useCallback(async (q: string) => {
    setLoading(true);
    setError("");
    try {
      const search = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const response = await fetch(`/api/templates${search}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { templates?: WorkspaceTemplateSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "템플릿 목록을 불러오지 못했습니다.");
      }
      setTemplates(payload.templates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "템플릿 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates("");
  }, [loadTemplates]);

  const stats = useMemo(() => ({
    approved: templates.filter((row) => row.status === "approved").length,
    draft: templates.filter((row) => row.status === "draft").length,
    blocking: templates.reduce((sum, row) => sum + row.blockingIssueCount, 0),
  }), [templates]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("업로드할 HWPX 템플릿 파일을 선택하세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim() || file.name.replace(/\.hwpx$/i, ""));
      formData.append("documentType", documentType);
      const response = await fetch("/api/templates", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as { template?: { id: string }; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "템플릿 업로드 실패");
      }
      setSuccess("템플릿을 등록했습니다.");
      setName("");
      setFile(null);
      await loadTemplates(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "템플릿 업로드 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.kicker}>Template Catalog</div>
            <h1 className={styles.title}>템플릿함</h1>
            <p className={styles.subtitle}>메타태그 카탈로그, 승인 상태, 버전 비교를 운영하는 템플릿 워크스페이스입니다.</p>
          </div>
          <div className={styles.nav}>
            <Link className={styles.navLink} href="/documents">문서함</Link>
            <Link className={styles.primaryLink} href="/">편집기로 돌아가기</Link>
          </div>
        </header>

        <section className={styles.cards}>
          <div className={styles.card}><div className={styles.muted}>승인됨</div><div className={styles.cardTitle}>{stats.approved}</div></div>
          <div className={styles.card}><div className={styles.muted}>초안</div><div className={styles.cardTitle}>{stats.draft}</div></div>
          <div className={styles.card}><div className={styles.muted}>차단 이슈</div><div className={styles.cardTitle}>{stats.blocking}</div></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.row}><h2 className={styles.cardTitle}>새 템플릿 등록</h2></div>
          <form className={styles.form} onSubmit={onSubmit}>
            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>템플릿 이름</label>
                <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 주간 보고서 템플릿" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>문서 유형</label>
                <input className={styles.input} value={documentType} onChange={(event) => setDocumentType(event.target.value)} placeholder="report" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>파일</label>
                <input className={styles.input} type="file" accept=".hwpx" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              </div>
            </div>
            {error ? <div className={styles.error}>{error}</div> : null}
            {success ? <div className={styles.success}>{success}</div> : null}
            <div className={styles.nav}>
              <button type="submit" className={styles.primaryButton} disabled={submitting}>{submitting ? "등록 중..." : "템플릿 등록"}</button>
              <button type="button" className={styles.secondaryButton} onClick={() => void loadTemplates(query)}>목록 새로고침</button>
            </div>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.row}>
            <form className={styles.formRow} onSubmit={(event) => { event.preventDefault(); void loadTemplates(query); }} style={{ flex: 1 }}>
              <input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="템플릿 이름 또는 문서 유형 검색" />
            </form>
          </div>
          {loading ? <div className={styles.empty}>템플릿 목록을 불러오는 중입니다.</div> : null}
          {!loading && !templates.length ? <div className={styles.empty}>등록된 템플릿이 없습니다.</div> : null}
          {!loading && templates.length ? (
            <div className={styles.cards}>
              {templates.map((template) => (
                <article key={template.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.cardTitle}>{template.name}</div>
                      <div className={styles.muted}>{template.documentType} · v{template.currentVersionNumber}</div>
                    </div>
                    <span className={badgeClass(template.status)}>{template.status}</span>
                  </div>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>필드 {template.fieldCount}</span>
                    <span className={styles.badge}>이슈 {template.issueCount}</span>
                    <span className={styles.badge}>차단 {template.blockingIssueCount}</span>
                  </div>
                  <div className={styles.muted}>업데이트 {new Date(template.updatedAt).toLocaleString("ko-KR")}</div>
                  <div className={styles.nav}>
                    <Link className={styles.navLink} href={`/templates/${template.id}`}>세부정보</Link>
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
