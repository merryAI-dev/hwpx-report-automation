"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  WorkspaceAuditEvent,
  WorkspaceDocumentDetail,
  WorkspaceDocumentVersionSummary,
  WorkspacePermissionEntry,
} from "@/lib/workspace-types";
import styles from "../../workspace.module.css";

function badgeClass(status: WorkspaceDocumentDetail["status"]): string {
  if (status === "ready") return `${styles.badge} ${styles.badgeReady}`;
  if (status === "archived") return `${styles.badge} ${styles.badgeArchived}`;
  return `${styles.badge} ${styles.badgeDraft}`;
}

export default function DocumentDetailPage() {
  const params = useParams<{ documentId: string }>();
  const router = useRouter();
  const documentId = String(params.documentId || "");
  const [document, setDocument] = useState<WorkspaceDocumentDetail | null>(null);
  const [versions, setVersions] = useState<WorkspaceDocumentVersionSummary[]>([]);
  const [events, setEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [statusInput, setStatusInput] = useState<WorkspaceDocumentDetail["status"]>("draft");
  const [newPermission, setNewPermission] = useState<WorkspacePermissionEntry>({
    subjectType: "user",
    subjectId: "",
    displayName: "",
    role: "viewer",
  });

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [documentResponse, versionsResponse, auditResponse] = await Promise.all([
        fetch(`/api/documents/${documentId}`, { cache: "no-store" }),
        fetch(`/api/documents/${documentId}/versions`, { cache: "no-store" }),
        fetch(`/api/documents/${documentId}/audit`, { cache: "no-store" }),
      ]);
      const documentPayload = (await documentResponse.json().catch(() => ({}))) as { document?: WorkspaceDocumentDetail; error?: string };
      const versionsPayload = (await versionsResponse.json().catch(() => ({}))) as { versions?: WorkspaceDocumentVersionSummary[]; error?: string };
      const auditPayload = (await auditResponse.json().catch(() => ({}))) as { events?: WorkspaceAuditEvent[]; error?: string };
      if (!documentResponse.ok) {
        throw new Error(documentPayload.error || "문서를 불러오지 못했습니다.");
      }
      setDocument(documentPayload.document || null);
      setTitleInput(documentPayload.document?.title || "");
      setStatusInput(documentPayload.document?.status || "draft");
      setVersions(versionsPayload.versions || []);
      setEvents(auditPayload.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (documentId) {
      void loadDocument();
    }
  }, [documentId, loadDocument]);

  const onSaveMetadata = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleInput, status: statusInput }),
      });
      const payload = (await response.json().catch(() => ({}))) as { document?: WorkspaceDocumentDetail; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "문서 메타데이터 저장 실패");
      }
      setDocument(payload.document || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문서 메타데이터 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const onDuplicate = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as { document?: WorkspaceDocumentDetail; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "문서 복제 실패");
      }
      if (payload.document?.id) {
        router.push(`/documents/${payload.document.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "문서 복제 실패");
    } finally {
      setSaving(false);
    }
  };

  const onRestoreVersion = async (versionId: string) => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/versions/${versionId}/restore`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { version?: WorkspaceDocumentVersionSummary; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "버전 복원 실패");
      }
      await loadDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "버전 복원 실패");
    } finally {
      setSaving(false);
    }
  };

  const onAddPermission = async () => {
    if (!document) return;
    setSaving(true);
    setError("");
    try {
      const permissions = [
        ...document.permissions,
        { ...newPermission, subjectId: newPermission.subjectId.trim(), displayName: newPermission.displayName.trim() || newPermission.subjectId.trim() },
      ].filter((entry) => entry.subjectId);
      const response = await fetch(`/api/documents/${documentId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      const payload = (await response.json().catch(() => ({}))) as { document?: WorkspaceDocumentDetail; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "권한 업데이트 실패");
      }
      setDocument(payload.document || null);
      setNewPermission({ subjectType: "user", subjectId: "", displayName: "", role: "viewer" });
      await loadDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "권한 업데이트 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.kicker}>Document Detail</div>
            <h1 className={styles.title}>{document?.title || "문서 상세"}</h1>
            <p className={styles.subtitle}>버전 이력, 권한, 감사 로그를 한 화면에서 관리합니다.</p>
          </div>
          <div className={styles.nav}>
            <Link className={styles.navLink} href="/documents">문서함</Link>
            {document ? <Link className={styles.primaryLink} href={`/?documentId=${document.id}`}>편집 열기</Link> : null}
            {document ? <button type="button" className={styles.secondaryButton} onClick={() => void onDuplicate()} disabled={saving}>복제</button> : null}
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <div className={styles.empty}>문서 상세를 불러오는 중입니다.</div> : null}
        {!loading && !document ? <div className={styles.empty}>문서를 찾지 못했습니다.</div> : null}

        {document ? (
          <>
            <section className={styles.panel}>
              <div className={styles.row}>
                <div className={styles.badgeRow}>
                  <span className={badgeClass(document.status)}>{document.status}</span>
                  <span className={styles.badge}>{document.sourceFormat.toUpperCase()}</span>
                  <span className={styles.badge}>v{document.currentVersionNumber}</span>
                </div>
                <div className={styles.muted}>생성 {new Date(document.createdAt).toLocaleString("ko-KR")}</div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <label className={styles.label}>제목</label>
                  <input className={styles.input} value={titleInput} onChange={(event) => setTitleInput(event.target.value)} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>상태</label>
                  <select className={styles.select} value={statusInput} onChange={(event) => setStatusInput(event.target.value as WorkspaceDocumentDetail["status"])}>
                    <option value="draft">draft</option>
                    <option value="ready">ready</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
              </div>
              <div className={styles.nav}>
                <button type="button" className={styles.primaryButton} onClick={() => void onSaveMetadata()} disabled={saving}>메타데이터 저장</button>
                {document.currentVersion?.download ? (
                  <a className={styles.navLink} href={document.currentVersion.download.downloadUrl}>현재 버전 다운로드</a>
                ) : null}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.row}>
                <h2 className={styles.cardTitle}>권한</h2>
                <span className={styles.muted}>현재 {document.permissions.length}명</span>
              </div>
              <div className={styles.list}>
                {document.permissions.map((entry) => (
                  <div key={entry.subjectId} className={styles.listItem}>
                    <div className={styles.row}>
                      <strong>{entry.displayName}</strong>
                      <span className={styles.badge}>{entry.role}</span>
                    </div>
                    <div className={styles.code}>{entry.subjectId}</div>
                  </div>
                ))}
              </div>
              <div className={styles.formRow}>
                <input className={styles.input} placeholder="사용자 ID" value={newPermission.subjectId} onChange={(event) => setNewPermission((prev) => ({ ...prev, subjectId: event.target.value }))} />
                <input className={styles.input} placeholder="표시 이름" value={newPermission.displayName} onChange={(event) => setNewPermission((prev) => ({ ...prev, displayName: event.target.value }))} />
                <select className={styles.select} value={newPermission.role} onChange={(event) => setNewPermission((prev) => ({ ...prev, role: event.target.value as WorkspacePermissionEntry["role"] }))}>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="manager">manager</option>
                </select>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => void onAddPermission()} disabled={saving}>권한 추가</button>
            </section>

            <section className={styles.panel}>
              <div className={styles.row}>
                <h2 className={styles.cardTitle}>버전 이력</h2>
                <span className={styles.muted}>{versions.length}개 버전</span>
              </div>
              {!versions.length ? <div className={styles.empty}>저장된 버전이 없습니다.</div> : (
                <div className={styles.list}>
                  {versions.map((version) => (
                    <div key={version.id} className={styles.listItem}>
                      <div className={styles.row}>
                        <strong>v{version.versionNumber} · {version.label}</strong>
                        <span className={styles.muted}>{new Date(version.createdAt).toLocaleString("ko-KR")}</span>
                      </div>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>필드 {version.templateFieldCount}</span>
                        <span className={styles.badge}>경고 {version.validationSummary?.warningCount || 0}</span>
                        <span className={styles.badge}>차단 {version.validationSummary?.blockingCount || 0}</span>
                        {document && version.id !== document.currentVersionId ? (
                          <span className={styles.badge}>이전 버전</span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeReady}`}>현재</span>
                        )}
                      </div>
                      <div className={styles.row}>
                        <span className={styles.code}>{version.fileName}</span>
                        <div className={styles.nav}>
                          {version.download ? <a className={styles.navLink} href={version.download.downloadUrl}>다운로드</a> : null}
                          {document && version.id !== document.currentVersionId ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() => void onRestoreVersion(version.id)}
                              disabled={saving}
                            >
                              복원
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.row}>
                <h2 className={styles.cardTitle}>감사 로그</h2>
                <span className={styles.muted}>{events.length}개 이벤트</span>
              </div>
              {!events.length ? <div className={styles.empty}>감사 로그가 없습니다.</div> : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>시간</th>
                      <th>이벤트</th>
                      <th>사용자</th>
                      <th>메타데이터</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>{new Date(event.createdAt).toLocaleString("ko-KR")}</td>
                        <td>{event.eventType}</td>
                        <td>{event.actor.displayName}</td>
                        <td><span className={styles.code}>{JSON.stringify(event.metadata)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
