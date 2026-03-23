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
  /** Free-text instruction applied to every section */
  globalInstruction?: string;
  /** Per-section instructions keyed by tocEntryId */
  sectionInstructions?: Record<string, string>;
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

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

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
  userGlobalInstruction?: string;
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
    userGlobalInstruction: params.userGlobalInstruction,
  });

  const completion = await log.time(
    "report-family-draft.openai",
    () =>
      withTimeout(
        params.client.chat.completions.create({
          model: params.model,
          temperature: 0.05,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "너는 제출형 한국어 보고서 초안을 작성하는 AI다. 응답은 반드시 JSON 하나만 반환한다.\n\n[엄격한 규칙]\n1. 오직 supporting_slide_chunks와 appendix_evidence_bundles에 명시된 내용만 사용한다.\n2. 슬라이드 근거에 없는 수치, 사실, 평가, 인용을 절대 생성하지 않는다.\n3. 근거가 부족한 항목은 해당 내용을 쓰지 말고 생략한다.\n4. bullet을 그대로 복사하지 않고 보고서 문체로 재구성하되, 의미를 바꾸지 않는다.\n5. 위 규칙 위반은 치명적 오류다.",
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
  userGlobalInstruction?: string;
  onSectionComplete?: (title: string, completed: number, total: number) => void;
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
  let completedCount = 0;
  const totalCount = params.plan.sectionPlans.length;
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
        userGlobalInstruction: params.userGlobalInstruction,
      });
      usageTotals.inputTokens += response.usage.inputTokens;
      usageTotals.outputTokens += response.usage.outputTokens;

      const items = Array.isArray(response.content.sections) ? response.content.sections : [];
      for (const section of batch) {
        const payload =
          items.find((item) => String(item.tocEntryId || "").trim() === section.tocEntryId) || null;
        if (!payload) {
          warnings.push(`${section.tocTitle}: AI 응답에서 섹션 초안을 찾지 못해 fallback을 유지했습니다.`);
        } else {
          sectionsById.set(
            section.tocEntryId,
            materializeDraftSection(section, payload, {
              attempts: 1,
              usedFallback: false,
            }),
          );
          aiSuccessCount += 1;
        }
        completedCount += 1;
        params.onSectionComplete?.(section.tocTitle, completedCount, totalCount);
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
          userGlobalInstruction: params.userGlobalInstruction,
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
  if (rateLimitResp) return rateLimitResp;

  const rawBody = await request.text();
  const bodySizeResp = validateBodySize(rawBody);
  if (bodySizeResp) return bodySizeResp;

  let body: RequestBody;
  try {
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  let basePlan: ReportFamilyPlan;
  try {
    basePlan = validatePlan(body.plan);
  } catch (error) {
    return handleApiError(error, "/api/report-family/draft");
  }

  const model = String(body.model || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
  const maxAttempts = Math.max(1, Math.min(3, Number(body.maxAttempts || 2)));
  const preferAi = body.preferAi !== false;

  const sectionInstructions = body.sectionInstructions ?? {};
  const plan = Object.keys(sectionInstructions).length
    ? {
        ...basePlan,
        sectionPlans: basePlan.sectionPlans.map((sp) =>
          sectionInstructions[sp.tocEntryId]
            ? { ...sp, customInstruction: sectionInstructions[sp.tocEntryId] }
            : sp,
        ),
      }
    : basePlan;

  const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
  if (costLimitResp) return costLimitResp;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = preferAi
          ? await buildDraftWithAi({
              plan,
              model,
              maxAttempts,
              userGlobalInstruction: body.globalInstruction,
              onSectionComplete: (title, completed, total) => {
                sendSSE(controller, encoder, "section_complete", {
                  currentTitle: title,
                  completedCount: completed,
                  totalCount: total,
                });
              },
            })
          : {
              draft: buildReportFamilyDraft(plan, {
                engine: "fallback",
                warnings: ["preferAi=false로 deterministic fallback draft를 생성했습니다."],
              }),
              usage: { inputTokens: 0, outputTokens: 0 },
            };

        const estimatedCostUsd =
          result.usage.inputTokens || result.usage.outputTokens
            ? estimateCost(model, result.usage.inputTokens, result.usage.outputTokens).estimatedCostUsd
            : 0;

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
            log.info("GenerationRun saved", { generationRunId: run.id, familyId: body.familyId, email: session.email });
          } catch (err) {
            log.warn("Failed to save GenerationRun", { error: String(err) });
          }
        }

        sendSSE(controller, encoder, "done", {
          draft: result.draft,
          ...(generationRunId ? { generationRunId } : {}),
          usage: {
            model: result.draft.engine === "openai" ? model : null,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            estimatedCostUsd,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "초안 생성 중 오류가 발생했습니다.";
        sendSSE(controller, encoder, "error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const POST = withApiAuth(handlePost);
