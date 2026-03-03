"use client";

type KpiCardProps = {
  label: string;
  value: string | number;
  sub?: string;
};

function KpiCard({ label, value, sub }: KpiCardProps) {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
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
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">일별 API 처리량 (최근 7일)</h3>
        <div className="flex items-end gap-2" style={{ height: 120 }}>
          {stats.dailyThroughput.map((day) => {
            const max = Math.max(...stats.dailyThroughput.map((d) => d.count), 1);
            const pct = (day.count / max) * 100;
            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-gray-500">{day.count}</span>
                <div
                  className="w-full rounded-t bg-blue-500"
                  style={{ height: `${Math.max(pct, 4)}%` }}
                />
                <span className="text-[10px] text-gray-400">
                  {day.date.slice(5)}
                </span>
              </div>
            );
          })}
          {stats.dailyThroughput.length === 0 && (
            <p className="text-sm text-gray-400">데이터 없음</p>
          )}
        </div>
      </div>

      {/* 액션별 분포 */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">액션별 분포</h3>
        <div className="flex flex-wrap gap-3">
          {Object.entries(stats.actionBreakdown).map(([action, count]) => (
            <span
              key={action}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
            >
              {action}
              <span className="text-blue-600">{count}</span>
            </span>
          ))}
          {Object.keys(stats.actionBreakdown).length === 0 && (
            <p className="text-sm text-gray-400">데이터 없음</p>
          )}
        </div>
      </div>

      {/* 최근 활동 */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">최근 활동</h3>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b text-gray-500">
              <tr>
                <th className="pb-2 pr-4">시간</th>
                <th className="pb-2 pr-4">사용자</th>
                <th className="pb-2 pr-4">액션</th>
                <th className="pb-2">엔드포인트</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.recentActivity.map((row) => (
                <tr key={row.id} className="text-gray-600">
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
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                      {row.action}
                    </span>
                  </td>
                  <td className="py-1.5 font-mono text-gray-400">{row.endpoint}</td>
                </tr>
              ))}
              {stats.recentActivity.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-400">
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
