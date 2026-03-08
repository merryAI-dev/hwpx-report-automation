"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import JSZip from "jszip";
import { getCsvHeaders } from "@/lib/batch/csv-parser";
import { DEFAULT_COLUMN_MAPPING, type BatchMode, type ColumnMapping } from "@/lib/batch/batch-pipeline";
import { parseHwpxTemplate, type TemplateField } from "@/lib/batch/hwpx-template-parser";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type Step = "upload" | "mapping" | "options" | "processing" | "done" | "error";

type PipelineType = "coordinate" | "placeholder";

type MappingState = {
  columnMapping: ColumnMapping;
  statusFilter: string[];
};

const STATUS_OPTIONS = ["종료", "완료", "확정", "취소"];

// 필드 이름 → 한국어 레이블 (UI 표시용)
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  topic:        "주제",
  participants: "참여자 (기업명)",
  date:         "일시",
  location:     "장소",
  content:      "주요 내용",
  photo:        "진행 사진 링크",
  sisakjeom:    "주요 시사점",
};

// 필수 필드
const REQUIRED_FIELDS = new Set(["topic", "participants", "date", "content"]);

// ── 클라이언트 사이드 템플릿 파싱 ─────────────────────────────────────────────

async function parseTemplateFile(file: File): Promise<{
  fields: TemplateField[];
  placeholders: string[];
  sectionXml: string;
}> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const sectionFile = zip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("유효하지 않은 HWPX 파일: section0.xml 없음");
  const sectionXml = await sectionFile.async("string");

  // 플레이스홀더 탐지
  const matches = sectionXml.match(/\{\{([^}]+)\}\}/g);
  const placeholders = matches
    ? [...new Set(matches.map((m) => m.replace(/^\{\{|\}\}$/g, "")))]
    : [];

  // 기존 좌표 기반 필드 파싱
  const parsed = parseHwpxTemplate(sectionXml);
  return { fields: parsed.fields, placeholders, sectionXml };
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function BatchPage() {
  const [step, setStep] = useState<Step>("upload");
  const [mode, setMode] = useState<BatchMode>("simple");
  const [pipelineType, setPipelineType] = useState<PipelineType>("coordinate");

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvPreviewCount, setCsvPreviewCount] = useState(0);

  // 좌표 기반 모드
  const [templateFields, setTemplateFields] = useState<TemplateField[]>([]);
  const [templateParseError, setTemplateParseError] = useState("");

  // 플레이스홀더 모드
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [placeholderMapping, setPlaceholderMapping] = useState<Record<string, string>>({});

  const [mapping, setMapping] = useState<MappingState>({
    columnMapping: { ...DEFAULT_COLUMN_MAPPING },
    statusFilter: ["종료", "완료"],
  });

  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const csvInputRef = useRef<HTMLInputElement>(null);
  const tplInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 이전 다운로드 URL 정리
  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  // ── 파일 핸들러 ──────────────────────────────────────────────────────────────

  const handleCsvChange = useCallback(async (file: File | null) => {
    if (!file) return;
    setCsvFile(file);
    try {
      const text = await file.text();
      const headers = getCsvHeaders(text);
      setCsvHeaders(headers);
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      setCsvPreviewCount(Math.max(0, lines.length - 1));
    } catch {
      setCsvHeaders([]);
    }
  }, []);

  const handleTemplateChange = useCallback(async (file: File | null) => {
    if (!file) return;
    setTemplateFile(file);
    setTemplateParseError("");
    setTemplateFields([]);
    setPlaceholders([]);
    setPlaceholderMapping({});
    try {
      const result = await parseTemplateFile(file);

      if (result.placeholders.length > 0) {
        // 플레이스홀더 모드 자동 감지
        setPipelineType("placeholder");
        setPlaceholders(result.placeholders);
        // 초기 매핑: 빈 값으로 시작
        const initMapping: Record<string, string> = {};
        for (const p of result.placeholders) {
          initMapping[p] = "";
        }
        setPlaceholderMapping(initMapping);
      } else {
        // 좌표 기반 모드
        setPipelineType("coordinate");
        setTemplateFields(result.fields);
        setMapping((m) => {
          const newColumnMapping = { ...m.columnMapping };
          for (const field of result.fields) {
            const fieldName = labelToFieldName(field.labelText);
            if (!(fieldName in newColumnMapping)) {
              newColumnMapping[fieldName] = "";
            }
          }
          return { ...m, columnMapping: newColumnMapping };
        });
      }
    } catch (err) {
      setTemplateParseError(err instanceof Error ? err.message : "양식 파싱 실패");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, type: "csv" | "template") => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (type === "csv") handleCsvChange(file);
      else handleTemplateChange(file);
    },
    [handleCsvChange, handleTemplateChange],
  );

  // 플레이스홀더 모드: CSV 헤더로 자동 매칭 시도
  useEffect(() => {
    if (pipelineType !== "placeholder" || placeholders.length === 0 || csvHeaders.length === 0) return;
    setPlaceholderMapping((prev) => {
      const updated = { ...prev };
      for (const p of placeholders) {
        if (updated[p]) continue; // 이미 매핑됨
        // 정확히 일치하는 CSV 헤더가 있으면 자동 연결
        const exact = csvHeaders.find((h) => h === p);
        if (exact) {
          updated[p] = exact;
          continue;
        }
        // 부분 매칭 시도
        const partial = csvHeaders.find((h) =>
          h.includes(p) || p.includes(h)
        );
        if (partial) updated[p] = partial;
      }
      return updated;
    });
  }, [pipelineType, placeholders, csvHeaders]);

  // 매핑 JSON 붙여넣기 핸들러
  const handlePasteMapping = useCallback((jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, string>;
      setPlaceholderMapping((prev) => {
        const updated = { ...prev };
        for (const [key, value] of Object.entries(parsed)) {
          if (key in updated) {
            updated[key] = value;
          }
        }
        return updated;
      });
    } catch {
      // 파싱 실패 무시
    }
  }, []);

  const canProceedToMapping =
    pipelineType === "placeholder"
      ? csvFile && templateFile && placeholders.length > 0
      : csvFile && templateFile && templateFields.length > 0;

  // ── 배치 실행 ──────────────────────────────────────────────────────────────

  const runBatch = useCallback(async () => {
    if (!csvFile || !templateFile) return;

    setStep("processing");
    setProgress({ done: 0, total: 0, current: "" });
    abortRef.current = new AbortController();

    try {
      const formData = new FormData();
      formData.append("csv", csvFile);
      formData.append("template", templateFile);
      formData.append("pipelineType", pipelineType);
      formData.append("mode", mode);
      formData.append("statusFilter", JSON.stringify(mapping.statusFilter));

      if (pipelineType === "placeholder") {
        formData.append("mapping", JSON.stringify(placeholderMapping));
      } else {
        formData.append("mapping", JSON.stringify(mapping.columnMapping));
      }

      const fakeProgressInterval = setInterval(() => {
        setProgress((p) => ({
          ...p,
          done: Math.min(p.done + 1, Math.max(p.total - 1, p.done)),
          current: "처리 중...",
        }));
      }, 500);

      const res = await fetch("/api/batch-generate", {
        method: "POST",
        body: formData,
        signal: abortRef.current.signal,
      });

      clearInterval(fakeProgressInterval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "알 수 없는 오류" }));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const fnMatch = cd.match(/filename="([^"]+)"/);
      const fn = fnMatch ? fnMatch[1] : "batch.zip";

      setDownloadUrl(url);
      setDownloadName(fn);
      setStep("done");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [csvFile, templateFile, pipelineType, mode, mapping, placeholderMapping]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setStep("options");
  };

  const handleReset = () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl("");
    setDownloadName("");
    setCsvFile(null);
    setTemplateFile(null);
    setCsvHeaders([]);
    setCsvPreviewCount(0);
    setTemplateFields([]);
    setTemplateParseError("");
    setPlaceholders([]);
    setPlaceholderMapping({});
    setPipelineType("coordinate");
    setMapping({ columnMapping: { ...DEFAULT_COLUMN_MAPPING }, statusFilter: ["종료", "완료"] });
    setStep("upload");
    setProgress({ done: 0, total: 0, current: "" });
    setErrorMsg("");
  };

  // ── 렌더 ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ margin: "0 auto", maxWidth: 960, padding: "40px 16px 56px" }}>
      <h1 style={{ marginBottom: 4, fontSize: 32, fontWeight: 700, color: "var(--color-notion-text)" }}>
        일괄 HWPX 생성
      </h1>
      <p style={{ marginBottom: 32, fontSize: 14, color: "var(--color-notion-text-secondary)" }}>
        CSV 데이터를 한글 양식에 자동으로 채워 HWPX 파일을 대량 생성합니다.
      </p>

      <StepIndicator current={step} />

      <div style={{ marginTop: 32, display: "grid", gap: 24 }}>
        {/* STEP 1: 파일 업로드 */}
        {(step === "upload" || step === "mapping" || step === "options") && (
          <Section title="1. 파일 선택">
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
              <DropZone
                label="CSV 데이터 파일"
                file={csvFile}
                hint={csvFile ? `${csvPreviewCount}행 / 컬럼 ${csvHeaders.length}개` : "엑셀에서 CSV로 저장 후 업로드"}
                onDrop={(e) => handleDrop(e, "csv")}
                onClick={() => csvInputRef.current?.click()}
              />
              <DropZone
                label="한글 양식 (.hwpx)"
                file={templateFile}
                hint={
                  templateParseError
                    ? templateParseError
                    : placeholders.length > 0
                    ? `플레이스홀더 ${placeholders.length}개 감지`
                    : templateFields.length > 0
                    ? `${templateFields.length}개 필드 감지됨`
                    : templateFile
                    ? "양식 파싱 중..."
                    : "양식 파일을 업로드"
                }
                hintColor={
                  templateParseError ? "red"
                  : placeholders.length > 0 ? "blue"
                  : templateFields.length > 0 ? "green"
                  : undefined
                }
                onDrop={(e) => handleDrop(e, "template")}
                onClick={() => tplInputRef.current?.click()}
              />
            </div>

            {/* 플레이스홀더 감지 안내 */}
            {pipelineType === "placeholder" && placeholders.length > 0 && (
              <div style={{ marginTop: 12, borderRadius: 8, background: "#eff6ff", padding: 12 }}>
                <p className="mb-2 text-xs font-medium text-blue-700">
                  플레이스홀더 템플릿 감지됨
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {placeholders.map((p) => (
                    <code
                      key={p}
                      className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-mono text-blue-700"
                    >
                      {`{{${p}}}`}
                    </code>
                  ))}
                </div>
                <p className="mt-2 text-xs text-blue-600">
                  에디터에서 만든 플레이스홀더 양식이 감지되었습니다. CSV 컬럼과 매핑하면 자동으로 채워집니다.
                </p>
              </div>
            )}

            {/* 좌표 기반: 양식 필드 미리보기 */}
            {pipelineType === "coordinate" && templateFields.length > 0 && (
              <div style={{ marginTop: 12, borderRadius: 8, background: "var(--color-notion-bg-hover)", padding: 12 }}>
                <p className="mb-2 text-xs font-medium text-[var(--color-notion-text-secondary)]">
                  감지된 양식 필드
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {templateFields.map((f) => (
                    <span
                      key={`${f.inputCell.col}-${f.inputCell.row}`}
                      className="rounded-full border border-[var(--color-notion-border)] bg-white px-2 py-0.5 text-xs text-[var(--color-notion-text)]"
                    >
                      {f.labelText}
                      <span className="ml-1 text-[var(--color-notion-text-tertiary)]">
                        ({f.inputCell.col},{f.inputCell.row})
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <input ref={csvInputRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={(e) => handleCsvChange(e.target.files?.[0] ?? null)} />
            <input ref={tplInputRef} type="file" accept=".hwpx" style={{ display: "none" }}
              onChange={(e) => handleTemplateChange(e.target.files?.[0] ?? null)} />

            {canProceedToMapping && step === "upload" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn-primary" onClick={() => setStep("mapping")}>
                  다음: 컬럼 매핑 →
                </button>
              </div>
            )}
          </Section>
        )}

        {/* STEP 2: 컬럼 매핑 */}
        {(step === "mapping" || step === "options") && (
          <Section title="2. 컬럼 매핑">
            {pipelineType === "placeholder" ? (
              /* 플레이스홀더 매핑 UI */
              <>
                <p className="mb-4 text-xs text-[var(--color-notion-text-secondary)]">
                  각 플레이스홀더에 채울 CSV 컬럼을 선택하세요.
                  에디터에서 복사한 매핑 JSON을 붙여넣으면 자동으로 적용됩니다.
                </p>

                {/* 매핑 JSON 붙여넣기 */}
                <div style={{ marginBottom: 16 }}>
                  <button
                    type="button"
                    className="rounded-md border border-[var(--color-notion-border)] px-3 py-1.5 text-xs text-[var(--color-notion-text-secondary)] hover:bg-[var(--color-notion-bg-hover)]"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        handlePasteMapping(text);
                      } catch {
                        // clipboard API 실패 시 무시
                      }
                    }}
                  >
                    클립보드에서 매핑 붙여넣기
                  </button>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {placeholders.map((p) => (
                    <div key={p} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <code className="w-40 shrink-0 rounded bg-blue-50 px-2 py-1 text-sm font-mono text-blue-700">
                        {`{{${p}}}`}
                      </code>
                      <span className="text-[var(--color-notion-text-tertiary)]">→</span>
                      <select
                        className="flex-1 rounded-md border border-[var(--color-notion-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-notion-text)] focus:border-[var(--color-notion-accent)] focus:outline-none"
                        value={placeholderMapping[p] ?? ""}
                        onChange={(e) => setPlaceholderMapping((m) => ({ ...m, [p]: e.target.value }))}
                      >
                        <option value="">(비워두기)</option>
                        {csvHeaders.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* 좌표 기반 매핑 UI (기존) */
              <>
                <p className="mb-4 text-xs text-[var(--color-notion-text-secondary)]">
                  CSV 컬럼을 양식 필드에 연결합니다. 양식에서 감지된 필드가 자동으로 표시됩니다.
                </p>
                <div style={{ display: "grid", gap: 12 }}>
                  {templateFields.map((field) => {
                    const fieldName = labelToFieldName(field.labelText);
                    const displayLabel = FIELD_DISPLAY_NAMES[fieldName] ?? field.labelText;
                    const isRequired = REQUIRED_FIELDS.has(fieldName);
                    return (
                      <div key={`${field.inputCell.col}-${field.inputCell.row}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="w-40 shrink-0 text-sm text-[var(--color-notion-text)]">
                          {displayLabel}
                          {isRequired && <span className="ml-1 text-[var(--color-notion-red)]">*</span>}
                        </span>
                        <select
                          className="flex-1 rounded-md border border-[var(--color-notion-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-notion-text)] focus:border-[var(--color-notion-accent)] focus:outline-none"
                          value={mapping.columnMapping[fieldName] ?? ""}
                          onChange={(e) => setMapping((m) => ({ ...m, columnMapping: { ...m.columnMapping, [fieldName]: e.target.value } }))}
                        >
                          <option value="">(비워두기)</option>
                          {csvHeaders.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* 상태 필터 (공통) */}
            <div style={{ marginTop: 20, borderTop: "1px solid var(--color-notion-border)", paddingTop: 16 }}>
              <p className="mb-2 text-sm font-medium text-[var(--color-notion-text)]">처리할 행 상태 (복수 선택)</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {STATUS_OPTIONS.map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--color-notion-border)] px-3 py-1 text-sm hover:bg-[var(--color-notion-bg-hover)]">
                    <input
                      type="checkbox"
                      checked={mapping.statusFilter.includes(s)}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          statusFilter: e.target.checked
                            ? [...m.statusFilter, s]
                            : m.statusFilter.filter((x) => x !== s),
                        }))
                      }
                    />
                    {s}
                  </label>
                ))}
                <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--color-notion-border)] px-3 py-1 text-sm hover:bg-[var(--color-notion-bg-hover)]">
                  <input
                    type="checkbox"
                    checked={mapping.statusFilter.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) setMapping((m) => ({ ...m, statusFilter: [] }));
                    }}
                  />
                  모든 행
                </label>
              </div>
            </div>

            {step === "mapping" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn-primary" onClick={() => setStep("options")}>
                  다음: 생성 옵션 →
                </button>
              </div>
            )}
          </Section>
        )}

        {/* STEP 3: 생성 옵션 */}
        {step === "options" && (
          <Section title="3. 생성 옵션">
            {pipelineType === "placeholder" ? (
              /* 플레이스홀더 모드: 심플 직접 치환만 */
              <div style={{ borderRadius: 12, border: "2px solid var(--color-notion-accent)", background: "var(--color-notion-accent-light)", padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    플레이스홀더 치환
                  </span>
                </div>
                <p className="mt-2 text-xs text-[var(--color-notion-text-secondary)] ml-0">
                  양식의 {"{{플레이스홀더}}"}를 CSV 데이터로 직접 치환합니다. AI 호출 없이 즉시 처리됩니다.
                </p>

                {/* 매핑 요약 */}
                <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
                  {placeholders.map((p) => {
                    const col = placeholderMapping[p];
                    return (
                      <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                        <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-blue-700">
                          {`{{${p}}}`}
                        </code>
                        <span className="text-[var(--color-notion-text-tertiary)]">→</span>
                        <span className={col ? "text-[var(--color-notion-text)]" : "text-[var(--color-notion-text-tertiary)] italic"}>
                          {col || "(비움)"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* 좌표 기반 모드: 기존 Phase 1/2 선택 */
              <div style={{ display: "grid", gap: 12 }}>
                <ModeCard
                  selected={mode === "simple"}
                  onSelect={() => setMode("simple")}
                  title="Phase 1 — 직접 주입"
                  badge="빠름 · 무료"
                  badgeColor="green"
                  desc="CSV 데이터를 그대로 양식에 채웁니다. AI 호출 없이 즉시 처리됩니다."
                  pros={["수 초 내 완료", "API 비용 없음", "원문 그대로 보존"]}
                  cons={["시사점 칸 비워짐", "보고서 마크다운 기호 유지"]}
                />
                <ModeCard
                  selected={mode === "ai-refine"}
                  onSelect={() => setMode("ai-refine")}
                  title="Phase 2 — AI 정제"
                  badge="Claude Haiku"
                  badgeColor="blue"
                  desc="보고서를 Claude AI가 정제해 주요 내용과 시사점을 자동 분리합니다."
                  pros={["시사점 자동 추출", "마크다운 제거", "깔끔한 문서"]}
                  cons={["행당 0.5~2초 소요", "소량의 API 비용 발생"]}
                />
              </div>
            )}

            <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <p className="text-sm text-[var(--color-notion-text-secondary)]">
                총 <span className="font-semibold text-[var(--color-notion-text)]">{csvPreviewCount}</span>행
              </p>
              <button type="button" className="btn-primary" onClick={runBatch}>
                {pipelineType === "placeholder"
                  ? "▶ 플레이스홀더 치환 생성"
                  : mode === "simple"
                  ? "▶ 지금 바로 생성"
                  : "▶ AI 정제 후 생성"}
              </button>
            </div>
          </Section>
        )}

        {/* STEP 4: 처리 중 */}
        {step === "processing" && (
          <Section title="처리 중...">
            <div style={{ display: "grid", gap: 16, padding: "16px 0" }}>
              <div style={{ height: 8, overflow: "hidden", borderRadius: 999, background: "var(--color-notion-bg-hover)" }}>
                <div
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "var(--color-notion-accent)",
                    transition: "width 300ms ease",
                    width: progress.total > 0
                      ? `${Math.round((progress.done / progress.total) * 100)}%`
                      : "40%",
                    animation: progress.total === 0 ? "pulse 1.5s ease-in-out infinite" : undefined,
                  }}
                />
              </div>
              <p style={{ textAlign: "center", fontSize: 14, color: "var(--color-notion-text-secondary)" }}>
                {progress.total > 0
                  ? `${progress.done} / ${progress.total} 완료 — ${progress.current}`
                  : "서버에서 처리 중입니다..."}
              </p>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button type="button" className="btn" onClick={handleCancel}>
                  취소
                </button>
              </div>
            </div>
          </Section>
        )}

        {/* STEP 5: 완료 */}
        {step === "done" && (
          <Section title="완료!">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "24px 0" }}>
              <div style={{ fontSize: 48 }}>📦</div>
              <p style={{ fontSize: 14, color: "var(--color-notion-text-secondary)" }}>
                HWPX 파일이 ZIP으로 묶였습니다.
              </p>
              <a
                href={downloadUrl}
                download={downloadName}
                className="btn-primary inline-block"
              >
                ⬇ {downloadName} 다운로드
              </a>
              <button type="button" className="btn text-xs" onClick={handleReset}>
                처음부터 다시
              </button>
            </div>
          </Section>
        )}

        {/* 에러 */}
        {step === "error" && (
          <Section title="오류 발생">
            <div style={{ borderRadius: 8, background: "#fef2f2", padding: 16 }}>
              <p style={{ fontSize: 14, color: "#b91c1c" }}>{errorMsg}</p>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setStep("options")}>
                다시 시도
              </button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ── 레이블 → 필드명 변환 (파서와 동일 로직) ───────────────────────────────────

const LABEL_ALIASES: Record<string, string> = {
  "주제": "topic", "아젠다": "topic", "제목": "topic",
  "참여자": "participants", "참여기업": "participants", "참가자": "participants", "성명": "participants",
  "일시": "date", "날짜": "date", "일정": "date",
  "장소": "location", "위치": "location",
  "주요 내용": "content", "내용": "content", "보고내용": "content",
  "진행 사진": "photo", "사진": "photo", "첨부파일": "photo",
  "주요 시사점 및 향후 개선·보완사항": "sisakjeom",
  "시사점": "sisakjeom", "개선사항": "sisakjeom", "주요 시사점": "sisakjeom",
};

function labelToFieldName(labelText: string): string {
  const normalized = labelText.replace(/\s+/g, " ").replace(/[·⸱∙•]/g, "·").trim();
  if (LABEL_ALIASES[normalized]) return LABEL_ALIASES[normalized];
  for (const [alias, field] of Object.entries(LABEL_ALIASES)) {
    if (normalized.includes(alias) || alias.includes(normalized)) return field;
  }
  return normalized.toLowerCase().replace(/\s+/g, "_");
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step[]; label: string }[] = [
    { key: ["upload"], label: "파일 선택" },
    { key: ["mapping"], label: "컬럼 매핑" },
    { key: ["options"], label: "생성 옵션" },
    { key: ["processing", "done", "error"], label: "생성" },
  ];

  const currentIdx = steps.findIndex((s) => s.key.includes(current));

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 8 }}>
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                height: 28,
                width: 28,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                background: done ? "var(--color-notion-green)" : active ? "var(--color-notion-accent)" : "var(--color-notion-bg-hover)",
                color: done || active ? "#fff" : "var(--color-notion-text-tertiary)",
              }}
            >
              {done ? "✓" : i + 1}
            </div>
            <span style={{ marginLeft: 8, marginRight: 16, fontSize: 12, fontWeight: active ? 600 : 500, color: active ? "var(--color-notion-text)" : "var(--color-notion-text-secondary)" }}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div style={{ marginRight: 16, height: 1, width: 24, background: done ? "var(--color-notion-green)" : "var(--color-notion-border)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--color-notion-border)", background: "#fff", padding: 24, boxShadow: "0 10px 30px rgba(15, 23, 42, 0.04)" }}>
      <h2 style={{ marginBottom: 16, fontSize: 14, fontWeight: 700, color: "var(--color-notion-text)" }}>{title}</h2>
      {children}
    </div>
  );
}

function DropZone({
  label, file, hint, hintColor, onDrop, onClick,
}: {
  label: string; file: File | null;
  hint: string; hintColor?: "red" | "green" | "blue";
  onDrop: (e: React.DragEvent) => void; onClick: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        minHeight: 180,
        cursor: "pointer",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: 16,
        border: `2px dashed ${dragging ? "var(--color-notion-accent)" : file ? "var(--color-notion-green)" : "var(--color-notion-border)"}`,
        background: dragging ? "var(--color-notion-accent-light)" : file ? "#f0fdf4" : "#fff",
        padding: 24,
        textAlign: "center",
        transition: "all 160ms ease",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { setDragging(false); onDrop(e); }}
      onClick={onClick}
    >
      <div style={{ fontSize: 28 }}>{file ? "✅" : "📁"}</div>
      <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-notion-text)" }}>{label}</p>
      {file ? (
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-notion-green)" }}>{file.name}</p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--color-notion-text-secondary)" }}>클릭 또는 드래그</p>
      )}
      <p style={{ fontSize: 12, color: hintColor === "red" ? "#dc2626" : hintColor === "green" ? "var(--color-notion-green)" : hintColor === "blue" ? "#2563eb" : "var(--color-notion-text-tertiary)" }}>
        {hint}
      </p>
    </div>
  );
}

function ModeCard({
  selected, onSelect, title, badge, badgeColor, desc, pros, cons,
}: {
  selected: boolean; onSelect: () => void;
  title: string; badge: string; badgeColor: "green" | "blue";
  desc: string; pros: string[]; cons: string[];
}) {
  return (
    <button
      type="button"
      style={{
        width: "100%",
        borderRadius: 16,
        border: `2px solid ${selected ? "var(--color-notion-accent)" : "var(--color-notion-border)"}`,
        background: selected ? "var(--color-notion-accent-light)" : "#fff",
        padding: 16,
        textAlign: "left",
        transition: "all 160ms ease",
      }}
      onClick={onSelect}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex",
            height: 16,
            width: 16,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            border: `2px solid ${selected ? "var(--color-notion-accent)" : "var(--color-notion-border-strong)"}`,
          }}
        >
          {selected && <div style={{ height: 8, width: 8, borderRadius: 999, background: "var(--color-notion-accent)" }} />}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-notion-text)" }}>{title}</span>
        <span
          style={{
            marginLeft: "auto",
            borderRadius: 999,
            padding: "2px 8px",
            fontSize: 12,
            fontWeight: 600,
            background: badgeColor === "green" ? "#dcfce7" : "#dbeafe",
            color: badgeColor === "green" ? "#15803d" : "#1d4ed8",
          }}
        >
          {badge}
        </span>
      </div>
      <p style={{ marginTop: 8, marginLeft: 24, fontSize: 12, color: "var(--color-notion-text-secondary)" }}>{desc}</p>
      <div style={{ marginTop: 12, marginLeft: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div>
          {pros.map((p) => (
            <p key={p} style={{ fontSize: 12, color: "#15803d" }}>{`✓ ${p}`}</p>
          ))}
        </div>
        <div>
          {cons.map((c) => (
            <p key={c} style={{ fontSize: 12, color: "var(--color-notion-text-secondary)" }}>{`· ${c}`}</p>
          ))}
        </div>
      </div>
    </button>
  );
}
