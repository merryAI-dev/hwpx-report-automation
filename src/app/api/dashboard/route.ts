import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { listWorkspaceDocuments, listWorkspaceTemplates } from "@/lib/server/workspace-store";
import { getTenantQuotaSummary } from "@/lib/server/quota-store";
import { getBatchJobManager } from "@/lib/server/batch-jobs";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";

export const runtime = "nodejs";

export const GET = withApiAuth(async (_request, session) => {
  try {
    const actor = buildWorkspaceActorFromSession(session);
    const tenantId = actor.tenantId;

    const [documents, templates, quota] = await Promise.all([
      listWorkspaceDocuments({ tenantId, actor }),
      listWorkspaceTemplates({ tenantId, actor }),
      getTenantQuotaSummary(tenantId),
    ]);

    const manager = getBatchJobManager();
    const allJobs = manager.listJobs(50);

    const activeJobCount = allJobs.filter((j) => j.status === "running" || j.status === "queued").length;
    const completedJobCount = allJobs.filter((j) => j.status === "completed").length;

    const approvedTemplateCount = templates.filter((t) => t.status === "approved").length;

    const recentDocuments = documents.slice(0, 5);
    const recentTemplates = templates.slice(0, 3);
    const recentJobs = allJobs.slice(0, 5).map((job) => ({
      id: job.id,
      status: job.status,
      instruction: job.instruction,
      totalItems: job.itemCount,
      completedItems: job.resultCount,
      createdAt: new Date(job.createdAt).toISOString(),
    }));

    return NextResponse.json({
      summary: {
        documentCount: documents.length,
        templateCount: templates.length,
        approvedTemplateCount,
        activeJobCount,
        completedJobCount,
        quota,
        recentDocuments,
        recentTemplates,
        recentJobs,
      },
    });
  } catch (error) {
    return workspaceErrorResponse(error, "Failed to load dashboard data.");
  }
}, { requireTenant: true });
