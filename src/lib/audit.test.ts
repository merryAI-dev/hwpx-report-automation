import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    auditLog: {
      create: mockCreate,
      findMany: mockFindMany,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { recordAudit, getRecentAuditLogs } from "./audit";

describe("recordAudit", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("creates an audit log entry with correct data", () => {
    mockCreate.mockReturnValue({ catch: vi.fn() });
    recordAudit("user@test.com", "ai-suggest", "/api/suggest", {
      model: "gpt-4.1-mini",
      costUsd: 0.001,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        userEmail: "user@test.com",
        action: "ai-suggest",
        endpoint: "/api/suggest",
        details: JSON.stringify({ model: "gpt-4.1-mini", costUsd: 0.001 }),
      },
    });
  });

  it("serializes empty details as '{}'", () => {
    mockCreate.mockReturnValue({ catch: vi.fn() });
    recordAudit("user@test.com", "ai-chat", "/api/chat");

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ details: "{}" }),
    });
  });

  it("does not throw on DB error (fire-and-forget)", () => {
    const catchFn = vi.fn();
    mockCreate.mockReturnValue({ catch: catchFn });

    expect(() => {
      recordAudit("user@test.com", "ai-verify", "/api/verify");
    }).not.toThrow();

    // The catch handler should be registered
    expect(catchFn).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("getRecentAuditLogs", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns formatted audit log entries", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    mockFindMany.mockResolvedValueOnce([
      {
        id: "log-1",
        userEmail: "user@test.com",
        action: "ai-suggest",
        endpoint: "/api/suggest",
        details: '{"costUsd":0.001}',
        createdAt: now,
      },
    ]);

    const logs = await getRecentAuditLogs({ limit: 10 });
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe("log-1");
    expect(logs[0].createdAt).toBe("2026-01-15T12:00:00.000Z");
  });

  it("applies filter by userEmail", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getRecentAuditLogs({ userEmail: "admin@test.com" });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userEmail: "admin@test.com" },
      }),
    );
  });

  it("applies filter by action", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getRecentAuditLogs({ action: "ai-chat" });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: "ai-chat" },
      }),
    );
  });

  it("defaults to limit 100", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getRecentAuditLogs();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("uses custom limit", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await getRecentAuditLogs({ limit: 5 });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });
});
