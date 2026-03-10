import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  getWorkspaceTemplateVersion,
  listWorkspaceTemplateVersions,
  getTemplateVersionReview,
  saveTemplateVersionReview,
} from "@/lib/server/workspace-store";
import { buildWorkspaceActorFromSession } from "@/lib/server/workspace-route-utils";
import { workspaceErrorResponse } from "@/lib/server/workspace-api";
import { diffTemplateCatalogs } from "@/lib/server/template-diff";
import { generateTemplateVersionReview } from "@/lib/server/ai-review";
import type { TemplateVersionReview } from "@/lib/workspace-types";

export const runtime = "nodejs";

export const GET = withApiAuth(
  async (
    _request: NextRequest,
    session,
    context?: { params: Promise<{ templateId: string; versionId: string }> },
  ) => {
    try {
      const actor = buildWorkspaceActorFromSession(session);
      if (!context) {
        throw new Error("templateId and versionId are required.");
      }
      const { templateId, versionId } = await context.params;
      const review = await getTemplateVersionReview({
        tenantId: actor.tenantId,
        templateId,
        versionId,
      });
      if (!review) {
        return NextResponse.json({ error: "Review not found." }, { status: 404 });
      }
      return NextResponse.json({ review });
    } catch (error) {
      return workspaceErrorResponse(error, "Failed to get template version review.");
    }
  },
  { requireTenant: true },
) as unknown as (
  request: NextRequest,
  context: { params: Promise<{ templateId: string; versionId: string }> },
) => Promise<Response>;

export const POST = withApiAuth(
  async (
    _request: NextRequest,
    session,
    context?: { params: Promise<{ templateId: string; versionId: string }> },
  ) => {
    try {
      const actor = buildWorkspaceActorFromSession(session);
      if (!context) {
        throw new Error("templateId and versionId are required.");
      }
      const { templateId, versionId } = await context.params;

      // Get the current version
      const version = await getWorkspaceTemplateVersion({
        tenantId: actor.tenantId,
        actor,
        templateId,
        versionId,
      });
      if (!version) {
        return NextResponse.json({ error: "Template version not found." }, { status: 404 });
      }

      // Get all versions to find the previous one for diff
      const allVersions = await listWorkspaceTemplateVersions({
        tenantId: actor.tenantId,
        actor,
        templateId,
      });

      // Find previous version (lower versionNumber)
      const sortedVersions = allVersions.sort((a, b) => b.versionNumber - a.versionNumber);
      const currentIndex = sortedVersions.findIndex((v) => v.id === versionId);
      const previousVersion =
        currentIndex !== -1 && currentIndex + 1 < sortedVersions.length
          ? sortedVersions[currentIndex + 1]
          : null;

      // Compute diff if previous version exists
      const diff = previousVersion
        ? diffTemplateCatalogs(
            previousVersion.id,
            previousVersion.catalog,
            versionId,
            version.catalog,
          )
        : null;

      // Get template name from first version or use templateId
      const templateName = sortedVersions[0]?.fileName ?? templateId;

      // Generate the AI review
      const reviewResult = await generateTemplateVersionReview({
        templateName,
        version,
        diff,
      });

      const review: TemplateVersionReview = {
        id: crypto.randomUUID(),
        templateId,
        versionId,
        verdict: reviewResult.verdict,
        summary: reviewResult.summary,
        concerns: reviewResult.concerns,
        suggestions: reviewResult.suggestions,
        createdAt: new Date().toISOString(),
        createdBy: "ai",
        createdByDisplayName: `AI (${reviewResult.model})`,
        model: reviewResult.model,
      };

      await saveTemplateVersionReview({
        tenantId: actor.tenantId,
        templateId,
        versionId,
        review,
      });

      return NextResponse.json({ review });
    } catch (error) {
      return workspaceErrorResponse(error, "Failed to generate template version review.");
    }
  },
  { requireTenant: true },
) as unknown as (
  request: NextRequest,
  context: { params: Promise<{ templateId: string; versionId: string }> },
) => Promise<Response>;
