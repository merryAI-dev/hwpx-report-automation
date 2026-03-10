import type { JSONContent } from "@tiptap/core";
import type { TemplateCatalog } from "@/lib/template-catalog";

export type WorkspaceAccessRole = "viewer" | "editor" | "manager" | "owner";
export type WorkspaceDocumentStatus = "draft" | "ready" | "archived";
export type WorkspaceTemplateStatus = "draft" | "approved" | "deprecated";
export type WorkspaceSourceFormat = "hwpx" | "hwp" | "docx" | "pptx";

export type WorkspaceValidationIssue = {
  code: string;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
};

export type WorkspaceValidationSummary = {
  infoCount: number;
  warningCount: number;
  errorCount: number;
  blockingCount: number;
  topIssues: WorkspaceValidationIssue[];
};

export type WorkspaceBlobReference = {
  blobId: string;
  provider: string;
  fileName: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
};

export type WorkspaceDownloadReference = WorkspaceBlobReference & {
  downloadUrl: string;
  expiresAt: string;
};

export type WorkspacePermissionEntry = {
  subjectType: "user";
  subjectId: string;
  displayName: string;
  role: WorkspaceAccessRole;
};

export type WorkspaceAuditEvent = {
  id: string;
  targetType: "document" | "template";
  targetId: string;
  eventType: string;
  actor: {
    userId: string;
    email: string;
    displayName: string;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceDocumentVersionSummary = {
  id: string;
  documentId: string;
  versionNumber: number;
  label: string;
  fileName: string;
  blob: WorkspaceBlobReference;
  templateCatalogVersion: string | null;
  templateFieldCount: number;
  validationSummary: WorkspaceValidationSummary | null;
  createdAt: string;
  createdBy: string;
  createdByDisplayName: string;
  download?: WorkspaceDownloadReference;
};

export type WorkspaceDocumentSummary = {
  id: string;
  tenantId: string;
  title: string;
  status: WorkspaceDocumentStatus;
  sourceFormat: WorkspaceSourceFormat;
  currentVersionId: string;
  currentVersionNumber: number;
  templateCatalogVersion: string | null;
  templateFieldCount: number;
  validationSummary: WorkspaceValidationSummary | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByDisplayName: string;
  updatedBy: string;
  updatedByDisplayName: string;
};

export type WorkspaceDocumentDetail = WorkspaceDocumentSummary & {
  permissions: WorkspacePermissionEntry[];
  currentVersion: WorkspaceDocumentVersionSummary | null;
};

export type WorkspaceTemplateVersionSummary = {
  id: string;
  templateId: string;
  versionNumber: number;
  fileName: string;
  blob: WorkspaceBlobReference;
  catalogVersion: string;
  fieldCount: number;
  issueCount: number;
  blockingIssueCount: number;
  createdAt: string;
  createdBy: string;
  createdByDisplayName: string;
  catalog: TemplateCatalog;
  download?: WorkspaceDownloadReference;
};

export type WorkspaceTemplateSummary = {
  id: string;
  tenantId: string;
  name: string;
  documentType: string;
  status: WorkspaceTemplateStatus;
  currentVersionId: string;
  currentVersionNumber: number;
  catalogVersion: string;
  fieldCount: number;
  issueCount: number;
  blockingIssueCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByDisplayName: string;
  updatedBy: string;
  updatedByDisplayName: string;
};

export type WorkspaceTemplateDetail = WorkspaceTemplateSummary & {
  currentVersion: WorkspaceTemplateVersionSummary | null;
};

export type WorkspaceDocumentVersionPayload = {
  label: string;
  fileName: string;
  sourceFormat: WorkspaceSourceFormat;
  editorDoc: JSONContent | null;
  templateCatalog: TemplateCatalog | null;
  validationSummary: WorkspaceValidationSummary | null;
  blob: WorkspaceBlobReference;
};

export type CreateWorkspaceDocumentPayload = WorkspaceDocumentVersionPayload & {
  title: string;
  permissions?: WorkspacePermissionEntry[];
};

export type CreateWorkspaceTemplatePayload = {
  name: string;
  documentType: string;
  fileName: string;
  blob: WorkspaceBlobReference;
  catalog: TemplateCatalog;
};

// ── Tenant Admin ──────────────────────────────────────────────────────────────

export type TenantMember = {
  userId: string;
  email: string;
  displayName: string;
  role: WorkspaceAccessRole;
  addedAt: string;
  addedBy: string;
};

export type TenantInfo = {
  tenantId: string;
  tenantName: string;
  createdAt: string;
  memberCount: number;
};

// ── AI Template Review ────────────────────────────────────────────────────────

export type TemplateReviewVerdict = "approve" | "needs-work" | "reject";

export type TemplateVersionReview = {
  id: string;
  templateId: string;
  versionId: string;
  verdict: TemplateReviewVerdict;
  summary: string;
  concerns: string[];
  suggestions: string[];
  createdAt: string;
  createdBy: string;
  createdByDisplayName: string;
  model: string;
};
