// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const { createSignedBlobDownloadMock, saveBlobObjectMock } = vi.hoisted(() => ({
  createSignedBlobDownloadMock: vi.fn(),
  saveBlobObjectMock: vi.fn(),
}));

vi.mock("@/lib/server/blob-store", () => ({
  createSignedBlobDownload: createSignedBlobDownloadMock,
  saveBlobObject: saveBlobObjectMock,
}));

const { POST } = await import("@/app/api/blob/upload/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  createSignedBlobDownloadMock.mockReset();
  saveBlobObjectMock.mockReset();
});

describe("blob upload route", () => {
  it("rejects unauthenticated uploads", async () => {
    const formData = new FormData();
    formData.set("file", new File(["abc"], "report.hwpx", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/blob/upload", {
      method: "POST",
      body: formData,
    }) as never);

    expect(response.status).toBe(401);
  });

  it("rejects authenticated uploads without a file", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");

    const response = await POST(new Request("http://localhost/api/blob/upload", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: new FormData(),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "file is required" });
  });

  it("returns a signed download payload for authenticated tenant uploads", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken({
      sub: "user-1",
      email: "admin@example.com",
      displayName: "Admin",
      memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      activeTenantId: "alpha",
      provider: { id: "password", type: "password", displayName: "Password" },
    });

    saveBlobObjectMock.mockResolvedValue({
      blobId: "blob-1",
      tenantId: "alpha",
      provider: "fs",
      fileName: "report.hwpx",
      contentType: "application/zip",
      byteLength: 3,
      createdAt: "2026-03-09T00:00:00.000Z",
    });
    createSignedBlobDownloadMock.mockReturnValue({
      url: "/api/blob/download/blob-1?expires=1&sig=test",
      expiresAt: "2026-03-09T00:05:00.000Z",
    });

    const formData = new FormData();
    formData.set("file", new File(["abc"], "report.hwpx", { type: "application/zip" }));

    const response = await POST(new Request("http://localhost/api/blob/upload", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: formData,
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      blobId: "blob-1",
      tenantId: "alpha",
      downloadUrl: "/api/blob/download/blob-1?expires=1&sig=test",
      activeTenant: { tenantId: "alpha", tenantName: "Alpha", role: "owner" },
    });
  });
});
