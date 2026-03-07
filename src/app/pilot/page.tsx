"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PILOT_METRICS_UPDATED_EVENT,
  readPilotMetricEvents,
  summarizePilotMetricEvents,
  writePilotMetricEvents,
  type PilotMetricEvent,
} from "@/lib/pilot-metrics";
import { PILOT_RUNBOOK } from "@/lib/pilot-runbook";
import styles from "./page.module.css";

type PilotServerJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  instruction: string;
  itemCount: number;
  totalChunks: number;
  completedChunks: number;
  resultCount: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
};

type PilotServerSummary = {
  generatedAt: number;
  stats: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
  jobs: PilotServerJob[];
};

const EVENT_LABELS: Record<PilotMetricEvent["type"], string> = {
  document_loaded: "문서 로드",
  manual_save_completed: "수동 저장",
  autosave_completed: "자동 저장",
  docx_export_completed: "DOCX 내보내기",
  pdf_export_completed: "PDF 내보내기",
  single_suggestion_generated: "단건 제안 생성",
  single_suggestion_applied: "단건 제안 적용",
  batch_job_created: "배치 작업 생성",
  batch_job_completed: "배치 작업 완료",
  batch_job_failed: "배치 작업 실패",
  batch_suggestion_applied: "배치 제안 적용",
  quality_gate_blocked: "품질 게이트 차단",
  quality_gate_approved: "품질 게이트 승인",
};

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function stringifyEventDetail(detail: PilotMetricEvent["detail"]): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== null && value !== "");
  if (!entries.length) {
    return "-";
  }
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" / ");
}

