import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CreateWorkspaceDocumentPayload,
  CreateWorkspaceTemplatePayload,
  WorkspaceAccessRole,
  WorkspaceAuditEvent,
  WorkspaceDocumentDetail,
  WorkspaceDocumentStatus,
  WorkspaceDocumentSummary,
  WorkspaceDocumentVersionPayload,
  WorkspaceDocumentVersionSummary,
  WorkspacePermissionEntry,
  WorkspaceTemplateDetail,
  WorkspaceTemplateSummary,
  WorkspaceTemplateVersionSummary,
  TemplateVersionReview,
} from "@/lib/workspace-types";
import { resolveBlobStorageRoot } from "@/lib/server/blob-store";

const WORKSPACE_ROOT_DIR = "workspace";
const TENANTS_DIR = "tenants";
const DOCUMENTS_DIR = "documents";
const TEMPLATES_DIR = "templates";
const VERSIONS_DIR = "versions";
const DOCUMENT_FILE = "document.json";
const TEMPLATE_FILE = "template.json";
const AUDIT_FILE = "audit.jsonl";

const ROLE_RANK: Record<WorkspaceAccessRole, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
  owner: 4,
};

export type WorkspaceEnv = NodeJS.ProcessEnv | Partial<Pick<NodeJS.ProcessEnv, "BLOB_STORAGE_FS_ROOT">>;

export type WorkspaceActor = {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  tenantRole: string;
};

type StoredDocument = WorkspaceDocumentSummary & {
  permissions: WorkspacePermissionEntry[];
};

type StoredDocumentVersion = WorkspaceDocumentVersionSummary & {
  editorDoc: import("@tiptap/core").JSONContent | null;
};

type StoredTemplate = WorkspaceTemplateSummary;

type StoredTemplateVersion = WorkspaceTemplateVersionSummary;

