import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindMany, mockCount } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    auditLog: {
      findMany: mockFindMany,
      count: mockCount,
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

describe("/api/dashboard/audit-log", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockCount.mockReset();
  });

  it("returns paginated audit log entries", async () => {
    const now = new Date();
    mockFindMany.mockResolvedValue([
      {
        id: "log1",
        userEmail: "admin@example.com",
        action: "ai-suggest",
        endpoint: "/api/suggest",
        details: "{}",
        createdAt: now,
      },
    ]);
    mockCount.mockResolvedValue(1);

    const res = await GET(new Request("http://localhost/api/dashboard/audit-log"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].action).toBe("ai-suggest");
    expect(data.total).toBe(1);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBe(1);
  });

  it("supports action filter", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const res = await GET(
      new Request("http://localhost/api/dashboard/audit-log?action=ai-chat"),
    );
    expect(res.status).toBe(200);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "ai-chat" },
      }),
    );
  });

  it("supports pagination params", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(100);

    const res = await GET(
      new Request("http://localhost/api/dashboard/audit-log?page=3&limit=10"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.page).toBe(3);
    expect(data.limit).toBe(10);
    expect(data.totalPages).toBe(10);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it("clamps limit to 100 max", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await GET(new Request("http://localhost/api/dashboard/audit-log?limit=999"));
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("defaults page to 1 for invalid values", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const res = await GET(
      new Request("http://localhost/api/dashboard/audit-log?page=-5"),
    );
    const data = await res.json();
    expect(data.page).toBe(1);
  });

  it("returns 500 on database error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB down"));
    mockCount.mockRejectedValue(new Error("DB down"));

    const res = await GET(new Request("http://localhost/api/dashboard/audit-log"));
    expect(res.status).toBe(500);
  });
});