export default function PilotDashboardPage() {
  const [events, setEvents] = useState<PilotMetricEvent[]>([]);
  const [serverSummary, setServerSummary] = useState<PilotServerSummary | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(true);

  const syncLocalMetrics = useCallback(() => {
    setEvents(readPilotMetricEvents(window.localStorage));
  }, []);

  const refreshServerSummary = useCallback(async () => {
    try {
      const response = await fetch("/api/pilot/summary", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as PilotServerSummary & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "파일럿 요약 조회 실패");
      }
      setServerSummary(payload);
      setServerError(null);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "파일럿 요약 조회 실패");
    } finally {
      setServerLoading(false);
    }
  }, []);

  useEffect(() => {
    syncLocalMetrics();
    void refreshServerSummary();

    const handleMetricsUpdated = () => syncLocalMetrics();
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "hwpx-pilot-metrics-v1") {
        syncLocalMetrics();
      }
    };

    window.addEventListener(PILOT_METRICS_UPDATED_EVENT, handleMetricsUpdated);
    window.addEventListener("storage", handleStorage);
    const timer = window.setInterval(() => {
      void refreshServerSummary();
    }, 15_000);

    return () => {
      window.removeEventListener(PILOT_METRICS_UPDATED_EVENT, handleMetricsUpdated);
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(timer);
    };
  }, [refreshServerSummary, syncLocalMetrics]);

  const summary = useMemo(() => summarizePilotMetricEvents(events), [events]);

  const kpiCards = useMemo(
    () => [
      { label: "문서 로드", value: summary.documentsLoaded, hint: "로컬 브라우저 기준" },
      { label: "저장", value: summary.manualSaves + summary.autosaves, hint: `수동 ${summary.manualSaves} / 자동 ${summary.autosaves}` },
      { label: "내보내기", value: summary.pdfExports + summary.docxExports, hint: `PDF ${summary.pdfExports} / DOCX ${summary.docxExports}` },
      { label: "AI 적용", value: summary.singleSuggestionsApplied + summary.batchSuggestionsApplied, hint: `단건 ${summary.singleSuggestionsApplied} / 배치 ${summary.batchSuggestionsApplied}` },
      { label: "게이트 승인율", value: formatRate(summary.approvalRate), hint: `차단 ${summary.qualityGateBlocks} / 승인 ${summary.qualityGateApprovals}` },
      {
        label: "실시간 배치 실패",
        value: serverSummary?.stats.failed ?? 0,
        hint: serverSummary ? `완료 ${serverSummary.stats.completed} / 실행 ${serverSummary.stats.running}` : "서버 요약 대기 중",
      },
    ],
    [serverSummary, summary],
  );

  const onResetLocalMetrics = () => {
    const next = writePilotMetricEvents(window.localStorage, []);
    setEvents(next);
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Commercial Pilot</p>
          <h1 className={styles.title}>파일럿 KPI 대시보드</h1>
          <p className={styles.subtitle}>
            브라우저 계측과 서버 배치 작업 상태를 한 화면에서 확인합니다.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/" className={styles.primaryAction}>
            편집기로 돌아가기
          </Link>
          <button type="button" className={styles.secondaryAction} onClick={() => void refreshServerSummary()}>
            서버 요약 새로고침
          </button>
          <button type="button" className={styles.secondaryAction} onClick={onResetLocalMetrics}>
            로컬 KPI 초기화
          </button>
        </div>
      </section>

      <section className={styles.kpiGrid}>
        {kpiCards.map((card) => (
          <article key={card.label} className={styles.kpiCard}>
            <span className={styles.kpiLabel}>{card.label}</span>
            <strong className={styles.kpiValue}>{card.value}</strong>
            <span className={styles.kpiHint}>{card.hint}</span>
          </article>
        ))}
      </section>

      <section className={styles.sectionGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>운영 상태</h2>
              <p>배치 작업 큐와 최근 서버 집계를 확인합니다.</p>
            </div>
            <span className={styles.timestamp}>
              {serverSummary ? `갱신 ${formatTimestamp(serverSummary.generatedAt)}` : serverLoading ? "로딩 중" : "서버 응답 없음"}
            </span>
          </div>
          {serverError ? <p className={styles.errorBox}>{serverError}</p> : null}
          <div className={styles.serverStats}>
            <div><span>대기</span><strong>{serverSummary?.stats.queued ?? 0}</strong></div>
            <div><span>실행</span><strong>{serverSummary?.stats.running ?? 0}</strong></div>
            <div><span>완료</span><strong>{serverSummary?.stats.completed ?? 0}</strong></div>
            <div><span>실패</span><strong>{serverSummary?.stats.failed ?? 0}</strong></div>
          </div>
          <div className={styles.jobList}>
            {(serverSummary?.jobs ?? []).length ? (
              serverSummary?.jobs.map((job) => {
                const progress = job.totalChunks ? Math.round((job.completedChunks / job.totalChunks) * 100) : 0;
                return (
                  <article key={job.id} className={styles.jobCard}>
                    <div className={styles.jobTopRow}>
                      <strong>{job.status}</strong>
                      <span>{formatTimestamp(job.updatedAt)}</span>
                    </div>
                    <p className={styles.jobInstruction}>{job.instruction}</p>
                    <div className={styles.jobMetaRow}>
                      <span>{`청크 ${job.completedChunks}/${job.totalChunks}`}</span>
                      <span>{`결과 ${job.resultCount}`}</span>
                      <span>{`항목 ${job.itemCount}`}</span>
                      <span>{`${progress}%`}</span>
                    </div>
                    {job.error ? <p className={styles.errorText}>{job.error}</p> : null}
                  </article>
                );
              })
            ) : (
              <p className={styles.emptyState}>최근 배치 작업이 없습니다.</p>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>최근 이벤트</h2>
              <p>현재 브라우저 세션이 남긴 최근 20개 이벤트입니다.</p>
            </div>
            <span className={styles.timestamp}>{`${summary.recentEvents.length}건`}</span>
          </div>
          <div className={styles.eventList}>
            {summary.recentEvents.length ? (
              summary.recentEvents.map((event) => (
                <article key={event.id} className={styles.eventCard}>
                  <div className={styles.eventTopRow}>
                    <strong>{EVENT_LABELS[event.type]}</strong>
                    <span>{formatTimestamp(event.timestamp)}</span>
                  </div>
                  <p className={styles.eventDetail}>{stringifyEventDetail(event.detail)}</p>
                </article>
              ))
            ) : (
              <p className={styles.emptyState}>아직 기록된 로컬 KPI 이벤트가 없습니다.</p>
            )}
          </div>
        </article>
      </section>

      <section className={styles.runbookSection}>
        <div className={styles.panelHeader}>
          <div>
            <h2>운영 런북</h2>
            <p>파일럿 운영자가 바로 참고할 수 있는 체크리스트입니다.</p>
          </div>
        </div>
        <div className={styles.runbookGrid}>
          {PILOT_RUNBOOK.map((section) => (
            <article key={section.title} className={styles.runbookCard}>
              <h3>{section.title}</h3>
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
