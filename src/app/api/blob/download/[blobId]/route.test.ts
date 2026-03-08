// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const {
  readBlobObjectMock,
  toContentDispositionMock,
  verifyBlobDownloadSignatureMock,
} = vi.hoisted(() => ({
  readBlobObjectMock: vi.fn(),
  toContentDispositionMock: vi.fn(),
  verifyBlobDownloadSignatureMock: vi.fn(),
}));

vi.mock("@/lib/server/blob-store", () => ({
  readBlobObject: readBlobObjectMock,
  toContentDisposition: toContentDispositionMock,
  verifyBlobDownloadSignature: verifyBlobDownloadSignatureMock,
}));

const { GET } = await import("@/app/api/blob/download/[blobId]/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  readBlobObjectMock.mockReset();
  toContentDispositionMock.mockReset();
  verifyBlobDownloadSignatureMock.mockReset();
});

describe("blob download route", () => {
  it("rejects unauthenticated downloads", async () => {
    const response = await GET(new Request("http://localhost/api/blob/download/blob-1?expires=1&sig=test"));
    expect(response.status).toBe(401);
  });

  it("rejects invalid signed URLs even for authenticated users", async () => {
    process.env.AUTH_SECRET = "test-secret";
    verifyBlobDownloadSignatureMock.mockReturnValue({ ok: false, reason: "invalid" });

    const token = await createSessionToken({
      sub: "user-1",
      email: "admin@example.com",
      displayName: "Admin",
      memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      activeTenantId: "alpha",
      provider: { id: "password", type: "password", displayName: "Password" },
    });

    const response = await GET(new Request("http://localhost/api/blob/download/blob-1?expires=1&sig=test", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "invalid signed download URL" });
  });

  it("returns the blob when auth and signature are both valid", async () => {
    process.env.AUTH_SECRET = "test-secret";
    verifyBlobDownloadSignatureMock.mockReturnValue({ ok: true });
    toContentDispositionMock.mockReturnValue('attachment; filename=\"report.hwpx\"');
    readBlobObjectMock.mockResolvedValue({
      metadata: {
        fileName: "report.hwpx",
        contentType: "application/zip",
        byteLength: 3,
      },
      buffer: Buffer.from("abc"),
    });

    const token = await createSessionToken({
      sub: "user-1",
      email: "admin@example.com",
      displayName: "Admin",
      memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      activeTenantId: "alpha",
      provider: { id: "password", type: "password", displayName: "Password" },
    });

    const response = await GET(new Request("http://localhost/api/blob/download/blob-1?expires=1&sig=test", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename=\"report.hwpx\"');
    await expect(response.text()).resolves.toBe("abc");
  });
});