function sanitizeId(value: string, label: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function workspaceRoot(env: WorkspaceEnv = process.env): string {
  return path.join(resolveBlobStorageRoot(env), WORKSPACE_ROOT_DIR);
}

function tenantRoot(tenantId: string, env?: WorkspaceEnv): string {
  return path.join(workspaceRoot(env), TENANTS_DIR, sanitizeId(tenantId, "tenantId"));
}

function documentsRoot(tenantId: string, env?: WorkspaceEnv): string {
  return path.join(tenantRoot(tenantId, env), DOCUMENTS_DIR);
}

function templatesRoot(tenantId: string, env?: WorkspaceEnv): string {
  return path.join(tenantRoot(tenantId, env), TEMPLATES_DIR);
}

function documentRoot(tenantId: string, documentId: string, env?: WorkspaceEnv): string {
  return path.join(documentsRoot(tenantId, env), sanitizeId(documentId, "documentId"));
}

function templateRoot(tenantId: string, templateId: string, env?: WorkspaceEnv): string {
  return path.join(templatesRoot(tenantId, env), sanitizeId(templateId, "templateId"));
}

function documentFilePath(tenantId: string, documentId: string, env?: WorkspaceEnv): string {
  return path.join(documentRoot(tenantId, documentId, env), DOCUMENT_FILE);
}

function templateFilePath(tenantId: string, templateId: string, env?: WorkspaceEnv): string {
  return path.join(templateRoot(tenantId, templateId, env), TEMPLATE_FILE);
}

function documentVersionPath(tenantId: string, documentId: string, versionId: string, env?: WorkspaceEnv): string {
  return path.join(documentRoot(tenantId, documentId, env), VERSIONS_DIR, `${sanitizeId(versionId, "versionId")}.json`);
}

function templateVersionPath(tenantId: string, templateId: string, versionId: string, env?: WorkspaceEnv): string {
  return path.join(templateRoot(tenantId, templateId, env), VERSIONS_DIR, `${sanitizeId(versionId, "versionId")}.json`);
}

function documentAuditPath(tenantId: string, documentId: string, env?: WorkspaceEnv): string {
  return path.join(documentRoot(tenantId, documentId, env), AUDIT_FILE);
}

function templateAuditPath(tenantId: string, templateId: string, env?: WorkspaceEnv): string {
  return path.join(templateRoot(tenantId, templateId, env), AUDIT_FILE);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listChildDirectories(rootPath: string): Promise<string[]> {
  try {
    const rows = await fs.readdir(rootPath, { withFileTypes: true });
    return rows.filter((row) => row.isDirectory()).map((row) => row.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function toDocumentRole(role: string): WorkspaceAccessRole | null {
  if (role === "viewer" || role === "editor" || role === "manager" || role === "owner") {
    return role;
  }
  return null;
}

function tenantRoleToDocumentRole(role: string): WorkspaceAccessRole | null {
  const normalized = role.trim().toLowerCase();
  if (normalized === "owner" || normalized === "admin") {
    return "owner";
  }
  if (normalized === "manager") {
    return "manager";
  }
  return null;
}

function dedupePermissions(entries: WorkspacePermissionEntry[]): WorkspacePermissionEntry[] {
  return entries
    .map((entry) => ({
      subjectType: "user" as const,
      subjectId: entry.subjectId.trim(),
      displayName: entry.displayName.trim() || entry.subjectId.trim(),
      role: entry.role,
    }))
    .filter((entry) => entry.subjectId)
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId))
    .filter((entry, index, all) => all.findIndex((item) => item.subjectId === entry.subjectId) === index);
}

function normalizePermissions(actor: WorkspaceActor, permissions?: WorkspacePermissionEntry[]): WorkspacePermissionEntry[] {
  const next = dedupePermissions([
    ...(permissions || []),
    {
      subjectType: "user",
      subjectId: actor.userId,
      displayName: actor.displayName || actor.email,
      role: "owner",
    },
  ]);
  return next.map((entry) => ({
    ...entry,
    role: toDocumentRole(entry.role) || "viewer",
  }));
}

function getAccessRole(actor: WorkspaceActor, permissions: WorkspacePermissionEntry[]): WorkspaceAccessRole | null {
  const tenantRole = tenantRoleToDocumentRole(actor.tenantRole);
  const explicitRole = permissions.find((entry) => entry.subjectId === actor.userId)?.role || null;
  if (!tenantRole && !explicitRole) {
    return null;
  }
  if (!tenantRole) {
    return explicitRole;
  }
  if (!explicitRole) {
    return tenantRole;
  }
  return ROLE_RANK[tenantRole] >= ROLE_RANK[explicitRole] ? tenantRole : explicitRole;
}

function assertCanReadDocument(actor: WorkspaceActor, document: StoredDocument): void {
  if (!getAccessRole(actor, document.permissions)) {
    throw new Error("Document access denied.");
  }
}

function assertCanEditDocument(actor: WorkspaceActor, document: StoredDocument): void {
  const role = getAccessRole(actor, document.permissions);
  if (!role || ROLE_RANK[role] < ROLE_RANK.editor) {
    throw new Error("Document edit access denied.");
  }
}

function assertCanManageDocument(actor: WorkspaceActor, document: StoredDocument): void {
  const role = getAccessRole(actor, document.permissions);
  if (!role || ROLE_RANK[role] < ROLE_RANK.manager) {
    throw new Error("Document manage access denied.");
  }
}

function assertCanManageTenant(actor: WorkspaceActor): void {
  const role = tenantRoleToDocumentRole(actor.tenantRole);
  if (!role || ROLE_RANK[role] < ROLE_RANK.manager) {
    throw new Error("Tenant management access denied.");
  }
}

function toStoredDocumentSummary(document: StoredDocument): WorkspaceDocumentSummary {
  const { permissions, ...summary } = document;
  void permissions;
  return summary;
}

function countBlockingTemplateIssues(version: StoredTemplateVersion): number {
  return version.catalog.issues.filter((issue) => issue.severity === "error").length;
}

async function appendAuditEvent(filePath: string, event: WorkspaceAuditEvent): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

async function readAuditEvents(filePath: string): Promise<WorkspaceAuditEvent[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkspaceAuditEvent)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function createAuditEvent(params: {
  targetType: "document" | "template";
  targetId: string;
  eventType: string;
  actor: WorkspaceActor;
  metadata?: Record<string, unknown>;
  now?: Date;
}): WorkspaceAuditEvent {
  return {
    id: crypto.randomUUID(),
    targetType: params.targetType,
    targetId: params.targetId,
    eventType: params.eventType,
    actor: {
      userId: params.actor.userId,
      email: params.actor.email,
      displayName: params.actor.displayName,
    },
    metadata: params.metadata || {},
    createdAt: (params.now || new Date()).toISOString(),
  };
}

async function readStoredDocument(tenantId: string, documentId: string, env?: WorkspaceEnv): Promise<StoredDocument | null> {
  return readJsonFile<StoredDocument>(documentFilePath(tenantId, documentId, env));
}

async function readStoredTemplate(tenantId: string, templateId: string, env?: WorkspaceEnv): Promise<StoredTemplate | null> {
  return readJsonFile<StoredTemplate>(templateFilePath(tenantId, templateId, env));
}

async function readDocumentVersion(
  tenantId: string,
  documentId: string,
  versionId: string,
  env?: WorkspaceEnv,
): Promise<StoredDocumentVersion | null> {
  return readJsonFile<StoredDocumentVersion>(documentVersionPath(tenantId, documentId, versionId, env));
}

async function readTemplateVersion(
  tenantId: string,
  templateId: string,
  versionId: string,
  env?: WorkspaceEnv,
): Promise<StoredTemplateVersion | null> {
  return readJsonFile<StoredTemplateVersion>(templateVersionPath(tenantId, templateId, versionId, env));
}

export function resolveWorkspaceActor(input: {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  tenantRole: string;
}): WorkspaceActor {
  return {
    userId: input.userId.trim(),
    email: input.email.trim(),
    displayName: input.displayName.trim() || input.email.trim(),
    tenantId: sanitizeId(input.tenantId, "tenantId"),
    tenantName: input.tenantName.trim() || input.tenantId.trim(),
    tenantRole: input.tenantRole.trim() || "viewer",
  };
}

export async function listWorkspaceDocuments(params: {
  tenantId: string;
  actor: WorkspaceActor;
  query?: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceDocumentSummary[]> {
  const ids = await listChildDirectories(documentsRoot(params.tenantId, params.env));
  const rows = (await Promise.all(ids.map((id) => readStoredDocument(params.tenantId, id, params.env))))
    .filter((row): row is StoredDocument => !!row)
    .filter((row) => !!getAccessRole(params.actor, row.permissions));

  const query = (params.query || "").trim().toLowerCase();
  return rows
    .filter((row) => (!query ? true : row.title.toLowerCase().includes(query) || row.sourceFormat.includes(query)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(toStoredDocumentSummary);
}

export async function createWorkspaceDocument(params: {
  tenantId: string;
  actor: WorkspaceActor;
  payload: CreateWorkspaceDocumentPayload;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentDetail> {
  const now = (params.now || new Date()).toISOString();
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const permissions = normalizePermissions(params.actor, params.payload.permissions);
  const version: StoredDocumentVersion = {
    id: versionId,
    documentId,
    versionNumber: 1,
    label: params.payload.label,
    fileName: params.payload.fileName,
    blob: params.payload.blob,
    templateCatalogVersion: params.payload.templateCatalog?.version || null,
    templateFieldCount: params.payload.templateCatalog?.fieldCount || 0,
    validationSummary: params.payload.validationSummary,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    editorDoc: params.payload.editorDoc,
  };
  const document: StoredDocument = {
    id: documentId,
    tenantId: params.tenantId,
    title: params.payload.title.trim() || params.payload.fileName,
    status: "draft",
    sourceFormat: params.payload.sourceFormat,
    currentVersionId: versionId,
    currentVersionNumber: 1,
    templateCatalogVersion: version.templateCatalogVersion,
    templateFieldCount: version.templateFieldCount,
    validationSummary: params.payload.validationSummary,
    createdAt: now,
    updatedAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
    permissions,
  };

  await writeJsonFile(documentFilePath(params.tenantId, documentId, params.env), document);
  await writeJsonFile(documentVersionPath(params.tenantId, documentId, versionId, params.env), version);
  await appendAuditEvent(
    documentAuditPath(params.tenantId, documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: documentId,
      eventType: "document.created",
      actor: params.actor,
      metadata: { versionId, label: params.payload.label },
      now: params.now,
    }),
  );

  return {
    ...toStoredDocumentSummary(document),
    permissions: document.permissions,
    currentVersion: version,
  };
}

export async function getWorkspaceDocument(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceDocumentDetail | null> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return null;
  }
  assertCanReadDocument(params.actor, document);
  const currentVersion = await readDocumentVersion(
    params.tenantId,
    params.documentId,
    document.currentVersionId,
    params.env,
  );
  return {
    ...toStoredDocumentSummary(document),
    permissions: document.permissions,
    currentVersion,
  };
}

export async function updateWorkspaceDocument(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  patch: Partial<Pick<WorkspaceDocumentSummary, "title" | "status">>;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentDetail | null> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return null;
  }
  assertCanManageDocument(params.actor, document);

  const nextStatus = params.patch.status;
  const nextTitle = params.patch.title?.trim();
  const next: StoredDocument = {
    ...document,
    title: nextTitle || document.title,
    status: (nextStatus || document.status) as WorkspaceDocumentStatus,
    updatedAt: (params.now || new Date()).toISOString(),
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };
  await writeJsonFile(documentFilePath(params.tenantId, params.documentId, params.env), next);
  await appendAuditEvent(
    documentAuditPath(params.tenantId, params.documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: params.documentId,
      eventType: "document.updated",
      actor: params.actor,
      metadata: { title: next.title, status: next.status },
      now: params.now,
    }),
  );
  const currentVersion = await readDocumentVersion(params.tenantId, params.documentId, next.currentVersionId, params.env);
  return {
    ...toStoredDocumentSummary(next),
    permissions: next.permissions,
    currentVersion,
  };
}

export async function createWorkspaceDocumentVersion(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  payload: WorkspaceDocumentVersionPayload;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentVersionSummary | null> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return null;
  }
  assertCanEditDocument(params.actor, document);

  const now = (params.now || new Date()).toISOString();
  const nextVersionNumber = document.currentVersionNumber + 1;
  const versionId = crypto.randomUUID();
  const version: StoredDocumentVersion = {
    id: versionId,
    documentId: params.documentId,
    versionNumber: nextVersionNumber,
    label: params.payload.label,
    fileName: params.payload.fileName,
    blob: params.payload.blob,
    templateCatalogVersion: params.payload.templateCatalog?.version || null,
    templateFieldCount: params.payload.templateCatalog?.fieldCount || 0,
    validationSummary: params.payload.validationSummary,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    editorDoc: params.payload.editorDoc,
  };

  const nextDocument: StoredDocument = {
    ...document,
    sourceFormat: params.payload.sourceFormat,
    currentVersionId: versionId,
    currentVersionNumber: nextVersionNumber,
    templateCatalogVersion: version.templateCatalogVersion,
    templateFieldCount: version.templateFieldCount,
    validationSummary: params.payload.validationSummary,
    updatedAt: now,
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };

  await writeJsonFile(documentVersionPath(params.tenantId, params.documentId, versionId, params.env), version);
  await writeJsonFile(documentFilePath(params.tenantId, params.documentId, params.env), nextDocument);
  await appendAuditEvent(
    documentAuditPath(params.tenantId, params.documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: params.documentId,
      eventType: "document.version_created",
      actor: params.actor,
      metadata: { versionId, versionNumber: nextVersionNumber, label: params.payload.label },
      now: params.now,
    }),
  );

  return version;
}

export async function listWorkspaceDocumentVersions(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceDocumentVersionSummary[]> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return [];
  }
  assertCanReadDocument(params.actor, document);
  const versionDir = path.join(documentRoot(params.tenantId, params.documentId, params.env), VERSIONS_DIR);
  const versionFiles = await listChildDirectories(versionDir).catch(() => [] as string[]);
  const jsonFiles = await fs.readdir(versionDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [] as string[];
    }
    throw error;
  });
  const ids = Array.from(new Set([
    ...versionFiles,
    ...jsonFiles.filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")),
  ]));
  const versions = (await Promise.all(ids.map((id) => readDocumentVersion(params.tenantId, params.documentId, id, params.env))))
    .filter((row): row is StoredDocumentVersion => !!row)
    .sort((left, right) => right.versionNumber - left.versionNumber);
  return versions.map((version) => {
    const { editorDoc, ...summary } = version;
    void editorDoc;
    return summary;
  });
}

