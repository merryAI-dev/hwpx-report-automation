"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { WorkspaceTemplateDetail } from "@/lib/workspace-types";
import type { TemplateFieldDefinition } from "@/lib/template-catalog";
import styles from "./page.module.css";

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateFieldDefinition;
  value: string;
  onChange: (val: string) => void;
}) {
  const { type, key, label, options } = field;

  if (type === "boolean") {
    return (
      <div className={styles.checkboxRow}>
        <input
          type="checkbox"
          id={`field-${key}`}
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
        <label htmlFor={`field-${key}`}>{label}</label>
      </div>
    );
  }

  if (type === "choice") {
    return (
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">-- 선택하세요 --</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (type === "date") {
    return (
      <input
        type="date"
        className={styles.input}
        value={value || getTodayDateString()}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (type === "number" || type === "currency") {
    return (
      <input
        type="number"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === "currency" ? "0" : "숫자 입력"}
      />
    );
  }

  if (type === "table") {
    return (
      <>
        <textarea
          className={styles.textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="쉼표로 구분된 값 입력 (예: 항목1, 항목2, 항목3)"
        />
        <div className={styles.tableHint}>쉼표(,)로 구분하여 여러 값을 입력할 수 있습니다.</div>
      </>
    );
  }

  // default: text
  return (
    <textarea
      className={styles.textarea}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder={`${label} 입력`}
    />
  );
}

export default function GeneratePage() {
  const searchParams = useSearchParams();
  const templateId = searchParams.get("templateId") || "";

  const [template, setTemplate] = useState<WorkspaceTemplateDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [genSuccess, setGenSuccess] = useState("");

  const loadTemplate = useCallback(async () => {
    if (!templateId) {
      setLoadError("templateId가 필요합니다. URL에 ?templateId=... 를 추가하세요.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as { template?: WorkspaceTemplateDetail; error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "템플릿을 불러오지 못했습니다.");
      }
      setTemplate(payload.template ?? null);
      if (payload.template?.currentVersion?.catalog?.fields) {
        const defaults: Record<string, string> = {};
        for (const f of payload.template.currentVersion.catalog.fields) {
          defaults[f.key] = f.defaultValue ?? (f.type === "date" ? getTodayDateString() : "");
        }
        setValues(defaults);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "템플릿을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  const handleFieldChange = (key: string, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) return;
    setGenerating(true);
    setGenError("");
    setGenSuccess("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, values }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "문서 생성 실패");
      }

      // Trigger browser download
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1].trim()) : "output.hwpx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setGenSuccess("문서가 생성되었습니다. 다운로드가 시작됩니다.");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "문서 생성 실패");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.loading}>
            <div className={styles.loadingSpinner} />
            <span>템플릿 정보를 불러오는 중입니다...</span>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.error}>{loadError}</div>
          <Link className={styles.backLink} href="/templates">
            템플릿 목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const fields = template?.currentVersion?.catalog?.fields ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.kicker}>문서 생성</div>
            <h1 className={styles.title}>{template?.name ?? "템플릿"}</h1>
            {template?.documentType ? (
              <p className={styles.subtitle}>{template.documentType}</p>
            ) : null}
          </div>
          <Link className={styles.backLink} href="/templates">
            ← 템플릿 목록
          </Link>
        </header>

        {template ? (
          <div className={styles.metaCard}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>상태</span>
              <span className={styles.badge}>{template.status}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>버전</span>
              <span className={styles.metaValue}>v{template.currentVersionNumber}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>필드 수</span>
              <span className={styles.metaValue}>{fields.length}개</span>
            </div>
          </div>
        ) : null}

        <form onSubmit={(e) => { void handleGenerate(e); }}>
          <div className={styles.fieldsPanel}>
            {fields.length === 0 ? (
              <div className={styles.emptyFields}>
                이 템플릿에는 입력할 필드가 없습니다.
              </div>
            ) : (
              fields.map((field: TemplateFieldDefinition) => (
                <div key={field.key} className={styles.fieldCard}>
                  <div className={styles.fieldHeader}>
                    <span className={styles.fieldLabel}>{field.label}</span>
                    {field.required ? <span className={styles.required}>*</span> : null}
                    <span className={styles.typeBadge} data-type={field.type}>{field.type}</span>
                  </div>
                  {field.description ? (
                    <div className={styles.fieldDescription}>{field.description}</div>
                  ) : null}
                  <FieldInput
                    field={field}
                    value={values[field.key] ?? ""}
                    onChange={(val) => handleFieldChange(field.key, val)}
                  />
                </div>
              ))
            )}
          </div>

          <div className={styles.actions} style={{ marginTop: 16 }}>
            {genError ? <div className={styles.error}>{genError}</div> : null}
            {genSuccess ? <div className={styles.success}>{genSuccess}</div> : null}
            <button
              type="submit"
              className={`${styles.ctaButton}${generating ? ` ${styles.loading}` : ""}`}
              disabled={generating || !template}
            >
              {generating ? (
                <>
                  <span className={styles.spinner} />
                  생성 중...
                </>
              ) : (
                "생성하기"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
