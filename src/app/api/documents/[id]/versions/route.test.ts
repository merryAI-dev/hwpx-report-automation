import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockVersionFindMany,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockVersionFindMany: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    document: {
      findUnique: mockFindUnique,
    },
    documentVersion: {
      findMany: mockVersionFindMany,
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

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/documents/[id]/versions", () => {
  const now = new Date();

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockVersionFindMany.mockReset();
  });

  it("returns versions for a document", async () => {
    mockFindUnique.mockResolvedValue({ id: "doc1" });
    mockVersionFindMany.mockResolvedValue([
      { id: "v1", documentId: "doc1", label: "초안", createdAt: now },
      { id: "v2", documentId: "doc1", label: "최종", createdAt: now },
    ]);

    const res = await GET(
      new Request("http://localhost/api/documents/doc1/versions"),
      makeContext("doc1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.versions).toHaveLength(2);
    expect(json.versions[0].label).toBe("초안");
  });

  it("returns empty versions list when no versions exist", async () => {
    mockFindUnique.mockResolvedValue({ id: "doc1" });
    mockVersionFindMany.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/documents/doc1/versions"),
      makeContext("doc1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.versions).toEqual([]);
  });

  it("returns 404 when document not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/documents/nonexistent/versions"),
      makeContext("nonexistent"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 500 on database error", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    const res = await GET(
      new Request("http://localhost/api/documents/doc1/versions"),
      makeContext("doc1"),
    );

    expect(res.status).toBe(500);
  });
});
