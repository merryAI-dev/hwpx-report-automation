import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  mockUpdate,
  mockDelete,
  mockVersionCreate,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockVersionCreate: vi.fn(),
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    document: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      delete: mockDelete,
    },
    documentVersion: {
      create: mockVersionCreate,
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

import { GET, PATCH, DELETE } from "./route";

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/documents/[id]", () => {
  const now = new Date();
  const mockDoc = {
    id: "doc1",
    name: "Test.hwpx",
    hwpxBlob: Buffer.from("test-data"),
    docJson: '{"type":"doc"}',
    segments: "[]",
    extraSegmentsMap: "{}",
    sizeBytes: 9,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockVersionCreate.mockReset();
  });

  describe("GET", () => {
    it("returns a document by id", async () => {
      mockFindUnique.mockResolvedValue(mockDoc);

      const res = await GET(
        new Request("http://localhost/api/documents/doc1"),
        makeContext("doc1"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("doc1");
      expect(json.name).toBe("Test.hwpx");
      expect(json.hwpxBlob).toBe(Buffer.from("test-data").toString("base64"));
    });

    it("returns 404 when document not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await GET(
        new Request("http://localhost/api/documents/nonexistent"),
        makeContext("nonexistent"),
      );

      expect(res.status).toBe(404);
    });

    it("returns 500 on database error", async () => {
      mockFindUnique.mockRejectedValue(new Error("DB error"));

      const res = await GET(
        new Request("http://localhost/api/documents/doc1"),
        makeContext("doc1"),
      );

      expect(res.status).toBe(500);
    });
  });

  describe("PATCH", () => {
    it("updates a document", async () => {
      mockFindUnique.mockResolvedValue(mockDoc);
      mockUpdate.mockResolvedValue({ ...mockDoc, name: "Updated.hwpx" });

      const res = await PATCH(
        new Request("http://localhost/api/documents/doc1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated.hwpx" }),
        }),
        makeContext("doc1"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.name).toBe("Updated.hwpx");
    });

    it("creates a version when versionLabel provided", async () => {
      mockFindUnique.mockResolvedValue(mockDoc);
      mockUpdate.mockResolvedValue(mockDoc);
      mockVersionCreate.mockResolvedValue({});

      await PATCH(
        new Request("http://localhost/api/documents/doc1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docJson: '{"updated":true}', versionLabel: "v1" }),
        }),
        makeContext("doc1"),
      );

      expect(mockVersionCreate).toHaveBeenCalledWith({
        data: {
          documentId: "doc1",
          docJson: mockDoc.docJson,
          label: "v1",
        },
      });
    });

    it("returns 404 when document not found", async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await PATCH(
        new Request("http://localhost/api/documents/doc1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated.hwpx" }),
        }),
        makeContext("doc1"),
      );

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("deletes a document", async () => {
      mockDelete.mockResolvedValue(mockDoc);

      const res = await DELETE(
        new Request("http://localhost/api/documents/doc1", { method: "DELETE" }),
        makeContext("doc1"),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("returns 500 on database error", async () => {
      mockDelete.mockRejectedValue(new Error("DB error"));

      const res = await DELETE(
        new Request("http://localhost/api/documents/doc1", { method: "DELETE" }),
        makeContext("doc1"),
      );

      expect(res.status).toBe(500);
    });
  });
});
