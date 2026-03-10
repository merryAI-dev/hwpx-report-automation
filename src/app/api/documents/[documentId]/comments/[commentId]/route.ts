import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { resolveDocumentComment, deleteDocumentComment } from "@/lib/server/comment-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string; commentId: string }> };

export const PATCH = withApiAuth(async (request, session, context?: RouteContext) => {
  const { documentId, commentId } = await (context?.params ?? Promise.resolve({ documentId: "", commentId: "" }));
  if (!documentId || !commentId) {
    return NextResponse.json({ error: "documentId and commentId are required." }, { status: 400 });
  }

  try {
    const actor = buildWorkspaceActorFromSession(session);
    const comment = await resolveDocumentComment({
      tenantId: actor.tenantId,
      documentId,
      commentId,
      actor,
    });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }
    return NextResponse.json({ comment });
  } catch (error) {
    return workspaceErrorResponse(error, "댓글 해결 처리에 실패했습니다.");
  }
}, { requireTenant: true });

export const DELETE = withApiAuth(async (request, session, context?: RouteContext) => {
  const { documentId, commentId } = await (context?.params ?? Promise.resolve({ documentId: "", commentId: "" }));
  if (!documentId || !commentId) {
    return NextResponse.json({ error: "documentId and commentId are required." }, { status: 400 });
  }

  try {
    const actor = buildWorkspaceActorFromSession(session);
    const deleted = await deleteDocumentComment({
      tenantId: actor.tenantId,
      documentId,
      commentId,
      actorUserId: actor.userId,
    });
    if (!deleted) {
      return NextResponse.json({ error: "Comment not found or access denied." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workspaceErrorResponse(error, "댓글 삭제에 실패했습니다.");
  }
}, { requireTenant: true });
