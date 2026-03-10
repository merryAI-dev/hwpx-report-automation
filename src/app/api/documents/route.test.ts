// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const {
  listWorkspaceDocumentsMock,
  createWorkspaceDocumentMock,
  getWorkspaceDocumentMock,
  createWorkspaceDocumentVersionMock,
} = vi.hoisted(() => ({
  listWorkspaceDocumentsMock: vi.fn(),
  createWorkspaceDocumentMock: vi.fn(),
  getWorkspaceDocumentMock: vi.fn(),
  createWorkspaceDocumentVersionMock: vi.fn(),
}));

vi.mock("@/lib/server/workspace-store", () => ({
  listWorkspaceDocuments: listWorkspaceDocumentsMock,
  createWorkspaceDocument: createWorkspaceDocumentMock,
  getWorkspaceDocument: getWorkspaceDocumentMock,
  createWorkspaceDocumentVersion: createWorkspaceDocumentVersionMock,
}));

const { GET, POST } = await import("@/app/api/documents/route");
const { GET: GET_DETAIL } = await import("@/app/api/documents/[documentId]/route");
const { POST: POST_VERSION } = await import("@/app/api/documents/[documentId]/versions/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  listWorkspaceDocumentsMock.mockReset();
  createWorkspaceDocumentMock.mockReset();
  getWorkspaceDocumentMock.mockReset();
  createWorkspaceDocumentVersionMock.mockReset();
});

describe("documents routes", () => {
  it("lists tenant documents for an authenticated session", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken({
      sub: "user-1",
      email: "admin@example.com",
      displayName: "Admin",
      memberships: [{ tenantId: "alpha", tenantName: "Alpha", role: "owner" }],
      activeTenantId: "alpha",
      provider: { id: "password", type: "password", displayName: "Password" },
    });
    listWorkspaceDocumentsMock.mockResolvedValue([{ id: "doc-1", title: "주간", status: "draft" }]);

    const response = await GET(new NextRequest("http://localhost/api/documents?q=%EC%A3%BC", {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ documents: [{ id: "doc-1", title: "주간", status: "draft" }] });
    expect(listWorkspaceDocumentsMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "alpha", query: "주" }));
  });

  it("creates a document and returns the current version download metadata", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    createWorkspaceDocumentMock.mockResolvedValue({
      id: "doc-1",
      tenantId: "default",
      title: "보고서",
      status: "draft",
      sourceFormat: "hwpx",
      currentVersionId: "ver-1",
      currentVersionNumber: 1,
      templateCatalogVersion: null,
      templateFieldCount: 0,
      validationSummary: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      updatedBy: "dev:admin@example.com",
      updatedByDisplayName: "admin",
      permissions: [],
      currentVersion: {
        id: "ver-1",
        documentId: "doc-1",
        versionNumber: 1,
        label: "manual-save",
        fileName: "report.hwpx",
        blob: {
          blobId: "blob-1",
          provider: "fs",
          fileName: "report.hwpx",
          contentType: "application/zip",
          byteLength: 12,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
        templateCatalogVersion: null,
        templateFieldCount: 0,
        validationSummary: null,
        createdAt: "2026-03-10T00:00:00.000Z",
        createdBy: "dev:admin@example.com",
        createdByDisplayName: "admin",
      },
    });

    const response = await POST(new Request("http://localhost/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({
        title: "보고서",
        label: "manual-save",
        fileName: "report.hwpx",
        sourceFormat: "hwpx",
        blob: {
          blobId: "blob-1",
          provider: "fs",
          fileName: "report.hwpx",
          contentType: "application/zip",
          byteLength: 12,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
      }),
    }) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      document: {
        id: "doc-1",
        currentVersion: {
          download: {
            downloadUrl: expect.stringContaining("/api/blob/download/blob-1?"),
          },
        },
      },
    });
  });

  it("returns document detail for dynamic routes", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    getWorkspaceDocumentMock.mockResolvedValue({
      id: "doc-1",
      tenantId: "default",
      title: "문서",
      status: "draft",
      sourceFormat: "hwpx",
      currentVersionId: "ver-1",
      currentVersionNumber: 1,
      templateCatalogVersion: null,
      templateFieldCount: 0,
      validationSummary: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      updatedBy: "dev:admin@example.com",
      updatedByDisplayName: "admin",
      permissions: [],
      currentVersion: null,
    });

    const response = await GET_DETAIL(new Request("http://localhost/api/documents/doc-1", {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    }) as never, { params: Promise.resolve({ documentId: "doc-1" }) });

    expect(response.status).toBe(200);
  });

  it("creates a new document version", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    createWorkspaceDocumentVersionMock.mockResolvedValue({
      id: "ver-2",
      documentId: "doc-1",
      versionNumber: 2,
      label: "auto-save",
      fileName: "report-v2.hwpx",
      blob: {
        blobId: "blob-2",
        provider: "fs",
        fileName: "report-v2.hwpx",
        contentType: "application/zip",
        byteLength: 16,
        createdAt: "2026-03-10T01:00:00.000Z",
      },
      templateCatalogVersion: null,
      templateFieldCount: 0,
      validationSummary: null,
      createdAt: "2026-03-10T01:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
    });

    const response = await POST_VERSION(new Request("http://localhost/api/documents/doc-1/versions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({
        label: "auto-save",
        fileName: "report-v2.hwpx",
        sourceFormat: "hwpx",
        blob: {
          blobId: "blob-2",
          provider: "fs",
          fileName: "report-v2.hwpx",
          contentType: "application/zip",
          byteLength: 16,
          createdAt: "2026-03-10T01:00:00.000Z",
        },
      }),
    }) as never, { params: Promise.resolve({ documentId: "doc-1" }) });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      version: {
        id: "ver-2",
        download: {
          downloadUrl: expect.stringContaining("/api/blob/download/blob-2?"),
        },
      },
    });
  });
});
