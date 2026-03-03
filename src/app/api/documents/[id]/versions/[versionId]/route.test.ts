import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    documentVersion: { findFirst: mockFindFirst },
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

describe("/api/documents/[id]/versions/[versionId]", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
  });

  it("returns version detail with docJson", async () => {
    const now = new Date();
    mockFindFirst.mockResolvedValue({
      id: "v1",
      documentId: "d1",
      label: "manual-save",
      docJson: '{"type":"doc","content":[]}',
      createdAt: now,
    });

    const res = await GET(
      new Request("http://localhost/api/documents/d1/versions/v1"),
      { params: Promise.resolve({ id: "d1", versionId: "v1" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("v1");
    expect(data.docJson).toContain("doc");
    expect(data.label).toBe("manual-save");
  });

  it("returns 404 for missing version", async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/documents/d1/versions/v999"),
      { params: Promise.resolve({ id: "d1", versionId: "v999" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    mockFindFirst.mockRejectedValue(new Error("DB error"));

    const res = await GET(
      new Request("http://localhost/api/documents/d1/versions/v1"),
      { params: Promise.resolve({ id: "d1", versionId: "v1" }) },
    );
    expect(res.status).toBe(500);
  });
});
