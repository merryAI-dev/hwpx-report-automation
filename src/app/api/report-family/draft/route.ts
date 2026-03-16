import OpenAI from "openai";
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import {
  DEFAULT_API_TIMEOUT_MS,
  handleApiError,
  withTimeout,
} from "@/lib/api-utils";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  checkMonthlyCostLimit,
  checkRateLimit,
  getClientIp,
  validateBodySize,
} from "@/lib/api-validation";
import { estimateCost } from "@/lib/ai-cost-tracker";
import {
  buildFallbackDraftSection,
  buildReportFamilyDraft,
  buildReportFamilyDraftPrompt,
  materializeDraftSection,
  type ReportFamilyDraft,
  type ReportFamilyDraftSection,
} from "@/lib/report-family-draft-generator";
import type { ReportFamilyPlan, SectionPromptPlan } from "@/lib/report-family-planner";
import { prisma } from "@/lib/persistence/client";
import type { AuthenticatedSession } from "@/lib/auth/with-api-auth";
import { buildPromptMemoryContext } from "@/lib/feedback/prompt-memory-builder";

type RequestBody = {
  plan?: ReportFamilyPlan | null;
  model?: string;
  maxAttempts?: number;
  preferAi?: boolean;
  monthlyCostLimitUsd?: number;
  /** If true, persist a GenerationRun record for RLHF feedback capture */
  saveGenerationRun?: boolean;
  /** Required when saveGenerationRun=true */
  familyId?: string;
};

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
};

type DraftRouteResponse = {
  draft: ReportFamilyDraft;
  generationRunId?: string;
  usage: {
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
};

type RawDraftResponse = {
  sections?: Array<Record<string, unknown>>;
};

const SECTION_BATCH_SIZE = 6;

function chunkSections<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function validatePlan(plan: ReportFamilyPlan | null | undefined): ReportFamilyPlan {
  if (!plan || typeof plan !== "object") {
    throw new ValidationError("plan 필드가 필요합니다.");
  }
  if (!Array.isArray(plan.sectionPlans) || !plan.sectionPlans.length) {
    throw new ValidationError("plan.sectionPlans가 비어 있습니다.");
  }
  if (!Array.isArray(plan.toc) || !plan.familyName) {
    throw new ValidationError("유효한 report family plan이 아닙니다.");
  }
  return plan;
}

function parseDraftResponse(raw: string): RawDraftResponse {
  const trimmed = raw.trim();
  const direct = safeParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const nested = safeParseJson(trimmed.slice(start, end + 1));
    if (nested) {
      return nested;
    }
  }

  throw new ValidationError("AI 응답에서 draft JSON을 파싱하지 못했습니다.");
}

function safeParseJson(value: string): RawDraftResponse | null {
  try {
    return JSON.parse(value) as RawDraftResponse;
  } catch {
    return null;
  }
}

