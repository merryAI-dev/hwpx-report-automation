"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityCheckItem } from "@/lib/server/security-checklist";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import type { TenantMember, WorkspaceAccessRole } from "@/lib/workspace-types";
import styles from "./page.module.css";

type Tab = "members" | "quota" | "security";

type QuotaData = {
  maxDocuments: number;
  maxTemplates: number;
  maxBlobBytes: number;
  documentCount: number;
  templateCount: number;
  blobBytes: number;
  documentsOverLimit: boolean;
  templatesOverLimit: boolean;
  blobOverLimit: boolean;
};

type SessionInfo = {
  tenantRole: string | null;
  tenantId: string | null;
};

const ROLE_LABELS: Record<WorkspaceAccessRole, string> = {
  owner: "소유자",
  manager: "관리자",
  editor: "편집자",
  viewer: "뷰어",
};

const ROLE_OPTIONS: WorkspaceAccessRole[] = ["viewer", "editor", "manager", "owner"];

function roleBadgeClass(role: WorkspaceAccessRole, styles: Record<string, string>): string {
  if (role === "owner") return `${styles.roleBadge} ${styles.roleBadgeOwner}`;
  if (role === "manager") return `${styles.roleBadge} ${styles.roleBadgeManager}`;
  if (role === "editor") return `${styles.roleBadge} ${styles.roleBadgeEditor}`;
  return styles.roleBadge;
}

function bytesToGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

function gbToBytes(gb: number): number {
  return Math.round(gb * 1024 * 1024 * 1024);
}

