import { describe, it, expect, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  createDocumentComment,
  listDocumentComments,
  resolveDocumentComment,
  deleteDocumentComment,
} from "./comment-store";
import type { WorkspaceActor } from "./workspace-store";

const actor: WorkspaceActor = {
  userId: "user-1",
  email: "user@example.com",
  displayName: "Test User",
  tenantId: "tenant-1",
  tenantName: "Test Tenant",
  tenantRole: "owner",
};

let tempDir: string;
let env: Partial<NodeJS.ProcessEnv>;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "comment-store-test-"));
  env = { BLOB_STORAGE_FS_ROOT: tempDir };
});

describe("createDocumentComment", () => {
  it("writes a comment to a JSONL file", async () => {
    const comment = await createDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      actor,
      payload: { body: "첫 번째 댓글" },
      env,
    });

    expect(comment.id).toBeTruthy();
    expect(comment.body).toBe("첫 번째 댓글");
    expect(comment.resolved).toBe(false);
    expect(comment.createdBy).toBe("user-1");

    // Verify file exists
    const filePath = path.join(tempDir, "workspace", "tenants", "tenant-1", "documents", "doc-1", "comments.jsonl");
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toContain("첫 번째 댓글");
  });

  it("appends multiple comments", async () => {
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 1" }, env });
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 2" }, env });

    const filePath = path.join(tempDir, "workspace", "tenants", "tenant-1", "documents", "doc-1", "comments.jsonl");
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("includes segmentId when provided", async () => {
    const comment = await createDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      actor,
      payload: { body: "단락 댓글", segmentId: "para-abc" },
      env,
    });
    expect(comment.segmentId).toBe("para-abc");
  });
});

describe("listDocumentComments", () => {
  it("returns comments sorted by createdAt desc", async () => {
    const now = new Date();
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "오래된 댓글" }, env, now: new Date(now.getTime() - 60000) });
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "새 댓글" }, env, now });

    const comments = await listDocumentComments({ tenantId: "tenant-1", documentId: "doc-1", env });
    expect(comments[0].body).toBe("새 댓글");
    expect(comments[1].body).toBe("오래된 댓글");
  });

  it("returns empty array for non-existent document", async () => {
    const comments = await listDocumentComments({ tenantId: "tenant-1", documentId: "no-doc", env });
    expect(comments).toHaveLength(0);
  });

  it("filters resolved comments by default (includeResolved=false)", async () => {
    const c1 = await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 1" }, env });
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 2" }, env });
    await resolveDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", commentId: c1.id, actor, env });

    const comments = await listDocumentComments({ tenantId: "tenant-1", documentId: "doc-1", includeResolved: false, env });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("댓글 2");
  });

  it("includes resolved comments when includeResolved=true", async () => {
    const c1 = await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 1" }, env });
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글 2" }, env });
    await resolveDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", commentId: c1.id, actor, env });

    const comments = await listDocumentComments({ tenantId: "tenant-1", documentId: "doc-1", includeResolved: true, env });
    expect(comments).toHaveLength(2);
  });
});

describe("resolveDocumentComment", () => {
  it("marks a comment as resolved", async () => {
    const comment = await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "해결할 댓글" }, env });
    const resolved = await resolveDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      commentId: comment.id,
      actor,
      env,
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.resolved).toBe(true);
    expect(resolved!.resolvedBy).toBe("user-1");
    expect(resolved!.resolvedAt).toBeTruthy();
  });

  it("returns null for non-existent comment", async () => {
    await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "댓글" }, env });
    const result = await resolveDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      commentId: "non-existent-id",
      actor,
      env,
    });
    expect(result).toBeNull();
  });
});

describe("deleteDocumentComment", () => {
  it("deletes a comment by owner", async () => {
    const comment = await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "삭제할 댓글" }, env });
    const deleted = await deleteDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      commentId: comment.id,
      actorUserId: "user-1",
      env,
    });
    expect(deleted).toBe(true);

    const remaining = await listDocumentComments({ tenantId: "tenant-1", documentId: "doc-1", includeResolved: true, env });
    expect(remaining).toHaveLength(0);
  });

  it("returns false for non-owner", async () => {
    const comment = await createDocumentComment({ tenantId: "tenant-1", documentId: "doc-1", actor, payload: { body: "내 댓글" }, env });
    const deleted = await deleteDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      commentId: comment.id,
      actorUserId: "other-user",
      env,
    });
    expect(deleted).toBe(false);
  });

  it("returns false for non-existent comment", async () => {
    const deleted = await deleteDocumentComment({
      tenantId: "tenant-1",
      documentId: "doc-1",
      commentId: "non-existent",
      actorUserId: "user-1",
      env,
    });
    expect(deleted).toBe(false);
  });
});
