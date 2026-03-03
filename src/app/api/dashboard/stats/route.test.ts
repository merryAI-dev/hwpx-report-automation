import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to avoid "cannot access before initialization" errors
const {
  mockDocumentCount,
  mockDocumentVersionCount,
  mockAuditLogCount,
  mockAuditLogFindMany,
} = vi.hoisted(() => ({
  mockDocumentCount: vi.fn(),
  mockDocumentVersionCount: vi.fn(),
  mockAuditLogCount: vi.fn(),
  mockAuditLogFindMany: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    document: { count: mockDocumentCount },
    documentVersion: { count: mockDocumentVersionCount },
    auditLog: {
      count: mockAuditLogCount,
      findMany: mockAuditLogFindMany,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api-validation", () => ({
  checkRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { GET } from "./route";

function makeRequest(): Request {
  return new Request("http://localhost/api/dashboard/stats", {
    method: "GET",
  });
}

describe("/api/dashboard/stats", () => {
  beforeEach(() => {
    mockDocumentCount.mockReset();
    mockDocumentVersionCount.mockReset();
    mockAuditLogCount.mockReset();
    mockAuditLogFindMany.mockReset();
  });

  it("returns aggregated dashboard stats", async () => {
    const now = new Date();
    mockDocumentCount.mockResolvedValue(12);
    mockDocumentVersionCount.mockResolvedValue(35);
    mockAuditLogCount.mockResolvedValue(8);

    // Weekly audit logs
    mockAuditLogFindMany.mockImplementation((opts: { orderBy?: unknown; take?: number }) => {
      if (opts.take) {
        // recent logs query
        return Promise.resolve([
          {
            id: "log1",
            userEmail: "user@test.com",
            action: "ai-suggest",
            endpoint: "/api/suggest",
            createdAt: now,
          },
        ]);
      }
      // Week audit logs
      return Promise.resolve([
        { action: "ai-suggest", userEmail: "user@test.com", createdAt: now },
        { action: "ai-batch", userEmail: "user@test.com", createdAt: now },
        { action: "ai-verify", userEmail: "admin@test.com", createdAt: now },
      ]);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.totalDocuments).toBe(12);
    expect(json.totalVersions).toBe(35);
    expect(json.todayApiCalls).toBe(8);
    expect(json.weeklyActiveUsers).toBe(2);
    expect(json.aiCallsThisWeek).toBe(2); // ai-suggest + ai-batch
    expect(json.verifyCallsThisWeek).toBe(1);
    expect(json.actionBreakdown).toBeDefined();
    expect(json.dailyThroughput).toBeDefined();
    expect(json.recentActivity).toHaveLength(1);
  });

  it("returns empty arrays when no data", async () => {
    mockDocumentCount.mockResolvedValue(0);
    mockDocumentVersionCount.mockResolvedValue(0);
    mockAuditLogCount.mockResolvedValue(0);
    mockAuditLogFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.totalDocuments).toBe(0);
    expect(json.weeklyActiveUsers).toBe(0);
    expect(json.dailyThroughput).toEqual([]);
    expect(json.recentActivity).toEqual([]);
  });

  it("returns 500 on database error", async () => {
    mockDocumentCount.mockRejectedValue(new Error("DB connection failed"));
    mockDocumentVersionCount.mockRejectedValue(new Error("DB connection failed"));
    mockAuditLogCount.mockRejectedValue(new Error("DB connection failed"));
    mockAuditLogFindMany.mockRejectedValue(new Error("DB connection failed"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
