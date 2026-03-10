import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    auditLog: {
      findMany: mockFindMany,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api-validation", () => ({
  checkRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { GET } from "./route";

function makeLogEntry(
  costUsd: number,
  model = "gpt-4.1-mini",
  daysAgo = 1,
): { details: string; action: string; createdAt: Date } {
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    details: JSON.stringify({ costUsd, model, inputTokens: 100, outputTokens: 50 }),
    action: "ai-suggest",
    createdAt,
  };
}

describe("/api/dashboard/costs", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns weekly and monthly cost summaries", async () => {
    const entries = [makeLogEntry(0.01), makeLogEntry(0.02)];
    // First call = weekLogs, second = monthLogs
    mockFindMany.mockResolvedValueOnce(entries).mockResolvedValueOnce(entries);

    const res = await GET(new Request("http://localhost/api/dashboard/costs"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.weekly).toBeDefined();
    expect(data.monthly).toBeDefined();
    expect(data.weekly.callCount).toBe(2);
    expect(data.monthly.callCount).toBe(2);
    expect(data.weekly.totalCostUsd).toBeGreaterThan(0);
    expect(data.monthly.totalCostUsd).toBeGreaterThan(0);
  });

  it("returns daily cost breakdown sorted by date", async () => {
    const entries = [
      makeLogEntry(0.05, "gpt-4.1-mini", 2),
      makeLogEntry(0.03, "gpt-4.1-mini", 2),
      makeLogEntry(0.10, "gpt-4.1-mini", 1),
    ];
    mockFindMany.mockResolvedValueOnce(entries).mockResolvedValueOnce(entries);

    const res = await GET(new Request("http://localhost/api/dashboard/costs"));
    const data = await res.json();

    expect(data.dailyCosts).toHaveLength(2);
    // Should be sorted by date ascending
    expect(data.dailyCosts[0].date < data.dailyCosts[1].date).toBe(true);
    // Day with 2 entries should have combined cost
    expect(data.dailyCosts[0].costUsd).toBeCloseTo(0.08, 4);
    expect(data.dailyCosts[1].costUsd).toBeCloseTo(0.10, 4);
  });

  it("handles empty audit logs gracefully", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost/api/dashboard/costs"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.weekly.callCount).toBe(0);
    expect(data.weekly.totalCostUsd).toBe(0);
    expect(data.monthly.callCount).toBe(0);
    expect(data.monthly.totalCostUsd).toBe(0);
    expect(data.dailyCosts).toEqual([]);
  });

  it("skips entries with malformed JSON details", async () => {
    const entries = [
      { details: "not-json", action: "ai-suggest", createdAt: new Date() },
      makeLogEntry(0.05),
    ];
    mockFindMany.mockResolvedValueOnce(entries).mockResolvedValueOnce(entries);

    const res = await GET(new Request("http://localhost/api/dashboard/costs"));
    expect(res.status).toBe(200);
    const data = await res.json();

    // Should not crash; daily costs only includes the valid entry
    expect(data.dailyCosts.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 500 on database error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));

    const res = await GET(new Request("http://localhost/api/dashboard/costs"));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
