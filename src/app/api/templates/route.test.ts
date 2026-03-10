// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const {
  listWorkspaceTemplatesMock,
  createWorkspaceTemplateMock,
  getWorkspaceTemplateMock,
  listWorkspaceTemplateVersionsMock,
  approveWorkspaceTemplateMock,
} = vi.hoisted(() => ({
  listWorkspaceTemplatesMock: vi.fn(),
  createWorkspaceTemplateMock: vi.fn(),
  getWorkspaceTemplateMock: vi.fn(),
  listWorkspaceTemplateVersionsMock: vi.fn(),
  approveWorkspaceTemplateMock: vi.fn(),
}));

const { saveBlobObjectMock, parseHwpxToProseMirrorMock, buildTemplateCatalogFromDocMock } = vi.hoisted(() => ({
  saveBlobObjectMock: vi.fn(),
  parseHwpxToProseMirrorMock: vi.fn(),
  buildTemplateCatalogFromDocMock: vi.fn(),
}));

vi.mock("@/lib/server/workspace-store", () => ({
  listWorkspaceTemplates: listWorkspaceTemplatesMock,
  createWorkspaceTemplate: createWorkspaceTemplateMock,
  getWorkspaceTemplate: getWorkspaceTemplateMock,
  listWorkspaceTemplateVersions: listWorkspaceTemplateVersionsMock,
  approveWorkspaceTemplate: approveWorkspaceTemplateMock,
}));

vi.mock("@/lib/server/blob-store", () => ({
  saveBlobObject: saveBlobObjectMock,
  createSignedBlobDownload: vi.fn(({ descriptor }) => ({
    url: `/api/blob/download/${descriptor.blobId}?expires=1&sig=test`,
    expiresAt: "2026-03-10T00:05:00.000Z",
  })),
  resolveBlobStorageRoot: vi.fn(() => "/tmp/blob-root"),
}));

vi.mock("@/lib/editor/hwpx-to-prosemirror", () => ({
  parseHwpxToProseMirror: parseHwpxToProseMirrorMock,
}));

vi.mock("@/lib/template-catalog", () => ({
  buildTemplateCatalogFromDoc: buildTemplateCatalogFromDocMock,
}));

vi.mock("@/lib/server/ensure-dom-parser", () => ({
  ensureServerDomParser: vi.fn(),
}));

const { GET, POST } = await import("@/app/api/templates/route");
const { GET: GET_DETAIL } = await import("@/app/api/templates/[templateId]/route");
const { GET: GET_VERSIONS } = await import("@/app/api/templates/[templateId]/versions/route");
const { POST: POST_APPROVE } = await import("@/app/api/templates/[templateId]/approve/route");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  listWorkspaceTemplatesMock.mockReset();
  createWorkspaceTemplateMock.mockReset();
  getWorkspaceTemplateMock.mockReset();
  listWorkspaceTemplateVersionsMock.mockReset();
  approveWorkspaceTemplateMock.mockReset();
  saveBlobObjectMock.mockReset();
  parseHwpxToProseMirrorMock.mockReset();
  buildTemplateCatalogFromDocMock.mockReset();
});

