"use client";

import { useEffect, useState } from "react";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { AuditLogViewer } from "@/components/dashboard/AuditLogViewer";
import { CostSummary } from "@/components/dashboard/CostSummary";
import { ServiceHealth } from "@/components/dashboard/ServiceHealth";
import { Breadcrumb } from "@/components/common/Breadcrumb";

type DashboardStats = {
  totalDocuments: number;
  totalVersions: number;
  todayApiCalls: number;
  weeklyActiveUsers: number;
  aiCallsThisWeek: number;
  verifyCallsThisWeek: number;
  actionBreakdown: Record<string, number>;
  dailyThroughput: Array<{ date: string; count: number }>;
  recentActivity: Array<{
    id: string;
    userEmail: string;
    action: string;
    endpoint: string;
    createdAt: string;
  }>;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then(async (resp) => {
        if (!resp.ok) throw new Error("통계 로드 실패");
        return resp.json();
      })
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl">
        <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "대시보드" }]} />
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">운영 대시보드</h1>
            <p className="mt-1 text-sm text-gray-500">
              시스템 사용 현황과 AI 활용 지표를 확인합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              fetch("/api/dashboard/stats")
                .then(async (resp) => {
                  if (!resp.ok) throw new Error("통계 로드 실패");
                  return resp.json();
                })
                .then(setStats)
                .catch((err) => setError(err.message))
                .finally(() => setLoading(false));
            }}
            disabled={loading}
            className="rounded bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            {loading ? "로딩..." : "새로고침"}
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-500">통계를 불러오는 중...</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {stats && <KpiCards stats={stats} />}

        {/* Service Health + Cost Summary side by side */}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <ServiceHealth />
          <CostSummary />
        </div>

        {/* Audit Log */}
        <div className="mt-6">
          <AuditLogViewer />
        </div>
      </div>
    </div>
  );
}
