"use client";

type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
};

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
      <p className="text-sm font-medium text-[var(--color-notion-text-secondary)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--color-notion-text)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--color-notion-text-tertiary)]">{sub}</p>}
    </div>
  );
}

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

export function KpiCards({ stats }: { stats: DashboardStats }) {
  return (
    <div className="space-y-6">
      {/* KPI 카드 그리드 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="총 문서 수"
          value={stats.totalDocuments}
          sub={`${stats.totalVersions}개 버전`}
        />
        <KpiCard
          label="오늘 API 호출"
          value={stats.todayApiCalls}
        />
        <KpiCard
          label="주간 활성 사용자"
          value={stats.weeklyActiveUsers}
        />
        <KpiCard
          label="주간 AI 호출"
          value={stats.aiCallsThisWeek}
          sub={`검증 ${stats.verifyCallsThisWeek}회`}
        />
        <KpiCard
          label="AI 수락률"
          value={
            stats.aiCallsThisWeek > 0
              ? `${Math.round(
                  ((stats.aiCallsThisWeek - stats.verifyCallsThisWeek) /
                    stats.aiCallsThisWeek) *
                    100,
                )}%`
              : "N/A"
          }
          sub="검증 대비 추정"
        />
      </div>

      {/* 일별 처리량 */}
      <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-notion-text)]">일별 API 처리량 (최근 7일)</h3>
        <div className="flex items-end gap-2" style={{ height: 120 }}>
          {stats.dailyThroughput.map((day) => {
            const max = Math.max(...stats.dailyThroughput.map((d) => d.count), 1);
            const pct = (day.count / max) * 100;
            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-[var(--color-notion-text-secondary)]">{day.count}</span>
                <div
                  className="w-full rounded-t bg-[var(--color-notion-accent)]"
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
                <span className="text-[10px] text-[var(--color-notion-text-tertiary)]">
                  {day.date.slice(5)}
                </span>
              </div>
            );
          })}
          {stats.dailyThroughput.length === 0 && (
            <p className="text-sm text-[var(--color-notion-text-tertiary)]">데이터 없음</p>
          )}
        </div>
      </div>

      {/* 액션별 분포 */}
      <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-notion-text)]">액션별 분포</h3>
        <div className="flex flex-wrap gap-3">
          {Object.entries(stats.actionBreakdown).map(([action, count]) => (
            <span
              key={action}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-notion-bg-hover)] px-3 py-1 text-xs font-medium text-[var(--color-notion-text)]"
            >
              {action}
              <span className="text-[var(--color-notion-accent)]">{count}</span>
            </span>
          ))}
          {Object.keys(stats.actionBreakdown).length === 0 && (
            <p className="text-sm text-[var(--color-notion-text-tertiary)]">데이터 없음</p>
          )}
        </div>
      </div>

      {/* 최근 활동 */}
      <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-notion-text)]">최근 활동</h3>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--color-notion-border)] text-[var(--color-notion-text-secondary)]">
              <tr>
                <th className="pb-2 pr-4">시간</th>
                <th className="pb-2 pr-4">사용자</th>
                <th className="pb-2 pr-4">액션</th>
                <th className="pb-2">엔드포인트</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-notion-border)]">
              {stats.recentActivity.map((row) => (
                <tr key={row.id} className="text-[var(--color-notion-text-secondary)]">
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="py-1.5 pr-4">{row.userEmail}</td>
                  <td className="py-1.5 pr-4">
                    <span className="rounded bg-[var(--color-notion-accent-light)] px-1.5 py-0.5 text-[var(--color-notion-accent)]">
                      {row.action}
                    </span>
                  </td>
                  <td className="py-1.5 font-mono text-[var(--color-notion-text-tertiary)]">{row.endpoint}</td>
                </tr>
              ))}
              {stats.recentActivity.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-[var(--color-notion-text-tertiary)]">
                    활동 기록이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
