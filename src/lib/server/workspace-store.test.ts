import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveWorkspaceTemplate,
  createWorkspaceDocument,
  createWorkspaceDocumentVersion,
  createWorkspaceTemplate,
  listWorkspaceDocumentAuditEvents,
  listWorkspaceDocumentVersions,
  listWorkspaceDocuments,
  listWorkspaceTemplates,
  resolveWorkspaceActor,
  updateWorkspaceDocumentPermissions,
} from "./workspace-store";

const tempRoots: string[] = [];

const actor = resolveWorkspaceActor({
  userId: "user-1",
  email: "owner@example.com",
  displayName: "Owner",
  tenantId: "alpha",
  tenantName: "Alpha",
  tenantRole: "owner",
});

const editorActor = resolveWorkspaceActor({
  userId: "user-2",
  email: "editor@example.com",
  displayName: "Editor",
  tenantId: "alpha",
  tenantName: "Alpha",
  tenantRole: "viewer",
});

async function createEnv() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-store-test-"));
  tempRoots.push(root);
  return {
    env: { BLOB_STORAGE_FS_ROOT: root },
    root,
  };
}

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (!root) {
      continue;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("workspace store", () => {
  it("creates documents, versions, and audit entries", async () => {
    const { env } = await createEnv();

    const document = await createWorkspaceDocument({
      tenantId: actor.tenantId,
      actor,
      env,
      payload: {
        title: "주간 보고서",
        label: "manual-save",
        fileName: "weekly.hwpx",
        sourceFormat: "hwpx",
        editorDoc: { type: "doc", content: [] },
        templateCatalog: null,
        validationSummary: null,
        blob: {
          blobId: "blob-1",
          provider: "fs",
          fileName: "weekly.hwpx",
          contentType: "application/haansoft-hwpx",
          byteLength: 128,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
      },
    });

    expect(document.currentVersionNumber).toBe(1);

    const listed = await listWorkspaceDocuments({ tenantId: actor.tenantId, actor, env });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("주간 보고서");

    const version = await createWorkspaceDocumentVersion({
      tenantId: actor.tenantId,
      actor,
      documentId: document.id,
      env,
      payload: {
        label: "auto-save",
        fileName: "weekly-v2.hwpx",
        sourceFormat: "hwpx",
        editorDoc: { type: "doc", content: [] },
        templateCatalog: null,
        validationSummary: null,
        blob: {
          blobId: "blob-2",
          provider: "fs",
          fileName: "weekly-v2.hwpx",
          contentType: "application/haansoft-hwpx",
          byteLength: 256,
          createdAt: "2026-03-10T01:00:00.000Z",
        },
      },
    });

    expect(version?.versionNumber).toBe(2);

    const versions = await listWorkspaceDocumentVersions({
      tenantId: actor.tenantId,
      actor,
      documentId: document.id,
      env,
    });
    expect(versions.map((row) => row.versionNumber)).toEqual([2, 1]);

    const audit = await listWorkspaceDocumentAuditEvents({
      tenantId: actor.tenantId,
      actor,
      documentId: document.id,
      env,
    });
    expect(audit.map((row) => row.eventType)).toEqual([
      "document.version_created",
      "document.created",
    ]);
  });

  it("enforces explicit document permissions for non-owner tenant members", async () => {
    const { env } = await createEnv();

    const document = await createWorkspaceDocument({
      tenantId: actor.tenantId,
      actor,
      env,
      payload: {
        title: "비공개 문서",
        label: "manual-save",
        fileName: "private.hwpx",
        sourceFormat: "hwpx",
        editorDoc: { type: "doc", content: [] },
        templateCatalog: null,
        validationSummary: null,
        blob: {
          blobId: "blob-3",
          provider: "fs",
          fileName: "private.hwpx",
          contentType: "application/haansoft-hwpx",
          byteLength: 100,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
      },
    });

    const beforeShare = await listWorkspaceDocuments({ tenantId: actor.tenantId, actor: editorActor, env });
    expect(beforeShare).toHaveLength(0);

    await updateWorkspaceDocumentPermissions({
      tenantId: actor.tenantId,
      actor,
      documentId: document.id,
      env,
      permissions: [{ subjectType: "user", subjectId: editorActor.userId, displayName: "Editor", role: "editor" }],
    });

    const afterShare = await listWorkspaceDocuments({ tenantId: actor.tenantId, actor: editorActor, env });
    expect(afterShare).toHaveLength(1);
    expect(afterShare[0]?.id).toBe(document.id);
  });

  it("requires clean template catalog before approval", async () => {
    const { env } = await createEnv();

    const draftTemplate = await createWorkspaceTemplate({
      tenantId: actor.tenantId,
      actor,
      env,
      payload: {
        name: "보고서 템플릿",
        documentType: "report",
        fileName: "tpl.hwpx",
        blob: {
          blobId: "blob-template-1",
          provider: "fs",
          fileName: "tpl.hwpx",
          contentType: "application/haansoft-hwpx",
          byteLength: 99,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
        catalog: {
          version: "tpl-bad",
          fieldCount: 1,
          rawTagCount: 1,
          fields: [],
          issues: [{ code: "conflicting_type", severity: "error", message: "bad", token: "{{TITLE}}" }],
        },
      },
    });

    await expect(approveWorkspaceTemplate({
      tenantId: actor.tenantId,
      actor,
      templateId: draftTemplate.id,
      env,
    })).rejects.toThrow(/blocking catalog issues/);

    await createWorkspaceTemplate({
      tenantId: actor.tenantId,
      actor,
      env,
      payload: {
        name: "승인용 템플릿",
        documentType: "report",
        fileName: "tpl-approved.hwpx",
        blob: {
          blobId: "blob-template-2",
          provider: "fs",
          fileName: "tpl-approved.hwpx",
          contentType: "application/haansoft-hwpx",
          byteLength: 99,
          createdAt: "2026-03-10T00:00:00.000Z",
        },
        catalog: {
          version: "tpl-good",
          fieldCount: 1,
          rawTagCount: 1,
          fields: [],
          issues: [],
        },
      },
    });

    const templates = await listWorkspaceTemplates({ tenantId: actor.tenantId, actor, env });
    expect(templates).toHaveLength(2);
  });
});
