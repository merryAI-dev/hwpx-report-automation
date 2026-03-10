import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveBlobStorageRoot } from "@/lib/server/blob-store";
import type { WorkspaceActor } from "./workspace-store";

export type WorkspaceComment = {
  id: string;
  documentId: string;
  tenantId: string;
  body: string;
  segmentId?: string | null;
  resolved: boolean;
  createdAt: string;
  createdBy: string;
  createdByDisplayName: string;
  updatedAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolvedByDisplayName?: string | null;
};

export type CreateCommentPayload = {
  body: string;
  segmentId?: string | null;
};

function commentsFilePath(tenantId: string, documentId: string, env?: Partial<NodeJS.ProcessEnv>): string {
  const root = resolveBlobStorageRoot(env);
  return path.join(root, "workspace", "tenants", sanitizeId(tenantId), "documents", sanitizeId(documentId), "comments.jsonl");
}

function sanitizeId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!normalized) throw new Error("id is required");
  return normalized;
}

async function readAllComments(filePath: string): Promise<WorkspaceComment[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkspaceComment);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeAllComments(filePath: string, comments: WorkspaceComment[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = comments.map((c) => JSON.stringify(c)).join("\n") + (comments.length > 0 ? "\n" : "");
  await fs.writeFile(filePath, content, "utf8");
}

export async function listDocumentComments(params: {
  tenantId: string;
  documentId: string;
  includeResolved?: boolean;
  env?: Partial<NodeJS.ProcessEnv>;
}): Promise<WorkspaceComment[]> {
  const filePath = commentsFilePath(params.tenantId, params.documentId, params.env);
  const all = await readAllComments(filePath);
  const filtered = params.includeResolved ? all : all.filter((c) => !c.resolved);
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createDocumentComment(params: {
  tenantId: string;
  documentId: string;
  actor: WorkspaceActor;
  payload: CreateCommentPayload;
  env?: Partial<NodeJS.ProcessEnv>;
  now?: Date;
}): Promise<WorkspaceComment> {
  const body = params.payload.body.trim().slice(0, 2000);
  if (!body) {
    throw new Error("Comment body is required.");
  }

  const now = (params.now || new Date()).toISOString();
  const comment: WorkspaceComment = {
    id: crypto.randomUUID(),
    documentId: params.documentId,
    tenantId: params.tenantId,
    body,
    segmentId: params.payload.segmentId ?? null,
    resolved: false,
    createdAt: now,
    createdBy: params.actor.userId,
    createdByDisplayName: params.actor.displayName,
    updatedAt: now,
    resolvedAt: null,
    resolvedBy: null,
    resolvedByDisplayName: null,
  };

  const filePath = commentsFilePath(params.tenantId, params.documentId, params.env);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(comment)}\n`, "utf8");

  return comment;
}

export async function resolveDocumentComment(params: {
  tenantId: string;
  documentId: string;
  commentId: string;
  actor: WorkspaceActor;
  env?: Partial<NodeJS.ProcessEnv>;
  now?: Date;
}): Promise<WorkspaceComment | null> {
  const filePath = commentsFilePath(params.tenantId, params.documentId, params.env);
  const all = await readAllComments(filePath);
  const index = all.findIndex((c) => c.id === params.commentId);
  if (index === -1) return null;

  const now = (params.now || new Date()).toISOString();
  const updated: WorkspaceComment = {
    ...all[index]!,
    resolved: true,
    updatedAt: now,
    resolvedAt: now,
    resolvedBy: params.actor.userId,
    resolvedByDisplayName: params.actor.displayName,
  };
  all[index] = updated;
  await writeAllComments(filePath, all);
  return updated;
}

export async function deleteDocumentComment(params: {
  tenantId: string;
  documentId: string;
  commentId: string;
  actorUserId: string;
  env?: Partial<NodeJS.ProcessEnv>;
}): Promise<boolean> {
  const filePath = commentsFilePath(params.tenantId, params.documentId, params.env);
  const all = await readAllComments(filePath);
  const comment = all.find((c) => c.id === params.commentId);
  if (!comment) return false;
  if (comment.createdBy !== params.actorUserId) return false;

  const remaining = all.filter((c) => c.id !== params.commentId);
  await writeAllComments(filePath, remaining);
  return true;
}
