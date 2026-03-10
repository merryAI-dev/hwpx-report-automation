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
import type { WorkspaceComment } from "@/lib/server/comment-store";
import VersionDiffView from "@/components/editor/VersionDiffView";
import styles from "../../workspace.module.css";

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return "방금 전";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
  return `${Math.floor(diff / 86400000)}일 전`;
}

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
  const [previewBlobId, setPreviewBlobId] = useState<string | null>(null);
  const [diffPair, setDiffPair] = useState<[WorkspaceDocumentVersionSummary, WorkspaceDocumentVersionSummary] | null>(null);
  const [comments, setComments] = useState<WorkspaceComment[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSegmentId, setCommentSegmentId] = useState("");
  const [showSegmentInput, setShowSegmentInput] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);

  const loadComments = useCallback(async (includeResolved = false) => {
    try {
      const res = await fetch(`/api/documents/${documentId}/comments?includeResolved=${includeResolved}`, { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as { comments?: WorkspaceComment[] };
      setComments(payload.comments || []);
    } catch {
      setComments([]);
    }
  }, [documentId]);

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
      void loadComments(false);
    }
  }, [documentId, loadDocument, loadComments]);

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

  const onCreateComment = async () => {
    if (!commentBody.trim()) return;
    setCommentSaving(true);
    setCommentError("");
    try {
      const response = await fetch(`/api/documents/${documentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim(), segmentId: commentSegmentId.trim() || null }),
      });
      const payload = (await response.json().catch(() => ({}))) as { comment?: WorkspaceComment; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "댓글 작성 실패");
      }
      setCommentBody("");
      setCommentSegmentId("");
      setShowSegmentInput(false);
      await loadComments(showResolved);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "댓글 작성 실패");
    } finally {
      setCommentSaving(false);
    }
  };

  const onResolveComment = async (commentId: string) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/comments/${commentId}`, { method: "PATCH" });
      const payload = (await response.json().catch(() => ({}))) as { comment?: WorkspaceComment; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "댓글 해결 실패");
      }
      await loadComments(showResolved);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "댓글 해결 실패");
    }
  };

  const onDeleteComment = async (commentId: string) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/comments/${commentId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "댓글 삭제 실패");
      }
      await loadComments(showResolved);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "댓글 삭제 실패");
    }
  };

  const onToggleShowResolved = async () => {
    const next = !showResolved;
    setShowResolved(next);
    await loadComments(next);
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
                  {versions.map((version, index) => (
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
                          <button
                            type="button"
                            className={styles.inlineButton}
                            onClick={() => setPreviewBlobId(previewBlobId === version.blob.blobId ? null : version.blob.blobId)}
                          >
                            {previewBlobId === version.blob.blobId ? "미리보기 닫기" : "미리보기"}
                          </button>
                          {index < versions.length - 1 ? (
                            <button
                              type="button"
                              className={styles.inlineButton}
                              onClick={() => setDiffPair([versions[index + 1], version])}
                            >
                              버전 비교
                            </button>
                          ) : null}
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
                      {previewBlobId === version.blob.blobId && document ? (
                        <div style={{ display: "grid", gap: "8px" }}>
                          <div className={styles.row}>
                            <span className={styles.muted}>미리보기</span>
                            <a
                              className={styles.inlineButton}
                              href={`/api/preview/${version.blob.blobId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              새 창에서 보기
                            </a>
                          </div>
                          <iframe
                            src={`/api/preview/${version.blob.blobId}`}
                            title={`v${version.versionNumber} 미리보기`}
                            style={{
                              width: "100%",
                              minHeight: "600px",
                              border: "1px solid #e2e8f0",
                              borderRadius: "12px",
                              background: "#fff",
                            }}
                          />
                        </div>
                      ) : null}
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

            <section className={styles.panel}>
              <div className={styles.row}>
                <h2 className={styles.cardTitle}>댓글 {comments.length}개</h2>
                <button
                  type="button"
                  className={styles.inlineButton}
                  onClick={() => void onToggleShowResolved()}
                >
                  {showResolved ? "해결됨 숨기기" : "해결됨 보기"}
                </button>
              </div>
              {commentError ? <div className={styles.error}>{commentError}</div> : null}
              {!comments.length ? (
                <div className={styles.empty}>댓글이 없습니다.</div>
              ) : (
                <div className={styles.list}>
                  {comments.map((comment) => (
                    <div key={comment.id} className={styles.listItem}>
                      <div className={styles.row}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "28px",
                              height: "28px",
                              borderRadius: "50%",
                              background: "#6366f1",
                              color: "#fff",
                              fontSize: "12px",
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {comment.createdByDisplayName.charAt(0).toUpperCase()}
                          </span>
                          <strong>{comment.createdByDisplayName}</strong>
                          {comment.resolved ? (
                            <span className={`${styles.badge} ${styles.badgeReady}`}>해결됨</span>
                          ) : null}
                        </div>
                        <span className={styles.muted}>{relativeTime(comment.createdAt)}</span>
                      </div>
                      {comment.segmentId ? (
                        <span className={styles.code}>{comment.segmentId}</span>
                      ) : null}
                      <div style={{ fontSize: "14px", lineHeight: 1.6, textDecoration: comment.resolved ? "line-through" : "none", color: comment.resolved ? "#94a3b8" : "inherit" }}>
                        {comment.body}
                      </div>
                      <div className={styles.nav}>
                        {!comment.resolved ? (
                          <button
                            type="button"
                            className={styles.inlineButton}
                            onClick={() => void onResolveComment(comment.id)}
                          >
                            해결
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.inlineButton}
                          onClick={() => void onDeleteComment(comment.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.form}>
                <textarea
                  className={styles.textarea}
                  placeholder="댓글을 입력하세요..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={3}
                />
                <div>
                  <button
                    type="button"
                    className={styles.inlineButton}
                    onClick={() => setShowSegmentInput((prev) => !prev)}
                  >
                    {showSegmentInput ? "▲ 세그먼트 ID 숨기기" : "▼ 세그먼트 ID 입력 (선택)"}
                  </button>
                </div>
                {showSegmentInput ? (
                  <input
                    className={styles.input}
                    placeholder="세그먼트 ID (선택)"
                    value={commentSegmentId}
                    onChange={(e) => setCommentSegmentId(e.target.value)}
                  />
                ) : null}
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void onCreateComment()}
                  disabled={commentSaving || !commentBody.trim()}
                >
                  댓글 작성
                </button>
              </div>
            </section>
          </>
        ) : null}
      </div>
      {diffPair ? (
        <VersionDiffView
          leftVersion={diffPair[0]}
          rightVersion={diffPair[1]}
          onClose={() => setDiffPair(null)}
        />
      ) : null}
    </div>
  );
}
