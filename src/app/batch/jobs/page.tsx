"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./page.module.css";

/* ── Types (mirrored from server) ── */
type BatchJobStatus = "queued" | "running" | "completed" | "failed";

type BatchSuggestionRow = {
  id: string;
  suggestion: string;
  qualityGate: { passed: boolean; score: number };
};

type BatchJobRecord = {
  id: string;
  status: BatchJobStatus;
  instruction: string;
  model?: string;
  itemCount: number;
  totalChunks: number;
  completedChunks: number;
  resultCount: number;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  results: BatchSuggestionRow[];
};

/* ── CSV parsing (client-side) ── */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

/* ── Helpers ── */
function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}

function statusBadgeClass(status: BatchJobStatus): string {
  switch (status) {
    case "queued":
      return styles.badgeQueued;
    case "running":
      return styles.badgeRunning;
    case "completed":
      return styles.badgeCompleted;
    case "failed":
      return styles.badgeFailed;
  }
}

function statusLabel(status: BatchJobStatus): string {
  switch (status) {
    case "queued":
      return "대기 중";
    case "running":
      return "실행 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
  }
}

/* ── Job Card ── */
function JobCard({
  job,
  onRefresh,
}: {
  job: BatchJobRecord;
  onRefresh: (jobId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const startTimeRef = useRef<number>(job.createdAt);
  const [now, setNow] = useState<number>(Date.now());

  const isActive = job.status === "queued" || job.status === "running";
  const progress = job.itemCount > 0 ? (job.resultCount / job.itemCount) * 100 : 0;

  // Update elapsed timer while running
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Poll for updates while active
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => onRefresh(job.id), 2000);
    return () => clearInterval(id);
  }, [isActive, job.id, onRefresh]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/batch-jobs/${job.id}/download`);
      if (!res.ok) {
        throw new Error(`다운로드 실패: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `batch-${shortId(job.id)}.zip`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "다운로드 중 오류 발생");
    } finally {
      setDownloading(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/batch-jobs/${job.id}/retry`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `재시도 실패: ${res.status}`);
      }
      onRefresh(job.id);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "재시도 중 오류");
    } finally {
      setRetrying(false);
    }
  };

  const hasFailedItems = job.status === "failed" || (job.results.length > 0 && job.results.some((r) => !r.qualityGate.passed));

  return (
    <div className={styles.jobCard}>
      <div className={styles.jobHeader}>
        <span className={styles.jobId}>{shortId(job.id)}</span>
        <span className={`${styles.badge} ${statusBadgeClass(job.status)}`}>
          {statusLabel(job.status)}
        </span>
        <span className={styles.jobInstruction} title={job.instruction}>
          {job.instruction}
        </span>
        <div className={styles.jobActions}>
          {job.status === "completed" && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? "다운로드 중..." : "ZIP 다운로드"}
            </button>
          )}
          {hasFailedItems && job.status !== "running" && (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? "재시도 중..." : "실패 항목 재시도"}
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className={styles.progressRow}>
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <span className={styles.progressText}>
          {job.resultCount} / {job.itemCount}
        </span>
        {isActive && (
          <span className={styles.elapsed}>
            {formatElapsed(now - startTimeRef.current)}
          </span>
        )}
      </div>

      {/* Error */}
      {job.error && <div className={styles.errorText}>{job.error}</div>}
      {retryError && <div className={styles.errorText}>{retryError}</div>}

      {/* Expandable items */}
      {job.results.length > 0 && (
        <>
          <button
            type="button"
            className={styles.expandToggle}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "항목 접기"
              : `항목 ${job.results.length}개 펼치기`}
          </button>
          {expanded && (
            <div className={styles.itemList}>
              {job.results.map((row, idx) => {
                const passed = row.qualityGate.passed;
                return (
                  <div key={row.id} className={styles.itemRow}>
                    <span
                      className={`${styles.itemStatus} ${
                        passed ? styles.itemStatusDone : styles.itemStatusFailed
                      }`}
                    >
                      {passed ? "완료" : "실패"}
                    </span>
                    <span className={styles.itemPreview}>
                      <strong className={styles.muted}>#{idx + 1} {row.id}</strong>{" "}
                      {row.suggestion.slice(0, 100)}
                      {row.suggestion.length > 100 ? "…" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function BatchJobsPage() {
  const [showNewJob, setShowNewJob] = useState(false);

  // New job form state
  const [instruction, setInstruction] = useState("");
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localJobs, setLocalJobs] = useState<Map<string, BatchJobRecord>>(new Map());

  const refreshJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/batch-jobs/${jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: BatchJobRecord };
      setLocalJobs((prev) => {
        const next = new Map(prev);
        next.set(jobId, data.job);
        return next;
      });
    } catch {
      // silently ignore network errors during polling
    }
  }, []);

  const allJobs = [...localJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const activeJobs = allJobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const completedJobs = allJobs.filter(
    (j) => j.status === "completed" || j.status === "failed",
  );

  const handleCsvFile = (file: File) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvRows(parseCsv(text));
    };
    reader.readAsText(file, "utf-8");
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!instruction.trim()) {
      setSubmitError("지시사항을 입력해주세요.");
      return;
    }
    if (csvRows.length === 0) {
      setSubmitError("CSV 파일을 업로드해주세요.");
      return;
    }

    // Convert CSV rows to BatchItems
    const items = csvRows.map((row, idx) => ({
      id: row["id"] || String(idx + 1),
      text: row["text"] || row["내용"] || Object.values(row).join(" "),
      styleHints: Object.fromEntries(
        Object.entries(row).filter(([k]) => k !== "id" && k !== "text" && k !== "내용"),
      ),
    }));

    setSubmitting(true);
    try {
      const res = await fetch("/api/batch-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim(), items }),
      });
      const data = (await res.json()) as { job?: BatchJobRecord; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `작업 생성 실패: ${res.status}`);
      }
      if (data.job) {
        setLocalJobs((prev) => {
          const next = new Map(prev);
          next.set(data.job!.id, data.job!);
          return next;
        });
      }
      setInstruction("");
      setCsvRows([]);
      setCsvFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setShowNewJob(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "오류 발생");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>배치 작업</h1>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setShowNewJob((v) => !v)}
          >
            {showNewJob ? "취소" : "새 작업"}
          </button>
        </div>

        {/* New Job Panel */}
        {showNewJob && (
          <div className={styles.newJobPanel}>
            <div className={styles.panelTitle}>새 배치 작업 만들기</div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="batch-instruction">
                지시사항
              </label>
              <textarea
                id="batch-instruction"
                className={styles.textarea}
                placeholder="예: 주간 보고서 초안을 작성해주세요"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="batch-csv">
                CSV 파일
              </label>
              <input
                id="batch-csv"
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className={styles.fileInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvFile(file);
                }}
              />
              {csvFileName && (
                <span className={styles.csvHint}>
                  {csvFileName} — {csvRows.length}행 로드됨 (첫 행은 헤더)
                </span>
              )}
              <span className={styles.csvHint}>
                첫 행: 헤더 (id, text 컬럼 권장). 나머지 행: 각 항목 데이터
              </span>
            </div>

            {submitError && <div className={styles.errorText}>{submitError}</div>}

            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setShowNewJob(false);
                  setSubmitError(null);
                }}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "작업 생성 중..." : "작업 시작"}
              </button>
            </div>
          </div>
        )}

        {/* Active Jobs */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            실행 중인 작업 ({activeJobs.length})
          </div>
          {activeJobs.length === 0 ? (
            <div className={styles.empty}>실행 중인 작업이 없습니다.</div>
          ) : (
            activeJobs.map((job) => (
              <JobCard key={job.id} job={job} onRefresh={refreshJob} />
            ))
          )}
        </div>

        {/* Completed Jobs */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            완료된 작업 ({completedJobs.length})
          </div>
          {completedJobs.length === 0 ? (
            <div className={styles.empty}>완료된 작업이 없습니다.</div>
          ) : (
            completedJobs.map((job) => (
              <JobCard key={job.id} job={job} onRefresh={refreshJob} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
