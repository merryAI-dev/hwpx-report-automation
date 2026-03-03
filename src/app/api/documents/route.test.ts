import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindMany,
  mockCreate,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    document: {
      findMany: mockFindMany,
      create: mockCreate,
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

import { GET, POST } from "./route";

describe("/api/documents", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockCreate.mockReset();
  });

  describe("GET — list documents", () => {
    it("returns a list of documents", async () => {
      const now = new Date();
      mockFindMany.mockResolvedValue([
        { id: "doc1", name: "Test.hwpx", sizeBytes: 1024, createdAt: now, updatedAt: now },
      ]);

      const res = await GET(new Request("http://localhost/api/documents"));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.documents).toHaveLength(1);
      expect(json.documents[0].id).toBe("doc1");
      expect(json.documents[0].name).toBe("Test.hwpx");
    });

    it("returns empty list when no documents", async () => {
      mockFindMany.mockResolvedValue([]);

      const res = await GET(new Request("http://localhost/api/documents"));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.documents).toEqual([]);
    });

    it("returns 500 on database error", async () => {
      mockFindMany.mockRejectedValue(new Error("DB error"));

      const res = await GET(new Request("http://localhost/api/documents"));
      expect(res.status).toBe(500);
    });
  });

  describe("POST — create document", () => {
    it("creates a document with valid input", async () => {
      const now = new Date();
      mockCreate.mockResolvedValue({
        id: "new-doc",
        name: "New.hwpx",
        sizeBytes: 0,
        createdAt: now,
        updatedAt: now,
      });

      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New.hwpx",
          docJson: '{"type":"doc","content":[]}',
        }),
      }));

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe("new-doc");
      expect(json.name).toBe("New.hwpx");
    });

    it("returns 400 when name is missing", async () => {
      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docJson: '{}' }),
      }));

      expect(res.status).toBe(400);
    });

    it("returns 400 when docJson is missing", async () => {
      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test.hwpx" }),
      }));

      expect(res.status).toBe(400);
    });

    it("returns 400 when name exceeds 255 characters", async () => {
      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "a".repeat(256) + ".hwpx",
          docJson: '{}',
        }),
      }));

      expect(res.status).toBe(400);
    });

    it("returns 400 when name contains path traversal", async () => {
      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "../etc/passwd",
          docJson: '{}',
        }),
      }));

      expect(res.status).toBe(400);
    });

    it("returns 400 when name contains invalid characters", async () => {
      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test<script>.hwpx",
          docJson: '{}',
        }),
      }));

      expect(res.status).toBe(400);
    });

    it("returns 500 on database error", async () => {
      mockCreate.mockRejectedValue(new Error("DB error"));

      const res = await POST(new Request("http://localhost/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test.hwpx",
          docJson: '{}',
        }),
      }));

      expect(res.status).toBe(500);
    });
  });
});
