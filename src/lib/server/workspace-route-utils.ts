import type { AuthenticatedSession } from "@/lib/auth/with-api-auth";
import { createSignedBlobDownload } from "@/lib/server/blob-store";
import type { WorkspaceActor } from "@/lib/server/workspace-store";
import type {
  WorkspaceBlobReference,
  WorkspaceDocumentDetail,
  WorkspaceDocumentVersionSummary,
  WorkspaceDownloadReference,
  WorkspaceTemplateDetail,
  WorkspaceTemplateVersionSummary,
} from "@/lib/workspace-types";

export function buildWorkspaceActorFromSession(session: AuthenticatedSession): WorkspaceActor {
  if (!session.activeTenant) {
    throw new Error("Active tenant is required.");
  }

  return {
    userId: session.sub,
    email: session.email,
    displayName: session.displayName,
    tenantId: session.activeTenant.tenantId,
    tenantName: session.activeTenant.tenantName,
    tenantRole: session.activeTenant.role,
  };
}

function buildTenantScopedDownload(tenantId: string, blob: WorkspaceBlobReference): WorkspaceDownloadReference {
  const signed = createSignedBlobDownload({
    descriptor: {
      blobId: blob.blobId,
      tenantId,
      provider: "fs",
      fileName: blob.fileName,
      contentType: blob.contentType,
      byteLength: blob.byteLength,
      createdAt: blob.createdAt,
    },
  });
  return {
    ...blob,
    downloadUrl: signed.url,
    expiresAt: signed.expiresAt,
  };
}

export function attachWorkspaceDocumentDownloads(
  tenantId: string,
  detail: WorkspaceDocumentDetail,
): WorkspaceDocumentDetail {
  return {
    ...detail,
    currentVersion: detail.currentVersion
      ? {
          ...detail.currentVersion,
          download: buildTenantScopedDownload(tenantId, detail.currentVersion.blob),
        }
      : null,
  };
}

export function attachWorkspaceDocumentVersionDownloads(
  tenantId: string,
  versions: WorkspaceDocumentVersionSummary[],
): WorkspaceDocumentVersionSummary[] {
  return versions.map((version) => ({
    ...version,
    download: buildTenantScopedDownload(tenantId, version.blob),
  }));
}

export function attachWorkspaceTemplateDownloads(
  tenantId: string,
  detail: WorkspaceTemplateDetail,
): WorkspaceTemplateDetail {
  return {
    ...detail,
    currentVersion: detail.currentVersion
      ? {
          ...detail.currentVersion,
          download: buildTenantScopedDownload(tenantId, detail.currentVersion.blob),
        }
      : null,
  };
}

export function attachWorkspaceTemplateVersionDownloads(
  tenantId: string,
  versions: WorkspaceTemplateVersionSummary[],
): WorkspaceTemplateVersionSummary[] {
  return versions.map((version) => ({
    ...version,
    download: buildTenantScopedDownload(tenantId, version.blob),
  }));
}