async function requestDraftBatch(params: {
  client: OpenAI;
  model: string;
  plan: ReportFamilyPlan;
  sections: SectionPromptPlan[];
  retryIssuesBySectionId?: Record<string, string[]>;
  promptMemoryContextBySectionType?: Record<string, string>;
}): Promise<{
  content: RawDraftResponse;
  usage: UsageTotals;
}> {
  // Merge prompt memory contexts for this batch's section types
  const memoryContexts = params.promptMemoryContextBySectionType;
  const batchSectionTypes = [...new Set(params.sections.map((s) => s.sectionType))];
  const memoryLines = batchSectionTypes
    .map((t) => memoryContexts?.[t])
    .filter((c): c is string => !!c);
  const promptMemoryContext = memoryLines.length ? memoryLines.join("\n\n") : undefined;

  const prompt = buildReportFamilyDraftPrompt(params.plan, params.sections, {
    retryIssuesBySectionId: params.retryIssuesBySectionId,
    promptMemoryContext,
  });

  const completion = await log.time(
    "report-family-draft.openai",
    () =>
      withTimeout(
        params.client.chat.completions.create({
          model: params.model,
          temperature: 0.25,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "너는 슬라이드 근거만으로 제출형 한국어 보고서 초안을 생성하는 AI다. 응답은 반드시 JSON 하나만 반환한다. 슬라이드 bullet을 그대로 복제하지 말고 보고서 문체로 재구성하되, packet에 없는 내용을 지어내지 않는다.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
        DEFAULT_API_TIMEOUT_MS,
        "OpenAI report-family-draft",
      ),
    {
      model: params.model,
      sectionCount: params.sections.length,
    },
  );

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new ValidationError("AI가 report draft를 생성하지 못했습니다.");
  }

  return {
    content: parseDraftResponse(content),
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

async function buildDraftWithAi(params: {
  plan: ReportFamilyPlan;
  model: string;
  maxAttempts: number;
}): Promise<{
  draft: ReportFamilyDraft;
  usage: UsageTotals;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      draft: buildReportFamilyDraft(params.plan, {
        engine: "fallback",
        warnings: ["OPENAI_API_KEY가 없어 deterministic fallback draft를 사용했습니다."],
      }),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });

  const sectionsById = new Map<string, ReportFamilyDraftSection>(
    params.plan.sectionPlans.map((section) => [section.tocEntryId, buildFallbackDraftSection(section)]),
  );
  const warnings: string[] = [];
  let aiSuccessCount = 0;
  const usageTotals: UsageTotals = { inputTokens: 0, outputTokens: 0 };

  // Load PromptMemory contexts keyed by sectionType
  const promptMemoryContextBySectionType: Record<string, string> = {};
  if (params.plan.familyId) {
    const sectionTypes = [...new Set(params.plan.sectionPlans.map((s) => s.sectionType))];
    await Promise.all(
      sectionTypes.map(async (sectionType) => {
        const ctx = await buildPromptMemoryContext({
          familyId: params.plan.familyId,
          sectionType,
          maxMemories: 3,
        });
        if (ctx) promptMemoryContextBySectionType[sectionType] = ctx;
      }),
    );
  }

  for (const batch of chunkSections(params.plan.sectionPlans, SECTION_BATCH_SIZE)) {
    try {
      const response = await requestDraftBatch({
        client,
        model: params.model,
        plan: params.plan,
        sections: batch,
        promptMemoryContextBySectionType,
      });
      usageTotals.inputTokens += response.usage.inputTokens;
      usageTotals.outputTokens += response.usage.outputTokens;

      const items = Array.isArray(response.content.sections) ? response.content.sections : [];
      for (const section of batch) {
        const payload =
          items.find((item) => String(item.tocEntryId || "").trim() === section.tocEntryId) || null;
        if (!payload) {
          warnings.push(`${section.tocTitle}: AI 응답에서 섹션 초안을 찾지 못해 fallback을 유지했습니다.`);
          continue;
        }
        sectionsById.set(
          section.tocEntryId,
          materializeDraftSection(section, payload, {
            attempts: 1,
            usedFallback: false,
          }),
        );
        aiSuccessCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI batch draft generation failed";
      warnings.push(`AI batch generation failed: ${message}`);
    }
  }

  for (let attempt = 2; attempt <= params.maxAttempts; attempt += 1) {
    const failedSections = params.plan.sectionPlans.filter((section) => {
      const drafted = sectionsById.get(section.tocEntryId);
      return !drafted || !drafted.evaluation.passed;
    });
    if (!failedSections.length) {
      break;
    }

    for (const section of failedSections) {
      const current = sectionsById.get(section.tocEntryId) || buildFallbackDraftSection(section);
      try {
        const response = await requestDraftBatch({
          client,
          model: params.model,
          plan: params.plan,
          sections: [section],
          retryIssuesBySectionId: {
            [section.tocEntryId]: current.evaluation.issues,
          },
        });
        usageTotals.inputTokens += response.usage.inputTokens;
        usageTotals.outputTokens += response.usage.outputTokens;

        const payload =
          Array.isArray(response.content.sections) && response.content.sections.length
            ? response.content.sections[0]
            : null;
        if (!payload) {
          warnings.push(`${section.tocTitle}: retry 응답이 비어 fallback을 유지했습니다.`);
          continue;
        }
        sectionsById.set(
          section.tocEntryId,
          materializeDraftSection(section, payload, {
            attempts: attempt,
            usedFallback: false,
          }),
        );
        aiSuccessCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI retry failed";
        warnings.push(`${section.tocTitle}: retry failed (${message})`);
      }
    }
  }

  return {
    draft: buildReportFamilyDraft(params.plan, {
      engine: aiSuccessCount > 0 ? "openai" : "fallback",
      warnings,
      sections: params.plan.sectionPlans.map(
        (section) => sectionsById.get(section.tocEntryId) || buildFallbackDraftSection(section),
      ),
    }),
    usage: usageTotals,
  };
}

async function handlePost(request: Request, session: AuthenticatedSession) {
  const rateLimitResp = checkRateLimit(getClientIp(request));
  if (rateLimitResp) {
    return rateLimitResp;
  }

  try {
    const rawBody = await request.text();
    const bodySizeResp = validateBodySize(rawBody);
    if (bodySizeResp) {
      return bodySizeResp;
    }

    const body = JSON.parse(rawBody) as RequestBody;
    const plan = validatePlan(body.plan);
    const model = String(body.model || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
    const maxAttempts = Math.max(1, Math.min(3, Number(body.maxAttempts || 2)));
    const preferAi = body.preferAi !== false;

    const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
    if (costLimitResp) {
      return costLimitResp;
    }

    const result = preferAi
      ? await buildDraftWithAi({
          plan,
          model,
          maxAttempts,
        })
      : {
          draft: buildReportFamilyDraft(plan, {
            engine: "fallback",
            warnings: ["preferAi=false로 deterministic fallback draft를 생성했습니다."],
          }),
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
        };

    const estimatedCostUsd =
      result.usage.inputTokens || result.usage.outputTokens
        ? estimateCost(model, result.usage.inputTokens, result.usage.outputTokens).estimatedCostUsd
        : 0;

    // Optionally persist a GenerationRun for RLHF feedback capture
    let generationRunId: string | undefined;
    if (body.saveGenerationRun && body.familyId) {
      try {
        const run = await prisma.generationRun.create({
          data: {
            familyId: body.familyId,
            planJson: JSON.stringify(plan),
            draftJson: JSON.stringify(result.draft),
            model: result.draft.engine === "openai" ? model : "fallback",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            status: "pending_review",
          },
        });
        generationRunId = run.id;
        log.info("GenerationRun saved", {
          generationRunId: run.id,
          familyId: body.familyId,
          email: session.email,
        });
      } catch (err) {
        // Non-fatal: don't fail the draft if run persistence fails
        log.warn("Failed to save GenerationRun", { error: String(err) });
      }
    }

    return NextResponse.json({
      draft: result.draft,
      ...(generationRunId ? { generationRunId } : {}),
      usage: {
        model: result.draft.engine === "openai" ? model : null,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostUsd,
      },
    } satisfies DraftRouteResponse);
  } catch (error) {
    return handleApiError(error, "/api/report-family/draft");
  }
}

export const POST = withApiAuth(handlePost);