describe("templates routes", () => {
  it("lists templates for an authenticated owner", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    listWorkspaceTemplatesMock.mockResolvedValue([{ id: "tpl-1", name: "보고서" }]);

    const response = await GET(new NextRequest("http://localhost/api/templates", {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ templates: [{ id: "tpl-1", name: "보고서" }] });
  });

  it("creates a template from uploaded hwpx", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    saveBlobObjectMock.mockResolvedValue({
      blobId: "blob-template-1",
      tenantId: "default",
      provider: "fs",
      fileName: "tpl.hwpx",
      contentType: "application/zip",
      byteLength: 32,
      createdAt: "2026-03-10T00:00:00.000Z",
    });
    parseHwpxToProseMirrorMock.mockResolvedValue({ doc: { type: "doc", content: [] } });
    buildTemplateCatalogFromDocMock.mockReturnValue({ version: "tpl-1", fieldCount: 1, rawTagCount: 1, fields: [], issues: [] });
    createWorkspaceTemplateMock.mockResolvedValue({
      id: "tpl-1",
      tenantId: "default",
      name: "보고서 템플릿",
      documentType: "report",
      status: "draft",
      currentVersionId: "tpl-ver-1",
      currentVersionNumber: 1,
      catalogVersion: "tpl-1",
      fieldCount: 1,
      issueCount: 0,
      blockingIssueCount: 0,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      updatedBy: "dev:admin@example.com",
      updatedByDisplayName: "admin",
      currentVersion: {
        id: "tpl-ver-1",
        templateId: "tpl-1",
        versionNumber: 1,
        fileName: "tpl.hwpx",
        blob: {
          blobId: "blob-template-1",
          provider: "fs",
          fileName: "tpl.hwpx",
          contentType: "application/zip",
          byteLength: 32,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
        catalogVersion: "tpl-1",
        fieldCount: 1,
        issueCount: 0,
        blockingIssueCount: 0,
        createdAt: "2026-03-10T00:00:00.000Z",
        createdBy: "dev:admin@example.com",
        createdByDisplayName: "admin",
        catalog: { version: "tpl-1", fieldCount: 1, rawTagCount: 1, fields: [], issues: [] },
      },
    });

    const formData = new FormData();
    formData.set("file", new File(["abc"], "tpl.hwpx", { type: "application/zip" }));
    formData.set("name", "보고서 템플릿");
    formData.set("documentType", "report");

    const response = await POST(new Request("http://localhost/api/templates", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      body: formData,
    }) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      template: {
        id: "tpl-1",
        currentVersion: {
          download: {
            downloadUrl: expect.stringContaining("/api/blob/download/blob-template-1?"),
          },
        },
      },
    });
  });

  it("returns template detail and version list for dynamic routes", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    getWorkspaceTemplateMock.mockResolvedValue({
      id: "tpl-1",
      tenantId: "default",
      name: "보고서 템플릿",
      documentType: "report",
      status: "draft",
      currentVersionId: "tpl-ver-1",
      currentVersionNumber: 1,
      catalogVersion: "tpl-1",
      fieldCount: 1,
      issueCount: 0,
      blockingIssueCount: 0,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      updatedBy: "dev:admin@example.com",
      updatedByDisplayName: "admin",
      currentVersion: null,
    });
    listWorkspaceTemplateVersionsMock.mockResolvedValue([{
      id: "tpl-ver-1",
      templateId: "tpl-1",
      versionNumber: 1,
      fileName: "tpl.hwpx",
      blob: {
        blobId: "blob-template-1",
        provider: "fs",
        fileName: "tpl.hwpx",
        contentType: "application/zip",
        byteLength: 32,
        createdAt: "2026-03-10T00:00:00.000Z",
      },
      catalogVersion: "tpl-1",
      fieldCount: 1,
      issueCount: 0,
      blockingIssueCount: 0,
      createdAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      catalog: { version: "tpl-1", fieldCount: 1, rawTagCount: 1, fields: [], issues: [] },
    }]);

    const [detailResponse, versionsResponse] = await Promise.all([
      GET_DETAIL(new Request("http://localhost/api/templates/tpl-1", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }) as never, { params: Promise.resolve({ templateId: "tpl-1" }) }),
      GET_VERSIONS(new Request("http://localhost/api/templates/tpl-1/versions", {
        method: "GET",
        headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }) as never, { params: Promise.resolve({ templateId: "tpl-1" }) }),
    ]);

    expect(detailResponse.status).toBe(200);
    expect(versionsResponse.status).toBe(200);
  });

  it("approves a template", async () => {
    process.env.AUTH_SECRET = "test-secret";
    const token = await createSessionToken("admin@example.com");
    approveWorkspaceTemplateMock.mockResolvedValue({
      id: "tpl-1",
      tenantId: "default",
      name: "보고서 템플릿",
      documentType: "report",
      status: "approved",
      currentVersionId: "tpl-ver-1",
      currentVersionNumber: 1,
      catalogVersion: "tpl-1",
      fieldCount: 1,
      issueCount: 0,
      blockingIssueCount: 0,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      createdBy: "dev:admin@example.com",
      createdByDisplayName: "admin",
      updatedBy: "dev:admin@example.com",
      updatedByDisplayName: "admin",
      currentVersion: null,
    });

    const response = await POST_APPROVE(new Request("http://localhost/api/templates/tpl-1/approve", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    }) as never, { params: Promise.resolve({ templateId: "tpl-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ template: { status: "approved" } });
  });
});