export async function updateWorkspaceDocumentPermissions(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  permissions: WorkspacePermissionEntry[];
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentDetail | null> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return null;
  }
  assertCanManageDocument(params.actor, document);
  const next: StoredDocument = {
    ...document,
    permissions: normalizePermissions(params.actor, params.permissions),
    updatedAt: (params.now || new Date()).toISOString(),
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };
  await writeJsonFile(documentFilePath(params.tenantId, params.documentId, params.env), next);
  await appendAuditEvent(
    documentAuditPath(params.tenantId, params.documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: params.documentId,
      eventType: "document.permissions_updated",
      actor: params.actor,
      metadata: { count: next.permissions.length },
      now: params.now,
    }),
  );
  const currentVersion = await readDocumentVersion(params.tenantId, params.documentId, next.currentVersionId, params.env);
  return {
    ...toStoredDocumentSummary(next),
    permissions: next.permissions,
    currentVersion,
  };
}

export async function listWorkspaceDocumentAuditEvents(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceAuditEvent[]> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return [];
  }
  assertCanReadDocument(params.actor, document);
  return readAuditEvents(documentAuditPath(params.tenantId, params.documentId, params.env));
}

export async function listWorkspaceTemplates(params: {
  tenantId: string;
  actor: WorkspaceActor;
  query?: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceTemplateSummary[]> {
  assertCanManageTenant(params.actor);
  const ids = await listChildDirectories(templatesRoot(params.tenantId, params.env));
  const rows = (await Promise.all(ids.map((id) => readStoredTemplate(params.tenantId, id, params.env))))
    .filter((row): row is StoredTemplate => !!row);
  const query = (params.query || "").trim().toLowerCase();
  return rows
    .filter((row) => (!query ? true : row.name.toLowerCase().includes(query) || row.documentType.toLowerCase().includes(query)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createWorkspaceTemplate(params: {
  tenantId: string;
  actor: WorkspaceActor;
  payload: CreateWorkspaceTemplatePayload;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceTemplateDetail> {
  assertCanManageTenant(params.actor);
  const now = (params.now || new Date()).toISOString();
  const templateId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const version: StoredTemplateVersion = {
    id: versionId,
    templateId,
    versionNumber: 1,
    fileName: params.payload.fileName,
    blob: params.payload.blob,
    catalogVersion: params.payload.catalog.version,
    fieldCount: params.payload.catalog.fieldCount,
    issueCount: params.payload.catalog.issues.length,
    blockingIssueCount: params.payload.catalog.issues.filter((issue) => issue.severity === "error").length,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    catalog: params.payload.catalog,
  };
  const template: StoredTemplate = {
    id: templateId,
    tenantId: params.tenantId,
    name: params.payload.name.trim() || params.payload.fileName,
    documentType: params.payload.documentType.trim() || "report",
    status: "draft",
    currentVersionId: versionId,
    currentVersionNumber: 1,
    catalogVersion: version.catalogVersion,
    fieldCount: version.fieldCount,
    issueCount: version.issueCount,
    blockingIssueCount: version.blockingIssueCount,
    createdAt: now,
    updatedAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };

  await writeJsonFile(templateFilePath(params.tenantId, templateId, params.env), template);
  await writeJsonFile(templateVersionPath(params.tenantId, templateId, versionId, params.env), version);
  await appendAuditEvent(
    templateAuditPath(params.tenantId, templateId, params.env),
    createAuditEvent({
      targetType: "template",
      targetId: templateId,
      eventType: "template.created",
      actor: params.actor,
      metadata: { versionId, catalogVersion: version.catalogVersion },
      now: params.now,
    }),
  );

  return {
    ...template,
    currentVersion: version,
  };
}

export async function getWorkspaceTemplate(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceTemplateDetail | null> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return null;
  }
  const currentVersion = await readTemplateVersion(params.tenantId, params.templateId, template.currentVersionId, params.env);
  return {
    ...template,
    currentVersion,
  };
}

export async function createWorkspaceTemplateVersion(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  payload: CreateWorkspaceTemplatePayload;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceTemplateVersionSummary | null> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return null;
  }
  const now = (params.now || new Date()).toISOString();
  const versionId = crypto.randomUUID();
  const nextVersionNumber = template.currentVersionNumber + 1;
  const version: StoredTemplateVersion = {
    id: versionId,
    templateId: params.templateId,
    versionNumber: nextVersionNumber,
    fileName: params.payload.fileName,
    blob: params.payload.blob,
    catalogVersion: params.payload.catalog.version,
    fieldCount: params.payload.catalog.fieldCount,
    issueCount: params.payload.catalog.issues.length,
    blockingIssueCount: params.payload.catalog.issues.filter((issue) => issue.severity === "error").length,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    catalog: params.payload.catalog,
  };
  const nextTemplate: StoredTemplate = {
    ...template,
    name: params.payload.name.trim() || template.name,
    documentType: params.payload.documentType.trim() || template.documentType,
    currentVersionId: versionId,
    currentVersionNumber: nextVersionNumber,
    catalogVersion: version.catalogVersion,
    fieldCount: version.fieldCount,
    issueCount: version.issueCount,
    blockingIssueCount: version.blockingIssueCount,
    status: "draft",
    updatedAt: now,
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };
  await writeJsonFile(templateVersionPath(params.tenantId, params.templateId, versionId, params.env), version);
  await writeJsonFile(templateFilePath(params.tenantId, params.templateId, params.env), nextTemplate);
  await appendAuditEvent(
    templateAuditPath(params.tenantId, params.templateId, params.env),
    createAuditEvent({
      targetType: "template",
      targetId: params.templateId,
      eventType: "template.version_created",
      actor: params.actor,
      metadata: { versionId, versionNumber: nextVersionNumber },
      now: params.now,
    }),
  );
  return version;
}

export async function getWorkspaceTemplateVersion(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  versionId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceTemplateVersionSummary | null> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return null;
  }
  return readTemplateVersion(params.tenantId, params.templateId, params.versionId, params.env);
}

export async function listWorkspaceTemplateVersions(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceTemplateVersionSummary[]> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return [];
  }
  const versionDir = path.join(templateRoot(params.tenantId, params.templateId, params.env), VERSIONS_DIR);
  const ids = await fs.readdir(versionDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [] as string[];
    }
    throw error;
  });
  const versions = (await Promise.all(
    ids.filter((name) => name.endsWith(".json")).map((name) => readTemplateVersion(
      params.tenantId,
      params.templateId,
      name.replace(/\.json$/, ""),
      params.env,
    )),
  ))
    .filter((row): row is StoredTemplateVersion => !!row)
    .sort((left, right) => right.versionNumber - left.versionNumber);
  return versions;
}

export async function approveWorkspaceTemplate(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceTemplateDetail | null> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return null;
  }
  const currentVersion = await readTemplateVersion(params.tenantId, params.templateId, template.currentVersionId, params.env);
  if (!currentVersion) {
    throw new Error("Template current version is missing.");
  }
  if (countBlockingTemplateIssues(currentVersion) > 0) {
    throw new Error("Template has blocking catalog issues.");
  }
  const next: StoredTemplate = {
    ...template,
    status: "approved",
    updatedAt: (params.now || new Date()).toISOString(),
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };
  await writeJsonFile(templateFilePath(params.tenantId, params.templateId, params.env), next);
  await appendAuditEvent(
    templateAuditPath(params.tenantId, params.templateId, params.env),
    createAuditEvent({
      targetType: "template",
      targetId: params.templateId,
      eventType: "template.approved",
      actor: params.actor,
      metadata: { versionId: template.currentVersionId },
      now: params.now,
    }),
  );
  return {
    ...next,
    currentVersion,
  };
}

