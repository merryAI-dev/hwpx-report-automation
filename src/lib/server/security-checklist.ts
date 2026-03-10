export type SecurityCheckItem = {
  id: string;
  category: "auth" | "storage" | "api" | "config" | "ops";
  label: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  checkFn?: () => boolean;
};

export const SECURITY_CHECKLIST: SecurityCheckItem[] = [
  // Auth
  { id: "nextauth-secret", category: "auth", severity: "critical", label: "NEXTAUTH_SECRET 설정", description: "무작위 32자 이상 시크릿으로 설정하세요.", checkFn: () => !!process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET !== "change-me-to-a-random-32-char-string" },
  { id: "nextauth-url", category: "auth", severity: "high", label: "NEXTAUTH_URL 설정", description: "배포 도메인으로 정확히 설정하세요.", checkFn: () => !!process.env.NEXTAUTH_URL },
  // Storage
  { id: "blob-root-not-default", category: "storage", severity: "high", label: "Blob 저장소 경로 설정", description: "기본값 .blob-storage 가 아닌 외부 볼륨을 사용하세요 (프로덕션).", checkFn: () => process.env.NODE_ENV !== "production" || (process.env.BLOB_STORAGE_FS_ROOT || ".blob-storage") !== ".blob-storage" },
  { id: "s3-not-public", category: "storage", severity: "critical", label: "S3 버킷 공개 차단", description: "S3 버킷의 퍼블릭 액세스 차단 설정을 확인하세요.", },
  // API
  { id: "api-key-rotation", category: "api", severity: "medium", label: "API 키 주기적 교체", description: "Anthropic/OpenAI API 키를 분기마다 교체하세요.", },
  { id: "rate-limiting", category: "api", severity: "high", label: "Rate Limiting 설정", description: "Edge/CDN 레이어에서 API Rate Limiting을 설정하세요.", },
  // Config
  { id: "node-env-production", category: "config", severity: "critical", label: "NODE_ENV=production", description: "프로덕션 빌드에서 NODE_ENV를 production으로 설정하세요.", checkFn: () => process.env.NODE_ENV === "production" },
  { id: "no-debug-logs", category: "config", severity: "medium", label: "디버그 로그 비활성화", description: "프로덕션에서 DEBUG, VERBOSE 로그를 비활성화하세요.", },
  // Ops
  { id: "health-monitoring", category: "ops", severity: "high", label: "헬스체크 모니터링", description: "/api/health 엔드포인트를 외부 모니터링 도구에 등록하세요.", },
  { id: "backup-policy", category: "ops", severity: "high", label: "Blob 스토리지 백업", description: "일 1회 이상 Blob 스토리지를 백업하세요.", },
  { id: "audit-log-retention", category: "ops", severity: "medium", label: "감사 로그 보관", description: "감사 로그를 최소 90일 이상 보관하세요.", },
];

export function runSecurityChecks(): Array<SecurityCheckItem & { passed: boolean | null }> {
  return SECURITY_CHECKLIST.map((item) => ({
    ...item,
    passed: item.checkFn ? item.checkFn() : null,
  }));
}
