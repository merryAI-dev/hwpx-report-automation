import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { searchWorkspace } from "@/lib/server/search-store";
import type { SearchResultType } from "@/lib/server/search-store";

export const runtime = "nodejs";

export const GET = withApiAuth(async (request, session) => {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const typeParam = (searchParams.get("type") || "all").trim();
  const limitParam = searchParams.get("limit");

  if (!q) {
    return NextResponse.json({ error: "Query parameter 'q' is required." }, { status: 400 });
  }

  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 20, 50) : 20;

  let types: SearchResultType[] | undefined;
  if (typeParam === "document") {
    types = ["document"];
  } else if (typeParam === "template") {
    types = ["template"];
  } else {
    types = ["document", "template"];
  }

  try {
    const actor = buildWorkspaceActorFromSession(session);
    const results = await searchWorkspace({
      tenantId: actor.tenantId,
      actor,
      query: q,
      types,
      limit,
    });
    return NextResponse.json({ results });
  } catch (error) {
    return workspaceErrorResponse(error, "검색 중 오류가 발생했습니다.");
  }
}, { requireTenant: true });
