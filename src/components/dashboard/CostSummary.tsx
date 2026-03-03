"use client";

import { useEffect, useState } from "react";

type CostData = {
  weekly: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel: Record<string, number>;
    callCount: number;
  };
  monthly: {
    totalCostUsd: number;
    callCount: number;
  };
  dailyCosts: Array<{ date: string; costUsd: number }>;
};

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CostSummary() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/costs")
      .then(async (r) => {
        if (r.ok) {
          setData(await r.json());
        } else {
          setError("비용 데이터를 불러올 수 없습니다.");
        }
      })
      .catch(() => {
        setError("서버에 연결할 수 없습니다.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
        <div className="mb-3 h-4 w-24 animate-pulse rounded bg-[var(--color-notion-bg-active)]" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md bg-[var(--color-notion-bg-hover)]" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
        <h3 className="mb-2 text-sm font-semibold text-[var(--color-notion-text)]">AI 비용 추적</h3>
        <p className="text-sm text-[var(--color-notion-text-tertiary)]">{error || "데이터 없음"}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-notion-border)] bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-notion-text)]">AI 비용 추적</h3>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-md bg-[var(--color-notion-accent-light)] p-3">
          <p className="text-xs text-[var(--color-notion-accent)]">주간 비용</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-notion-text)]">
            {formatCost(data.weekly.totalCostUsd)}
          </p>
          <p className="text-[10px] text-[var(--color-notion-accent)]">{data.weekly.callCount}회 호출</p>
        </div>
        <div className="rounded-md bg-[var(--color-notion-bg-secondary)] p-3">
          <p className="text-xs text-[var(--color-notion-text-secondary)]">월간 비용</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-notion-text)]">
            {formatCost(data.monthly.totalCostUsd)}
          </p>
          <p className="text-[10px] text-[var(--color-notion-text-tertiary)]">{data.monthly.callCount}회 호출</p>
        </div>
        <div className="rounded-md bg-[var(--color-notion-bg-secondary)] p-3">
          <p className="text-xs text-[var(--color-notion-text-secondary)]">주간 입력 토큰</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-notion-text)]">
            {formatTokens(data.weekly.totalInputTokens)}
          </p>
        </div>
        <div className="rounded-md bg-[var(--color-notion-bg-secondary)] p-3">
          <p className="text-xs text-[var(--color-notion-text-secondary)]">주간 출력 토큰</p>
          <p className="mt-1 text-lg font-bold text-[var(--color-notion-text)]">
            {formatTokens(data.weekly.totalOutputTokens)}
          </p>
        </div>
      </div>

      {/* Model breakdown */}
      {Object.keys(data.weekly.byModel).length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-[var(--color-notion-text-secondary)]">모델별 비용</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.weekly.byModel).map(([model, cost]) => (
              <span
                key={model}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-notion-bg-hover)] px-2.5 py-1 text-xs"
              >
                <span className="text-[var(--color-notion-text)]">{model}</span>
                <span className="font-medium text-[var(--color-notion-accent)]">{formatCost(cost)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Daily cost mini chart */}
      {data.dailyCosts.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--color-notion-text-secondary)]">일별 비용 (최근 7일)</p>
          <div className="flex items-end gap-1" style={{ height: 60 }}>
            {data.dailyCosts.map((day) => {
              const max = Math.max(...data.dailyCosts.map((d) => d.costUsd), 0.001);
              const pct = (day.costUsd / max) * 100;
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-0.5">
                  <span className="text-[9px] text-[var(--color-notion-text-tertiary)]">{formatCost(day.costUsd)}</span>
                  <div
                    className="w-full rounded-t bg-[var(--color-notion-accent)]"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                  <span className="text-[9px] text-[var(--color-notion-text-tertiary)]">{day.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
