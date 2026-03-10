"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceTemplateDetail, WorkspaceTemplateVersionSummary } from "@/lib/workspace-types";
import type { TemplateCatalogDiff } from "@/lib/server/template-diff";
import styles from "../../workspace.module.css";

function badgeClass(status: WorkspaceTemplateDetail["status"]): string {
  if (status === "approved") return `${styles.badge} ${styles.badgeApproved}`;
  if (status === "deprecated") return `${styles.badge} ${styles.badgeDeprecated}`;
  return `${styles.badge} ${styles.badgeDraft}`;
}

export default function TemplateDetailPage() {
  const params = useParams<{ templateId: string }>();
  const templateId = String(params.templateId || "");
  const [template, setTemplate] = useState<WorkspaceTemplateDetail | null>(null);
  const [versions, setVersions] = useState<WorkspaceTemplateVersionSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState("report");
  const [file, setFile] = useState<File | null>(null);
  const [diffFromVersion, setDiffFromVersion] = useState("");
  const [diffToVersion, setDiffToVersion] = useState("");
  const [diff, setDiff] = useState<TemplateCatalogDiff | null>(null);
  const [diffError, setDiffError] = useState("");

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [templateResponse, versionsResponse] = await Promise.all([
        fetch(`/api/templates/${templateId}`, { cache: "no-store" }),
        fetch(`/api/templates/${templateId}/versions`, { cache: "no-store" }),
      ]);
      const templatePayload = (await templateResponse.json().catch(() => ({}))) as { template?: WorkspaceTemplateDetail; error?: string };
      const versionsPayload = (await versionsResponse.json().catch(() => ({}))) as { versions?: WorkspaceTemplateVersionSummary[]; error?: string };
      if (!templateResponse.ok) {
        throw new Error(templatePayload.error || "템플릿을 불러오지 못했습니다.");
      }
      setTemplate(templatePayload.template || null);
      setName(templatePayload.template?.name || "");
      setDocumentType(templatePayload.template?.documentType || "report");
      setVersions(versionsPayload.versions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "템플릿을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    if (templateId) {
      void loadTemplate();
    }
  }, [templateId, loadTemplate]);

  const onAction = async (action: "approve" | "deprecate") => {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/templates/${templateId}/${action}`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { template?: WorkspaceTemplateDetail; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `템플릿 ${action} 실패`);
      }
      setTemplate(payload.template || null);
      await loadTemplate();
    } catch (err) {
      setError(err instanceof Error ? err.message : `템플릿 ${action} 실패`);
    } finally {
      setSubmitting(false);
    }
  };

  const onDiff = async () => {
    if (!diffFromVersion || !diffToVersion) {
      setDiffError("기준 버전과 비교 버전을 모두 선택하세요.");
      return;
    }
    setDiffError("");
    setDiff(null);
    try {
      const response = await fetch(
        `/api/templates/${templateId}/versions/${diffFromVersion}/diff?with=${encodeURIComponent(diffToVersion)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as { diff?: TemplateCatalogDiff; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "버전 비교 실패");
      }
      setDiff(payload.diff || null);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : "버전 비교 실패");
    }
  };

  const onUploadVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("새 버전에 사용할 HWPX 파일을 선택하세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", name.trim() || template?.name || file.name);
      formData.append("documentType", documentType.trim() || template?.documentType || "report");
      const response = await fetch(`/api/templates/${templateId}/versions`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "템플릿 버전 업로드 실패");
      }
      setFile(null);
      await loadTemplate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "템플릿 버전 업로드 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.kicker}>Template Detail</div>
            <h1 className={styles.title}>{template?.name || "템플릿 상세"}</h1>
            <p className={styles.subtitle}>현재 카탈로그, 승인 상태, 버전 이력을 관리합니다.</p>
          </div>
          <div className={styles.nav}>
            <Link className={styles.navLink} href="/templates">템플릿함</Link>
            <Link className={styles.navLink} href="/documents">문서함</Link>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <div className={styles.empty}>템플릿 상세를 불러오는 중입니다.</div> : null}
        {!loading && !template ? <div className={styles.empty}>템플릿을 찾지 못했습니다.</div> : null}

        {template ? (
          <>
            <section className={styles.panel}>
              <div className={styles.row}>
                <div className={styles.badgeRow}>
                  <span className={badgeClass(template.status)}>{template.status}</span>
                  <span className={styles.badge}>{template.documentType}</span>
                  <span className={styles.badge}>v{template.currentVersionNumber}</span>
                </div>
                <div className={styles.nav}>
                  <button type="button" className={styles.primaryButton} onClick={() => void onAction("approve")} disabled={submitting || template.status === "approved"}>승인</button>
                  <button type="button" className={styles.secondaryButton} onClick={() => void onAction("deprecate")} disabled={submitting || template.status === "deprecated"}>중단</button>
                </div>
              </div>
              <div className={styles.badgeRow}>
                <span className={styles.badge}>필드 {template.fieldCount}</span>
                <span className={styles.badge}>이슈 {template.issueCount}</span>
                <span className={styles.badge}>차단 {template.blockingIssueCount}</span>
              </div>
              {template.currentVersion?.download ? (
                <a className={styles.navLink} href={template.currentVersion.download.downloadUrl}>현재 버전 다운로드</a>
              ) : null}
            </section>

            <section className={styles.panel}>
              <div className={styles.row}><h2 className={styles.cardTitle}>현재 카탈로그</h2></div>
              {!template.currentVersion ? <div className={styles.empty}>현재 버전이 없습니다.</div> : (
                <>
                  <div className={styles.badgeRow}>
                    <span className={styles.badge}>catalog {template.currentVersion.catalogVersion}</span>
                    <span className={styles.badge}>raw tags {template.currentVersion.catalog.rawTagCount}</span>
                  </div>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>키</th>
                        <th>타입</th>
                        <th>라벨</th>
                        <th>필수</th>
                        <th>옵션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {template.currentVersion.catalog.fields.map((field) => (
                        <tr key={field.key}>
                          <td>{field.key}</td>
                          <td>{field.type}</td>
                          <td>{field.label}</td>
                          <td>{field.required ? "Y" : "N"}</td>
                          <td>{field.options.join(", ") || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {template.currentVersion.catalog.issues.length ? (
                    <div className={styles.list}>
                      {template.currentVersion.catalog.issues.map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={styles.listItem}>
                          <div className={styles.row}>
                            <strong>{issue.code}</strong>
                            <span className={styles.badge}>{issue.severity}</span>
                          </div>
                          <div>{issue.message}</div>
                          <div className={styles.code}>{issue.token}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.row}><h2 className={styles.cardTitle}>새 버전 업로드</h2></div>
              <form className={styles.form} onSubmit={onUploadVersion}>
                <div className={styles.formRow}>
                  <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="템플릿 이름" />
                  <input className={styles.input} value={documentType} onChange={(event) => setDocumentType(event.target.value)} placeholder="문서 유형" />
                  <input className={styles.input} type="file" accept=".hwpx" onChange={(event) => setFile(event.target.files?.[0] || null)} />
                </div>
                <button type="submit" className={styles.primaryButton} disabled={submitting}>{submitting ? "업로드 중..." : "새 버전 등록"}</button>
              </form>
            </section>

            <section className={styles.panel}>
              <div className={styles.row}><h2 className={styles.cardTitle}>버전 이력</h2></div>
              {!versions.length ? <div className={styles.empty}>버전 이력이 없습니다.</div> : (
                <div className={styles.list}>
                  {versions.map((version) => (
                    <div key={version.id} className={styles.listItem}>
                      <div className={styles.row}>
                        <strong>v{version.versionNumber}</strong>
                        <span className={styles.muted}>{new Date(version.createdAt).toLocaleString("ko-KR")}</span>
                      </div>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>필드 {version.fieldCount}</span>
                        <span className={styles.badge}>이슈 {version.issueCount}</span>
                        <span className={styles.badge}>차단 {version.blockingIssueCount}</span>
                      </div>
                      <div className={styles.row}>
                        <span className={styles.code}>{version.fileName}</span>
                        {version.download ? <a className={styles.navLink} href={version.download.downloadUrl}>다운로드</a> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.row}><h2 className={styles.cardTitle}>버전 비교</h2></div>
              {versions.length < 2 ? (
                <div className={styles.empty}>비교할 버전이 최소 2개 필요합니다.</div>
              ) : (
                <>
                  <div className={styles.formRow}>
                    <div className={styles.field}>
                      <label className={styles.label}>기준 버전</label>
                      <select
                        className={styles.select}
                        value={diffFromVersion}
                        onChange={(event) => setDiffFromVersion(event.target.value)}
                      >
                        <option value="">선택</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>v{v.versionNumber} ({v.catalogVersion})</option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>비교 버전</label>
                      <select
                        className={styles.select}
                        value={diffToVersion}
                        onChange={(event) => setDiffToVersion(event.target.value)}
                      >
                        <option value="">선택</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>v{v.versionNumber} ({v.catalogVersion})</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void onDiff()}
                      disabled={!diffFromVersion || !diffToVersion}
                    >
                      비교
                    </button>
                  </div>
                  {diffError ? <div className={styles.error}>{diffError}</div> : null}
                  {diff ? (
                    <div>
                      <div className={styles.badgeRow}>
                        <span className={`${styles.badge} ${styles.badgeReady}`}>추가 {diff.addedCount}</span>
                        <span className={`${styles.badge} ${styles.badgeArchived}`}>삭제 {diff.removedCount}</span>
                        <span className={`${styles.badge} ${styles.badgeDraft}`}>변경 {diff.changedCount}</span>
                      </div>
                      {diff.entries.length === 0 ? (
                        <div className={styles.empty}>차이가 없습니다.</div>
                      ) : (
                        <div className={styles.list}>
                          {diff.entries.map((entry) => (
                            <div
                              key={entry.key}
                              className={styles.listItem}
                              style={{
                                borderLeft: `4px solid ${
                                  entry.status === "added"
                                    ? "#22c55e"
                                    : entry.status === "removed"
                                      ? "#ef4444"
                                      : "#f59e0b"
                                }`,
                                paddingLeft: "0.75rem",
                              }}
                            >
                              <div className={styles.row}>
                                <strong>{entry.key}</strong>
                                <span className={styles.badge}>
                                  {entry.status === "added" ? "추가됨" : entry.status === "removed" ? "삭제됨" : "변경됨"}
                                </span>
                              </div>
                              {entry.status === "added" && entry.newField ? (
                                <div className={styles.muted}>
                                  타입: {entry.newField.type} · 라벨: {entry.newField.label} · 필수: {entry.newField.required ? "Y" : "N"}
                                </div>
                              ) : null}
                              {entry.status === "removed" && entry.oldField ? (
                                <div className={styles.muted}>
                                  타입: {entry.oldField.type} · 라벨: {entry.oldField.label} · 필수: {entry.oldField.required ? "Y" : "N"}
                                </div>
                              ) : null}
                              {entry.status === "changed" && entry.changedProps.length ? (
                                <div className={styles.muted}>
                                  변경된 속성: {entry.changedProps.join(", ")}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
