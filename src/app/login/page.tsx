"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionTenantMembership } from "@/lib/auth/session";
import styles from "./page.module.css";

type PublicProvider = {
  id: string;
  type: "password" | "oidc" | "saml";
  displayName: string;
  issuer?: string | null;
  authorizationPath: string | null;
};

type ProviderPayload = {
  providers: PublicProvider[];
  tenantCatalog: SessionTenantMembership[];
};

function normalizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function mapLoginError(code: string | null): string {
  switch (code) {
    case "oidc_state":
      return "SSO 상태 검증에 실패했습니다. 다시 시도하세요.";
    case "oidc_callback":
      return "SSO 콜백을 처리하지 못했습니다. provider 설정과 seed를 확인하세요.";
    default:
      return "";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => normalizeNextPath(searchParams.get("next")), [searchParams]);
  const queryError = useMemo(() => mapLoginError(searchParams.get("error")), [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [tenantCatalog, setTenantCatalog] = useState<SessionTenantMembership[]>([]);
  const [error, setError] = useState(queryError);
  const [isSubmitting, setSubmitting] = useState(false);
  const [providerLoading, setProviderLoading] = useState(true);

  useEffect(() => {
    setError(queryError);
  }, [queryError]);

  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      try {
        const response = await fetch("/api/auth/providers");
        const payload = (await response.json().catch(() => ({}))) as Partial<ProviderPayload>;
        if (!response.ok || cancelled) {
          return;
        }
        setProviders(Array.isArray(payload.providers) ? payload.providers : []);
        const nextCatalog = Array.isArray(payload.tenantCatalog) ? payload.tenantCatalog : [];
        setTenantCatalog(nextCatalog);
        setTenantId((current) => current || nextCatalog[0]?.tenantId || "");
      } finally {
        if (!cancelled) {
          setProviderLoading(false);
        }
      }
    };

    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const oidcProviders = providers.filter((provider) => provider.type === "oidc" && provider.authorizationPath);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, tenantId }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "로그인에 실패했습니다.");
        return;
      }

      router.push(nextPath);
      router.refresh();
    } catch {
      setError("로그인 요청을 처리하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.header}>
          <p className={styles.eyebrow}>HWPX Editor</p>
          <h1 className={styles.title}>로그인</h1>
          <p className={styles.subtitle}>
            인증된 사용자만 편집기와 AI API에 접근할 수 있습니다. OIDC provider와 tenant seed가 설정되면
            아래 SSO 버튼으로도 진입할 수 있습니다.
          </p>
        </div>

        {oidcProviders.length ? (
          <div className={styles.ssoSection}>
            <p className={styles.sectionTitle}>SSO</p>
            <div className={styles.oidcList}>
              {oidcProviders.map((provider) => (
                <a
                  key={provider.id}
                  className={styles.oidcButton}
                  href={`${provider.authorizationPath}?next=${encodeURIComponent(nextPath)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}`}
                >
                  {provider.displayName}로 계속
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.sectionDivider}>또는 비밀번호 로그인</div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label}>
            이메일
            <input
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              required
            />
          </label>

          <label className={styles.label}>
            비밀번호
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {tenantCatalog.length > 0 ? (
            <label className={styles.label}>
              활성 테넌트
              <select
                className={styles.input}
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
              >
                {tenantCatalog.map((tenant) => (
                  <option key={tenant.tenantId} value={tenant.tenantId}>
                    {tenant.tenantName} · {tenant.role}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <button className={styles.submit} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className={styles.seedSection}>
          <p className={styles.sectionTitle}>Tenant Seed</p>
          <p className={styles.infoNote}>
            {providerLoading
              ? "provider/tenant 설정을 불러오는 중입니다."
              : tenantCatalog.length
                ? "현재 seed에 등록된 tenant 카탈로그입니다."
                : "tenant seed가 아직 설정되지 않았습니다."}
          </p>
          <div className={styles.tenantList}>
            {tenantCatalog.map((tenant) => (
              <span key={tenant.tenantId} className={styles.tenantChip}>
                {tenant.tenantName} · {tenant.role}
              </span>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
