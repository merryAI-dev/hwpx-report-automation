import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockAuth,
  mockSaveApiKey,
  mockDeleteApiKey,
  mockHasApiKey,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSaveApiKey: vi.fn(),
  mockDeleteApiKey: vi.fn(),
  mockHasApiKey: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuth,
}));

vi.mock("@/lib/api-keys", () => ({
  saveApiKey: mockSaveApiKey,
  deleteApiKey: mockDeleteApiKey,
  hasApiKey: mockHasApiKey,
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

import { GET, PUT, DELETE } from "./route";

const ADMIN_SESSION = { user: { email: "admin@example.com", name: "Admin" } };

describe("/api/settings/api-keys", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockSaveApiKey.mockReset();
    mockDeleteApiKey.mockReset();
    mockHasApiKey.mockReset();
  });

  // ── GET ──
  describe("GET — check key statuses", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValue(null);
      const res = await GET(new Request("http://localhost/api/settings/api-keys"));
      expect(res.status).toBe(401);
    });

    it("returns key statuses for authenticated user", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      mockHasApiKey.mockResolvedValueOnce(true); // anthropic
      mockHasApiKey.mockResolvedValueOnce(false); // openai

      const res = await GET(new Request("http://localhost/api/settings/api-keys"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.keys).toEqual([
        { provider: "anthropic", configured: true },
        { provider: "openai", configured: false },
      ]);
    });
  });

  // ── PUT ──
  describe("PUT — save API key", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValue(null);
      const res = await PUT(
        new Request("http://localhost/api/settings/api-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "anthropic", apiKey: "sk-test" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid provider", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      const res = await PUT(
        new Request("http://localhost/api/settings/api-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "invalid", apiKey: "sk-test" }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty API key", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      const res = await PUT(
        new Request("http://localhost/api/settings/api-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "anthropic", apiKey: "  " }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("saves API key successfully", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      mockSaveApiKey.mockResolvedValue(undefined);

      const res = await PUT(
        new Request("http://localhost/api/settings/api-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-test123" }),
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockSaveApiKey).toHaveBeenCalledWith("admin@example.com", "anthropic", "sk-ant-test123");
    });

    it("returns 400 for malformed JSON", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      const res = await PUT(
        new Request("http://localhost/api/settings/api-keys", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ── DELETE ──
  describe("DELETE — remove API key", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValue(null);
      const res = await DELETE(
        new Request("http://localhost/api/settings/api-keys?provider=anthropic", {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid provider", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      const res = await DELETE(
        new Request("http://localhost/api/settings/api-keys?provider=invalid", {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("deletes API key successfully", async () => {
      mockAuth.mockResolvedValue(ADMIN_SESSION);
      mockDeleteApiKey.mockResolvedValue(true);

      const res = await DELETE(
        new Request("http://localhost/api/settings/api-keys?provider=openai", {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted).toBe(true);
      expect(mockDeleteApiKey).toHaveBeenCalledWith("admin@example.com", "openai");
    });
  });
});