export async function deprecateWorkspaceTemplate(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceTemplateDetail | null> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return null;
  }
  const currentVersion = await readTemplateVersion(params.tenantId, params.templateId, template.currentVersionId, params.env);
  const next: StoredTemplate = {
    ...template,
    status: "deprecated",
    updatedAt: (params.now || new Date()).toISOString(),
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };
  await writeJsonFile(templateFilePath(params.tenantId, params.templateId, params.env), next);
  await appendAuditEvent(
    templateAuditPath(params.tenantId, params.templateId, params.env),
    createAuditEvent({
      targetType: "template",
      targetId: params.templateId,
      eventType: "template.deprecated",
      actor: params.actor,
      metadata: { versionId: template.currentVersionId },
      now: params.now,
    }),
  );
  return {
    ...next,
    currentVersion,
  };
}

export async function listWorkspaceTemplateAuditEvents(params: {
  tenantId: string;
  actor: WorkspaceActor;
  templateId: string;
  env?: WorkspaceEnv;
}): Promise<WorkspaceAuditEvent[]> {
  assertCanManageTenant(params.actor);
  const template = await readStoredTemplate(params.tenantId, params.templateId, params.env);
  if (!template) {
    return [];
  }
  return readAuditEvents(templateAuditPath(params.tenantId, params.templateId, params.env));
}

