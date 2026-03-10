"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WorkspaceDocumentSummary, WorkspaceTemplateSummary } from "@/lib/workspace-types";
import type { TenantQuotaSummary } from "@/lib/server/quota-store";
import styles from "./page.module.css";

type RecentJob = {
  id: string;
  status: string;
  instruction: string;
  totalItems: number;
  completedItems: number;
  createdAt: string;
};

type DashboardSummary = {
  documentCount: number;
  templateCount: number;
  approvedTemplateCount: number;
  activeJobCount: number;
  completedJobCount: number;
  quota: TenantQuotaSummary;
  recentDocuments: WorkspaceDocumentSummary[];
  recentTemplates: WorkspaceTemplateSummary[];
  recentJobs: RecentJob[];
};

type SessionUser = {
  sub: string;
  email: string;
  displayName: string;
};

type SessionData = {
  authenticated: boolean;
  user?: SessionUser;
  activeTenant?: { tenantId: string; tenantName: string; role: string };
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function getTodayString(): string {
  return new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function DocStatusBadge({ status }: { status: WorkspaceDocumentSummary["status"] }) {
  const classMap: Record<string, string> = {
    draft: styles.badgeDraft,
    ready: styles.badgeReady,
    archived: styles.badgeArchived,
  };
  return (
    <span className={`${styles.badge} ${classMap[status] ?? styles.badgeDraft}`}>
      {status}
    </span>
  );
}

function TemplateStatusBadge({ status }: { status: WorkspaceTemplateSummary["status"] }) {
  const classMap: Record<string, string> = {
    approved: styles.badgeApproved,
    draft: styles.badgeDraft,
    deprecated: styles.badgeDeprecated,
  };
  return (
    <span className={`${styles.badge} ${classMap[status] ?? styles.badgeDraft}`}>
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [dashRes, sessRes] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/auth/session", { cache: "no-store" }),
      ]);

      const dashPayload = (await dashRes.json().catch(() => ({}))) as { summary?: DashboardSummary; error?: string };
      const sessPayload = (await sessRes.json().catch(() => ({}))) as SessionData;

      if (!dashRes.ok) {
        throw new Error(dashPayload.error || "대시보드 데이터를 불러오지 못했습니다.");
      }

      if (dashPayload.summary) {
        setSummary(dashPayload.summary);
      }
      setSession(sessPayload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "대시보드를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();

    // Poll every 5 seconds for active job updates
    intervalRef.current = setInterval(() => {
      void loadDashboard();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [loadDashboard]);

  const displayName = session?.user?.displayName || session?.user?.email || "사용자";
  const tenantName = session?.activeTenant?.tenantName || "";

  const quotaPercent = summary
    ? Math.min(100, Math.round((summary.quota.blobBytes / summary.quota.maxBlobBytes) * 100))
    : 0;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <span>대시보드를 불러오는 중...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div>{error}</div>
          <Link href="/" className={styles.navLink}>편집기로 돌아가기</Link>
        </div>
      </div>
    );
  }

  const approvedTemplates = summary?.recentTemplates.filter((t) => t.status === "approved") ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* ── 1. 웰컴 헤더 ── */}
        <div className={styles.welcomeHeader}>
          <div className={styles.welcomeBlock}>
            <div className={styles.kicker}>대시보드</div>
            <h1 className={styles.welcomeTitle}>안녕하세요, {displayName}님</h1>
            <div className={styles.welcomeMeta}>
              <span>{getTodayString()}</span>
              {tenantName ? <span>· {tenantName}</span> : null}
            </div>
          </div>
          <div className={styles.welcomeNav}>
            <Link className={styles.navLink} href="/">편집기</Link>
            <Link className={styles.navLink} href="/documents">문서함</Link>
            <Link className={styles.navLink} href="/templates">템플릿함</Link>
          </div>
        </div>

        {/* ── 2. KPI 카드 ── */}
        <div className={styles.kpiGrid}>
          <Link href="/documents" className={styles.kpiCard}>
            <div className={styles.kpiIcon}>📄</div>
            <div className={styles.kpiLabel}>문서</div>
            <div className={styles.kpiValue}>{summary?.documentCount ?? 0}</div>
            <div className={styles.kpiSub}>개</div>
          </Link>
          <Link href="/templates" className={styles.kpiCard}>
            <div className={styles.kpiIcon}>📋</div>
            <div className={styles.kpiLabel}>템플릿</div>
            <div className={styles.kpiValue}>{summary?.templateCount ?? 0}</div>
            <div className={styles.kpiSub}>승인됨 {summary?.approvedTemplateCount ?? 0}개</div>
          </Link>
          <Link href="/batch/jobs" className={styles.kpiCard}>
            <div className={styles.kpiIcon}>⚙️</div>
            <div className={styles.kpiLabel}>배치 작업</div>
            <div className={styles.kpiValue}>{summary?.activeJobCount ?? 0}</div>
            <div className={styles.kpiSub}>진행 중 · 완료 {summary?.completedJobCount ?? 0}개</div>
          </Link>
          <div className={styles.kpiCard} style={{ cursor: "default" }}>
            <div className={styles.kpiIcon}>💾</div>
            <div className={styles.kpiLabel}>저장 공간</div>
            <div className={styles.kpiValue} style={{ fontSize: 18 }}>
              {summary ? formatBytes(summary.quota.blobBytes) : "—"}
            </div>
            <div className={styles.quotaBar}>
              <div className={styles.quotaFill} style={{ width: `${quotaPercent}%` }} />
            </div>
            <div className={styles.kpiSub}>
              / {summary ? formatBytes(summary.quota.maxBlobBytes) : "—"}
            </div>
          </div>
        </div>

        {/* ── 3. 빠른 실행 ── */}
        <div>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>빠른 실행</h2>
          </div>
          <div className={styles.quickActionsRow} style={{ marginTop: 12 }}>
            <Link href="/" className={styles.quickActionBtn}>
              <span className={styles.quickActionIcon}>✏️</span>
              새 문서
            </Link>
            <Link href="/templates" className={styles.quickActionBtn}>
              <span className={styles.quickActionIcon}>📤</span>
              템플릿 업로드
            </Link>
            <Link href="/batch/jobs" className={styles.quickActionBtn}>
              <span className={styles.quickActionIcon}>⚡</span>
              배치 작업
            </Link>
            <button type="button" className={styles.quickActionBtn} disabled>
              <span className={styles.quickActionIcon}>🔍</span>
              문서 검색
              <span style={{ fontSize: 10, color: "#94a3b8" }}>(준비 중)</span>
            </button>
          </div>
        </div>

        {/* ── 4. 최근 문서 ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>최근 문서</h2>
            <Link href="/documents" className={styles.viewAllLink}>전체보기 →</Link>
          </div>
          {!summary?.recentDocuments.length ? (
            <div className={styles.empty}>저장된 문서가 없습니다.</div>
          ) : (
            <div className={styles.docGrid}>
              {summary.recentDocuments.map((doc) => (
                <Link key={doc.id} href={`/documents/${doc.id}`} className={styles.docCard}>
                  <div className={styles.docTitle}>{doc.title}</div>
                  <DocStatusBadge status={doc.status} />
                  <div className={styles.docMeta}>{formatDate(doc.updatedAt)}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ── 5. 최근 배치 작업 ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>최근 배치 작업</h2>
            <Link href="/batch/jobs" className={styles.viewAllLink}>전체보기 →</Link>
          </div>
          {!summary?.recentJobs.length ? (
            <div className={styles.empty}>실행된 배치 작업이 없습니다.</div>
          ) : (
            <div className={styles.jobList}>
              {summary.recentJobs.map((job) => {
                const pct = job.totalItems > 0
                  ? Math.round((job.completedItems / job.totalItems) * 100)
                  : 0;
                return (
                  <div key={job.id} className={styles.jobCard}>
                    <div className={styles.jobHeader}>
                      <div className={styles.jobInstruction}>{job.instruction || "(지시 없음)"}</div>
                      <span className={styles.jobStatus} data-status={job.status}>{job.status}</span>
                    </div>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                    </div>
                    <div className={styles.jobMeta}>
                      {job.completedItems} / {job.totalItems}개 완료 · {formatDate(job.createdAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 6. 승인된 템플릿 ── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>승인된 템플릿</h2>
            <Link href="/templates" className={styles.viewAllLink}>전체보기 →</Link>
          </div>
          {!approvedTemplates.length ? (
            <div className={styles.empty}>승인된 템플릿이 없습니다.</div>
          ) : (
            <div className={styles.templateList}>
              {approvedTemplates.map((template) => (
                <div key={template.id} className={styles.templateCard}>
                  <div className={styles.templateInfo}>
                    <div className={styles.templateName}>{template.name}</div>
                    <div className={styles.templateMeta}>
                      {template.documentType} · v{template.currentVersionNumber} · 필드 {template.fieldCount}개
                    </div>
                    <TemplateStatusBadge status={template.status} />
                  </div>
                  <Link
                    href={`/generate?templateId=${encodeURIComponent(template.id)}`}
                    className={styles.generateBtn}
                  >
                    문서 생성
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