function usagePercent(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("members");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Members state
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addDisplayName, setAddDisplayName] = useState("");
  const [addRole, setAddRole] = useState<WorkspaceAccessRole>("viewer");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Security state
  type SecurityCheckResult = SecurityCheckItem & { passed: boolean | null };
  const [securityChecks, setSecurityChecks] = useState<SecurityCheckResult[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);

  // Quota state
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaMaxDocs, setQuotaMaxDocs] = useState(100);
  const [quotaMaxTpls, setQuotaMaxTpls] = useState(20);
  const [quotaMaxGb, setQuotaMaxGb] = useState(5);
  const [quotaSaving, setQuotaSaving] = useState(false);

  // Load session
  useEffect(() => {
    fetch("/api/auth/session")
      .then(async (r) => {
        if (!r.ok) {
          setSession({ tenantRole: null, tenantId: null });
          return;
        }
        const data = await r.json() as { activeTenant?: { role?: string; tenantId?: string } };
        setSession({
          tenantRole: data.activeTenant?.role ?? null,
          tenantId: data.activeTenant?.tenantId ?? null,
        });
      })
      .catch(() => setSession({ tenantRole: null, tenantId: null }))
      .finally(() => setSessionLoading(false));
  }, []);

  const loadMembers = useCallback(() => {
    setMembersLoading(true);
    setMembersError(null);
    fetch("/api/admin/members")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json() as { error?: string };
          setMembersError(data.error ?? "구성원 목록을 불러오지 못했습니다.");
          return;
        }
        const data = await r.json() as { members: TenantMember[] };
        setMembers(data.members);
      })
      .catch(() => setMembersError("서버 연결 실패"))
      .finally(() => setMembersLoading(false));
  }, []);

  const loadSecurityChecks = useCallback(() => {
    setSecurityLoading(true);
    setSecurityError(null);
    fetch("/api/admin/security-check")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json() as { error?: string };
          setSecurityError(data.error ?? "보안 점검을 불러오지 못했습니다.");
          return;
        }
        const data = await r.json() as { checks: SecurityCheckResult[] };
        setSecurityChecks(data.checks);
      })
      .catch(() => setSecurityError("서버 연결 실패"))
      .finally(() => setSecurityLoading(false));
  }, []);

  const loadQuota = useCallback(() => {
    setQuotaLoading(true);
    setQuotaError(null);
    fetch("/api/admin/quota")
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json() as { error?: string };
          setQuotaError(data.error ?? "할당량 정보를 불러오지 못했습니다.");
          return;
        }
        const data = await r.json() as { quota: QuotaData };
        const q = data.quota;
        setQuota(q);
        setQuotaMaxDocs(q.maxDocuments);
        setQuotaMaxTpls(q.maxTemplates);
        setQuotaMaxGb(parseFloat(bytesToGb(q.maxBlobBytes)));
      })
      .catch(() => setQuotaError("서버 연결 실패"))
      .finally(() => setQuotaLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === "members") {
      loadMembers();
    } else if (activeTab === "quota") {
      loadQuota();
    } else if (activeTab === "security") {
      loadSecurityChecks();
    }
  }, [activeTab, loadMembers, loadQuota, loadSecurityChecks]);

  const handleAddMember = async () => {
    if (!addUserId.trim() || !addEmail.trim() || !addDisplayName.trim()) return;
    setAddSubmitting(true);
    try {
      const resp = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: addUserId.trim(),
          email: addEmail.trim(),
          displayName: addDisplayName.trim(),
          role: addRole,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        setMembersError(data.error ?? "구성원 추가 실패");
        return;
      }
      setAddUserId("");
      setAddEmail("");
      setAddDisplayName("");
      setAddRole("viewer");
      setShowAddForm(false);
      loadMembers();
    } catch {
      setMembersError("서버 연결 실패");
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("이 구성원을 삭제하시겠습니까?")) return;
    setRemovingId(userId);
    try {
      const resp = await fetch(`/api/admin/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        setMembersError(data.error ?? "삭제 실패");
        return;
      }
      loadMembers();
    } catch {
      setMembersError("서버 연결 실패");
    } finally {
      setRemovingId(null);
    }
  };

  const handleSaveQuota = async () => {
    setQuotaSaving(true);
    setQuotaError(null);
    try {
      const resp = await fetch("/api/admin/quota", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxDocuments: quotaMaxDocs,
          maxTemplates: quotaMaxTpls,
          maxBlobBytes: gbToBytes(quotaMaxGb),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json() as { error?: string };
        setQuotaError(data.error ?? "할당량 저장 실패");
        return;
      }
      loadQuota();
    } catch {
      setQuotaError("서버 연결 실패");
    } finally {
      setQuotaSaving(false);
    }
  };

  if (sessionLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.loading}>로딩 중...</div>
        </div>
      </div>
    );
  }

  const tenantRole = session?.tenantRole ?? null;
  const canAccess = tenantRole === "owner" || tenantRole === "manager";
  const isOwner = tenantRole === "owner";

  if (!canAccess) {
    return (
      <div className={styles.container}>
        <div className={styles.inner}>
          <div className={styles.header}>
            <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "관리자" }]} />
            <h1 className={styles.title}>관리자 패널</h1>
          </div>
          <div className={styles.accessDenied}>접근 권한이 없습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "관리자" }]} />
          <h1 className={styles.title}>관리자 패널</h1>
          <p className={styles.subtitle}>테넌트 구성원 및 할당량을 관리합니다.</p>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "members" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("members")}
          >
            구성원 관리
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "quota" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("quota")}
          >
            할당량 관리
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "security" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("security")}
          >
            보안 점검
          </button>
        </div>

        {activeTab === "members" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>구성원 목록</h2>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setShowAddForm((v) => !v)}
              >
                구성원 추가
              </button>
            </div>

            {membersError && <div className={styles.errorMsg}>{membersError}</div>}

            {membersLoading ? (
              <div className={styles.loading}>로딩 중...</div>
            ) : members.length === 0 ? (
              <div className={styles.emptyState}>구성원이 없습니다.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>역할</th>
                    <th>추가일</th>
                    {isOwner && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>{member.displayName}</td>
                      <td>{member.email}</td>
                      <td>
                        <span className={roleBadgeClass(member.role, styles as Record<string, string>)}>
                          {ROLE_LABELS[member.role] ?? member.role}
                        </span>
                      </td>
                      <td>{new Date(member.addedAt).toLocaleDateString("ko-KR")}</td>
                      {isOwner && (
                        <td>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            disabled={removingId === member.userId}
                            onClick={() => void handleRemoveMember(member.userId)}
                          >
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {showAddForm && (
              <div className={styles.addForm}>
                <p className={styles.addFormTitle}>구성원 추가</p>
                <div className={styles.formGrid}>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>사용자 ID</label>
                    <input
                      className={styles.formInput}
                      type="text"
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                      placeholder="user-id"
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>이메일</label>
                    <input
                      className={styles.formInput}
                      type="email"
                      value={addEmail}
                      onChange={(e) => setAddEmail(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>이름</label>
                    <input
                      className={styles.formInput}
                      type="text"
                      value={addDisplayName}
                      onChange={(e) => setAddDisplayName(e.target.value)}
                      placeholder="홍길동"
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>역할</label>
                    <select
                      className={styles.formInput}
                      value={addRole}
                      onChange={(e) => setAddRole(e.target.value as WorkspaceAccessRole)}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setShowAddForm(false)}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={addSubmitting || !addUserId.trim() || !addEmail.trim() || !addDisplayName.trim()}
                    onClick={() => void handleAddMember()}
                  >
                    {addSubmitting ? "추가 중..." : "추가"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "quota" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>할당량 설정</h2>
            </div>

            {quotaError && <div className={styles.errorMsg}>{quotaError}</div>}

            {quotaLoading ? (
              <div className={styles.loading}>로딩 중...</div>
            ) : (
              <>
                <div className={styles.quotaGrid}>
                  <div className={styles.quotaField}>
                    <label className={styles.quotaLabel}>최대 문서 수</label>
                    <input
                      className={styles.quotaInput}
                      type="number"
                      min={0}
                      value={quotaMaxDocs}
                      onChange={(e) => setQuotaMaxDocs(Math.max(0, Number(e.target.value)))}
                    />
                    {quota && (
                      <>
                        <p className={styles.quotaHint}>
                          현재: {quota.documentCount} / {quota.maxDocuments}개
                        </p>
                        <div className={styles.usageBar}>
                          <div
                            className={`${styles.usageBarFill} ${quota.documentsOverLimit ? styles.usageBarFillOver : ""}`}
                            style={{ width: `${usagePercent(quota.documentCount, quota.maxDocuments)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <div className={styles.quotaField}>
                    <label className={styles.quotaLabel}>최대 템플릿 수</label>
                    <input
                      className={styles.quotaInput}
                      type="number"
                      min={0}
                      value={quotaMaxTpls}
                      onChange={(e) => setQuotaMaxTpls(Math.max(0, Number(e.target.value)))}
                    />
                    {quota && (
                      <>
                        <p className={styles.quotaHint}>
                          현재: {quota.templateCount} / {quota.maxTemplates}개
                        </p>
                        <div className={styles.usageBar}>
                          <div
                            className={`${styles.usageBarFill} ${quota.templatesOverLimit ? styles.usageBarFillOver : ""}`}
                            style={{ width: `${usagePercent(quota.templateCount, quota.maxTemplates)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <div className={styles.quotaField}>
                    <label className={styles.quotaLabel}>최대 스토리지 (GB)</label>
                    <input
                      className={styles.quotaInput}
                      type="number"
                      min={0}
                      step={0.1}
                      value={quotaMaxGb}
                      onChange={(e) => setQuotaMaxGb(Math.max(0, Number(e.target.value)))}
                    />
                    {quota && (
                      <>
                        <p className={styles.quotaHint}>
                          현재: {bytesToGb(quota.blobBytes)} GB / {bytesToGb(quota.maxBlobBytes)} GB
                        </p>
                        <div className={styles.usageBar}>
                          <div
                            className={`${styles.usageBarFill} ${quota.blobOverLimit ? styles.usageBarFillOver : ""}`}
                            style={{ width: `${usagePercent(quota.blobBytes, quota.maxBlobBytes)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={quotaSaving}
                    onClick={() => void handleSaveQuota()}
                  >
                    {quotaSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {activeTab === "security" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>보안 점검</h2>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={loadSecurityChecks}
              >
                새로고침
              </button>
            </div>

            {securityError && <div className={styles.errorMsg}>{securityError}</div>}

            {securityLoading ? (
              <div className={styles.loading}>로딩 중...</div>
            ) : securityChecks.length === 0 ? (
              <div className={styles.emptyState}>점검 항목이 없습니다.</div>
            ) : (
              <ul className={styles.securityList}>
                {securityChecks.map((item) => {
                  const icon = item.passed === true ? "✅" : item.passed === false ? "❌" : "⚪";
                  return (
                    <li key={item.id} className={`${styles.securityItem} ${styles[`securitySeverity_${item.severity}`] ?? ""}`}>
                      <span className={styles.securityIcon}>{icon}</span>
                      <div className={styles.securityBody}>
                        <span className={styles.securityLabel}>{item.label}</span>
                        <span className={`${styles.severityBadge} ${styles[`severityBadge_${item.severity}`] ?? ""}`}>
                          {item.severity}
                        </span>
                        <p className={styles.securityDesc}>{item.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
