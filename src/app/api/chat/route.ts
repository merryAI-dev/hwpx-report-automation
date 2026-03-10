import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  DocumentContext,
  DocumentContextSegment,
} from "@/types/chat";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { requireApiKey } from "@/lib/api-utils";
import { extractErrorMessage } from "@/lib/errors";
import { log } from "@/lib/logger";
import {
  validateBodySize,
  validateMessageCount,
  validateSegmentCount,
  checkRateLimit,
  checkMonthlyCostLimit,
  getClientIp,
} from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import { estimateCost } from "@/lib/ai-cost-tracker";

const SYSTEM_PROMPT = `너는 한국어 문서 편집 전문 AI 어시스턴트다.
사용자의 자연어 지시에 따라 문서를 분석하고 수정한다.

규칙:
1. 수정 전 반드시 read_document 도구로 현재 문서 내용을 확인하라.
2. 수정 후 변경 사항을 간결하게 보고하라.
3. 원문의 의미를 훼손하지 않도록 주의하라.
4. 한국어로 응답하라.
5. 표를 채우기 전 반드시 read_table_structure로 표 구조(헤더, 행/열 수)를 확인하라.
6. fill_table_rows에서 헤더 이름은 read_table_structure에서 확인한 정확한 이름을 사용하라.
7. fill_table_rows는 사용자가 제공한 데이터가 있으면 불필요한 확인 없이 한 번의 호출로 모든 행을 채워라. 행을 나눠서 여러 번 호출하지 말고 rows 배열에 전부 담아라.
8. 사용자가 이미 데이터를 제공했을 때 추가 확인 질문을 하지 말라. 바로 실행하라.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_document",
    description:
      "현재 문서의 세그먼트(문단/제목) 목록을 조회합니다. startIndex/endIndex로 범위를 지정하거나, segmentIds로 특정 세그먼트만 조회할 수 있습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        startIndex: { type: "number", description: "시작 인덱스 (생략시 0)" },
        endIndex: { type: "number", description: "끝 인덱스 (생략시 전체)" },
        segmentIds: {
          type: "array",
          items: { type: "string" },
          description: "특정 segmentId 목록 (지정 시 범위 무시)",
        },
      },
    },
  },
  {
    name: "read_segment",
    description: "특정 segmentId의 텍스트를 조회합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        segmentId: { type: "string", description: "조회할 세그먼트 ID" },
      },
      required: ["segmentId"],
    },
  },
  {
    name: "edit_segment",
    description: "특정 세그먼트의 텍스트를 새 텍스트로 교체합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        segmentId: { type: "string" },
        newText: { type: "string" },
      },
      required: ["segmentId", "newText"],
    },
  },
  {
    name: "edit_segments",
    description: "여러 세그먼트를 한 번에 수정합니다. 대량 편집에 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              segmentId: { type: "string" },
              newText: { type: "string" },
            },
            required: ["segmentId", "newText"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "search_replace",
    description: "문서 전체에서 문자열을 찾아 치환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: { type: "string", description: "찾을 문자열" },
        replace: { type: "string", description: "치환할 문자열" },
        caseSensitive: {
          type: "boolean",
          description: "대소문자 구분 (기본 true)",
        },
      },
      required: ["search", "replace"],
    },
  },
  {
    name: "analyze_style",
    description: "문서의 전반적 스타일, 톤, 일관성을 분석합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "read_table_structure",
    description: "문서의 표 목록과 각 표의 헤더, 행/열 수를 조회합니다.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "fill_table_rows",
    description: "특정 표의 행들을 데이터로 채웁니다. 헤더 이름을 키로 사용합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        tableIndex: { type: "number", description: "표 인덱스 (0-based)" },
        startRow: { type: "number", description: "채우기 시작 행 인덱스 (0-based, 기본 1 = 헤더 다음 행)" },
        rows: {
          type: "array",
          items: { type: "object" },
          description: "각 행의 {헤더명: 값} 객체 배열",
        },
      },
      required: ["tableIndex", "rows"],
    },
  },
];

const READ_ONLY_TOOLS = new Set(["read_document", "read_segment", "analyze_style", "read_table_structure"]);

/* ── Read-only tool execution (server-side) ── */

function executeReadTool(
  toolName: string,
  input: Record<string, unknown>,
  docCtx: DocumentContext,
): string {
  const segments = docCtx.segments;

  if (toolName === "read_document") {
    const segmentIds = input.segmentIds as string[] | undefined;
    if (segmentIds && segmentIds.length > 0) {
      const found = segments.filter((s) => segmentIds.includes(s.segmentId));
      return JSON.stringify(
        found.map((s) => ({ id: s.segmentId, tag: s.tag, text: s.text })),
      );
    }
    const start = (input.startIndex as number) || 0;
    const end = (input.endIndex as number) || segments.length;
    const slice = segments.slice(start, end);
    return JSON.stringify(
      slice.map((s, i) => ({
        index: start + i,
        id: s.segmentId,
        tag: s.tag,
        text: s.text,
      })),
    );
  }

  if (toolName === "read_segment") {
    const segmentId = input.segmentId as string;
    const seg = segments.find((s) => s.segmentId === segmentId);
    if (!seg) return JSON.stringify({ error: `Segment not found: ${segmentId}` });
    return JSON.stringify({ id: seg.segmentId, tag: seg.tag, text: seg.text });
  }

  if (toolName === "analyze_style") {
    return analyzeDocumentStyle(segments);
  }

  if (toolName === "read_table_structure") {
    return JSON.stringify(docCtx.tables ?? []);
  }

  return JSON.stringify({ error: `Unknown read tool: ${toolName}` });
}

function analyzeDocumentStyle(segments: DocumentContextSegment[]): string {
  const headings = segments.filter((s) => s.tag === "h2" || s.tag === "h1" || s.tag === "h3");
  const paragraphs = segments.filter((s) => s.tag === "p" || s.tag === "t");
  const allText = segments.map((s) => s.text).join("\n");
  const avgLen =
    paragraphs.length > 0
      ? Math.round(paragraphs.reduce((sum, s) => sum + s.text.length, 0) / paragraphs.length)
      : 0;

  const hasHonorific = /합니다|입니다|습니다/.test(allText);
  const hasCasual = /한다\.|이다\.|된다\./.test(allText);
  const hasMixed = hasHonorific && hasCasual;

  return JSON.stringify({
    totalSegments: segments.length,
    headingCount: headings.length,
    paragraphCount: paragraphs.length,
    averageParagraphLength: avgLen,
    toneAnalysis: hasMixed
      ? "혼합체 (합쇼체 + 해라체 혼용)"
      : hasHonorific
        ? "합쇼체 (존댓말)"
        : hasCasual
          ? "해라체 (반말/서술체)"
          : "기타/판단 불가",
    totalCharacters: allText.length,
  });
}

/* ── SSE helpers ── */

function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

/* ── Route handler ── */

async function handlePost(request: Request) {
  // ── Rate limiting ──
  const rateLimitResp = checkRateLimit(getClientIp(request));
  if (rateLimitResp) return rateLimitResp;

  let apiKey: string;
  try {
    apiKey = requireApiKey("ANTHROPIC_API_KEY", "Anthropic");
  } catch (err) {
    return new Response(
      JSON.stringify({ error: extractErrorMessage(err), code: "API_KEY_MISSING" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Body size validation (read raw text first, then parse) ──
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response(
      JSON.stringify({ error: "요청 본문을 읽을 수 없습니다.", code: "VALIDATION_FAILED" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const bodySizeResp = validateBodySize(rawBody);
  if (bodySizeResp) return bodySizeResp;

  let body: ChatRequest;
  try {
    body = JSON.parse(rawBody) as ChatRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "요청 본문이 올바른 JSON이 아닙니다.", code: "VALIDATION_FAILED" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Message & segment count validation ──
  if (body.messages) {
    const msgResp = validateMessageCount(body.messages);
    if (msgResp) return msgResp;
  }
  if (body.documentContext?.segments) {
    const segResp = validateSegmentCount(body.documentContext.segments);
    if (segResp) return segResp;
  }

  // ── Monthly cost limit check ──
  const costLimitResp = await checkMonthlyCostLimit(body.monthlyCostLimitUsd ?? 0);
  if (costLimitResp) return costLimitResp;

  const { messages, documentContext, approvedToolCall } = body;
  const client = new Anthropic({ apiKey });
  const model = body.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

  // Convert ChatMessageAPI[] → Anthropic MessageParam[]
  const anthropicMessages: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      anthropicMessages.push({ role: msg.role, content: msg.content });
    } else {
      anthropicMessages.push({
        role: msg.role,
        content: msg.content as Anthropic.ContentBlockParam[],
      });
    }
  }

  // Continuation after tool approval/rejection: add tool_result
  if (approvedToolCall) {
    anthropicMessages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: approvedToolCall.toolCallId,
          content: approvedToolCall.result,
        },
      ],
    });
  }

  const encoder = new TextEncoder();
  const usage = { inputTokens: 0, outputTokens: 0, iterations: 0 };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runAgentLoop(client, model, anthropicMessages, documentContext, controller, encoder, usage);
      } catch (err) {
        const message = extractErrorMessage(err);
        log.error("Chat agent loop error", err);
        sendSSE(controller, encoder, "error", { type: "error", message });
      } finally {
        const cost = estimateCost(model, usage.inputTokens, usage.outputTokens);
        recordAudit("system", "ai-chat", "/api/chat", {
          messageCount: messages.length,
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          iterations: usage.iterations,
          costUsd: cost.estimatedCostUsd,
        });
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

/* ── Agent loop: streaming + correct multi-tool handling ── */

async function runAgentLoop(
  client: Anthropic,
  model: string,
  messages: Anthropic.MessageParam[],
  docCtx: DocumentContext,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  usage: { inputTokens: number; outputTokens: number; iterations: number },
) {
  const MAX_ITERATIONS = 10;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Use streaming API for incremental text delivery
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    stream.on("text", (textDelta) => {
      sendSSE(controller, encoder, "text_delta", {
        type: "text_delta",
        content: textDelta,
      });
    });

    // Wait for the full response
    const response = await stream.finalMessage();

    // Accumulate token usage across iterations
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.iterations += 1;

    // Collect all tool_use blocks from the response
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // No tool calls → just finish
    if (toolUseBlocks.length === 0) {
      sendSSE(controller, encoder, "done", {
        type: "done",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      });
      return;
    }

    // Check if any tool_use is a write tool
    const hasWriteTool = toolUseBlocks.some((b) => !READ_ONLY_TOOLS.has(b.name));

    if (hasWriteTool) {
      // Mixed or write-only: send ALL tool calls, mark write ones as pending
      // The FIRST write tool becomes the pending one, rest are ignored
      // (Claude typically sends one write tool at a time per our system prompt)
      for (const block of toolUseBlocks) {
        const toolCall = {
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };

        if (!READ_ONLY_TOOLS.has(block.name)) {
          sendSSE(controller, encoder, "tool_pending", {
            type: "tool_pending",
            toolCall,
          });
        } else {
          // Auto-execute accompanying read tools
          const result = executeReadTool(block.name, toolCall.input, docCtx);
          sendSSE(controller, encoder, "tool_call", { type: "tool_call", toolCall });
          sendSSE(controller, encoder, "tool_result", {
            type: "tool_result",
            result: { toolCallId: block.id, name: block.name, result, isAutoExecuted: true },
          });
        }
      }

      // Push assistant content for context preservation, then stop
      messages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlockParam[],
      });

      sendSSE(controller, encoder, "done", {
        type: "done",
        waitingForApproval: true,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      });
      return;
    }

    // All tool_use blocks are read-only → auto-execute ALL, then continue loop
    // Step 1: Push the assistant's response as-is
    messages.push({
      role: "assistant",
      content: response.content as Anthropic.ContentBlockParam[],
    });

    // Step 2: Build a single user message with ALL tool_results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const toolCall = {
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
      sendSSE(controller, encoder, "tool_call", { type: "tool_call", toolCall });

      const result = executeReadTool(block.name, toolCall.input, docCtx);
      sendSSE(controller, encoder, "tool_result", {
        type: "tool_result",
        result: { toolCallId: block.id, name: block.name, result, isAutoExecuted: true },
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }

    // Step 3: Push ALL tool_results in a single user message
    messages.push({
      role: "user",
      content: toolResults,
    });

    // Continue the agent loop → Claude will process results and respond
  }

  sendSSE(controller, encoder, "error", {
    type: "error",
    message: "Maximum agent iterations reached.",
  });
}
