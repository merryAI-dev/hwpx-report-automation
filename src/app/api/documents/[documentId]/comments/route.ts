import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse, isRecord } from "@/lib/server/workspace-api";
import { listDocumentComments, createDocumentComment } from "@/lib/server/comment-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export const GET = withApiAuth(async (request, session, context?: RouteContext) => {
  const { documentId } = await (context?.params ?? Promise.resolve({ documentId: "" }));
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const includeResolved = searchParams.get("includeResolved") === "true";

  try {
    const actor = buildWorkspaceActorFromSession(session);
    const comments = await listDocumentComments({
      tenantId: actor.tenantId,
      documentId,
      includeResolved,
    });
    return NextResponse.json({ comments });
  } catch (error) {
    return workspaceErrorResponse(error, "댓글을 불러오지 못했습니다.");
  }
}, { requireTenant: true });

export const POST = withApiAuth(async (request, session, context?: RouteContext) => {
  const { documentId } = await (context?.params ?? Promise.resolve({ documentId: "" }));
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const commentBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!commentBody) {
    return NextResponse.json({ error: "Comment body is required." }, { status: 400 });
  }

  const segmentId = typeof body.segmentId === "string" ? body.segmentId : null;

  try {
    const actor = buildWorkspaceActorFromSession(session);
    const comment = await createDocumentComment({
      tenantId: actor.tenantId,
      documentId,
      actor,
      payload: { body: commentBody, segmentId },
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error, "댓글 작성에 실패했습니다.");
  }
}, { requireTenant: true });