export async function restoreWorkspaceDocumentVersion(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  versionId: string;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentVersionSummary | null> {
  const document = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!document) {
    return null;
  }
  assertCanEditDocument(params.actor, document);

  const sourceVersion = await readDocumentVersion(params.tenantId, params.documentId, params.versionId, params.env);
  if (!sourceVersion) {
    return null;
  }

  const now = (params.now || new Date()).toISOString();
  const newVersionId = crypto.randomUUID();
  const nextVersionNumber = document.currentVersionNumber + 1;

  const newVersion: StoredDocumentVersion = {
    id: newVersionId,
    documentId: params.documentId,
    versionNumber: nextVersionNumber,
    label: `restore-v${sourceVersion.versionNumber}`,
    fileName: sourceVersion.fileName,
    blob: sourceVersion.blob,
    templateCatalogVersion: sourceVersion.templateCatalogVersion,
    templateFieldCount: sourceVersion.templateFieldCount,
    validationSummary: sourceVersion.validationSummary,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    editorDoc: sourceVersion.editorDoc,
  };

  const nextDocument: StoredDocument = {
    ...document,
    currentVersionId: newVersionId,
    currentVersionNumber: nextVersionNumber,
    templateCatalogVersion: newVersion.templateCatalogVersion,
    templateFieldCount: newVersion.templateFieldCount,
    validationSummary: newVersion.validationSummary,
    updatedAt: now,
    updatedBy: params.actor.userId,
    updatedByDisplayName: params.actor.displayName,
  };

  await writeJsonFile(documentVersionPath(params.tenantId, params.documentId, newVersionId, params.env), newVersion);
  await writeJsonFile(documentFilePath(params.tenantId, params.documentId, params.env), nextDocument);
  await appendAuditEvent(
    documentAuditPath(params.tenantId, params.documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: params.documentId,
      eventType: "document.version_restored",
      actor: params.actor,
      metadata: { newVersionId, restoredFromVersionId: params.versionId, versionNumber: nextVersionNumber },
      now: params.now,
    }),
  );

  const { editorDoc, ...summary } = newVersion;
  void editorDoc;
  return summary;
}

export async function duplicateWorkspaceDocument(params: {
  tenantId: string;
  actor: WorkspaceActor;
  documentId: string;
  newTitle?: string;
  env?: WorkspaceEnv;
  now?: Date;
}): Promise<WorkspaceDocumentDetail | null> {
  const sourceDocument = await readStoredDocument(params.tenantId, params.documentId, params.env);
  if (!sourceDocument) {
    return null;
  }
  assertCanReadDocument(params.actor, sourceDocument);

  const sourceVersion = await readDocumentVersion(
    params.tenantId,
    params.documentId,
    sourceDocument.currentVersionId,
    params.env,
  );

  const title = (params.newTitle || "").trim() || `${sourceDocument.title} (복사본)`;

  const newDocument = await createWorkspaceDocument({
    tenantId: params.tenantId,
    actor: params.actor,
    payload: {
      title,
      label: sourceVersion?.label || "copy",
      fileName: sourceVersion?.fileName || "",
      sourceFormat: sourceDocument.sourceFormat,
      editorDoc: sourceVersion?.editorDoc ?? null,
      templateCatalog: sourceVersion
        ? {
            version: sourceVersion.templateCatalogVersion || "",
            fieldCount: sourceVersion.templateFieldCount,
            rawTagCount: 0,
            fields: [],
            issues: [],
          }
        : null,
      validationSummary: sourceVersion?.validationSummary ?? null,
      blob: sourceVersion?.blob || {
        blobId: "",
        provider: "fs",
        fileName: "",
        contentType: "application/octet-stream",
        byteLength: 0,
        createdAt: (params.now || new Date()).toISOString(),
      },
    },
    env: params.env,
    now: params.now,
  });

  await appendAuditEvent(
    documentAuditPath(params.tenantId, params.documentId, params.env),
    createAuditEvent({
      targetType: "document",
      targetId: params.documentId,
      eventType: "document.duplicated",
      actor: params.actor,
      metadata: { newDocumentId: newDocument.id, title },
      now: params.now,
    }),
  );

  return newDocument;
}

// ── Template Version Review ───────────────────────────────────────────────────

function templateVersionReviewPath(
  tenantId: string,
  templateId: string,
  versionId: string,
  env?: WorkspaceEnv,
): string {
  return path.join(
    templateRoot(tenantId, templateId, env),
    VERSIONS_DIR,
    `${sanitizeId(versionId, "versionId")}.review.json`,
  );
}

export async function saveTemplateVersionReview(params: {
  tenantId: string;
  templateId: string;
  versionId: string;
  review: TemplateVersionReview;
  env?: WorkspaceEnv;
}): Promise<void> {
  const filePath = templateVersionReviewPath(
    params.tenantId,
    params.templateId,
    params.versionId,
    params.env,
  );
  await writeJsonFile(filePath, params.review);
}

export async function getTemplateVersionReview(params: {
  tenantId: string;
  templateId: string;
  versionId: string;
  env?: WorkspaceEnv;
}): Promise<TemplateVersionReview | null> {
  const filePath = templateVersionReviewPath(
    params.tenantId,
    params.templateId,
    params.versionId,
    params.env,
  );
  return readJsonFile<TemplateVersionReview>(filePath);
}
