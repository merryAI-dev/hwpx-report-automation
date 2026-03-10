import Anthropic from "@anthropic-ai/sdk";
import type { TemplateCatalogDiff } from "./template-diff";
import type { WorkspaceTemplateVersionSummary } from "@/lib/workspace-types";

export type ReviewResult = {
  verdict: "approve" | "needs-work" | "reject";
  summary: string;
  concerns: string[];
  suggestions: string[];
  model: string;
};

function buildReviewPrompt(params: {
  templateName: string;
  version: WorkspaceTemplateVersionSummary;
  diff: TemplateCatalogDiff | null;
}): string {
  const { templateName, version, diff } = params;

  const lines: string[] = [
    `템플릿 이름: ${templateName}`,
    `버전 번호: ${version.versionNumber}`,
    `필드 수: ${version.fieldCount}`,
    `이슈 수: ${version.issueCount}`,
    `차단 이슈 수: ${version.blockingIssueCount}`,
    `카탈로그 버전: ${version.catalogVersion}`,
    "",
  ];

  if (version.catalog.issues.length > 0) {
    lines.push("카탈로그 이슈 목록:");
    for (const issue of version.catalog.issues.slice(0, 10)) {
      lines.push(`  - [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    lines.push("");
  }

  if (diff === null) {
    lines.push("이 버전은 첫 번째 버전입니다. 이전 버전과 비교할 수 없습니다.");
  } else {
    lines.push(`이전 버전(${diff.fromVersionId})과의 변경 사항:`);
    lines.push(`  - 추가된 필드: ${diff.addedCount}개`);
    lines.push(`  - 삭제된 필드: ${diff.removedCount}개`);
    lines.push(`  - 변경된 필드: ${diff.changedCount}개`);

    if (diff.entries.length > 0) {
      lines.push("");
      lines.push("필드 변경 상세 (최대 10개):");
      for (const entry of diff.entries.slice(0, 10)) {
        if (entry.status === "added" && entry.newField) {
          lines.push(
            `  [추가] ${entry.key}: 타입=${entry.newField.type}, 라벨=${entry.newField.label}, 필수=${entry.newField.required ? "예" : "아니오"}`,
          );
        } else if (entry.status === "removed" && entry.oldField) {
          lines.push(`  [삭제] ${entry.key}: 타입=${entry.oldField.type}`);
        } else if (entry.status === "changed") {
          lines.push(`  [변경] ${entry.key}: 변경된 속성=${entry.changedProps.join(", ")}`);
        }
      }
    }
  }

  lines.push("");
  lines.push(
    "위 템플릿 버전을 검토하고 승인 여부를 결정하세요. " +
      "차단 이슈가 있거나 필수 필드가 삭제된 경우 'reject' 또는 'needs-work'을 선택하세요. " +
      "모든 이슈가 없고 변경이 합리적이면 'approve'를 선택하세요.",
  );

  return lines.join("\n");
}

const REVIEW_TOOL: Anthropic.Tool = {
  name: "submit_review",
  description: "템플릿 버전 검토 결과를 제출합니다",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string",
        enum: ["approve", "needs-work", "reject"],
        description: "검토 결과: approve(승인), needs-work(수정 필요), reject(거절)",
      },
      summary: {
        type: "string",
        description: "1-2문장 요약",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "구체적인 우려 사항 목록",
      },
      suggestions: {
        type: "array",
        items: { type: "string" },
        description: "개선 제안 목록",
      },
    },
    required: ["verdict", "summary", "concerns", "suggestions"],
  },
};

type ReviewToolInput = {
  verdict: "approve" | "needs-work" | "reject";
  summary: string;
  concerns: string[];
  suggestions: string[];
};

const MODEL = "claude-haiku-4-5-20251001";

export async function generateTemplateVersionReview(params: {
  templateName: string;
  version: WorkspaceTemplateVersionSummary;
  diff: TemplateCatalogDiff | null;
  apiKey?: string;
}): Promise<ReviewResult> {
  const client = new Anthropic({
    apiKey: params.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  const prompt = buildReviewPrompt(params);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [REVIEW_TOOL],
    tool_choice: { type: "tool", name: "submit_review" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool_use block from response
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUseBlock || toolUseBlock.name !== "submit_review") {
    throw new Error("AI 검토 응답에서 submit_review 도구 호출을 찾지 못했습니다.");
  }

  const input = toolUseBlock.input as ReviewToolInput;

  return {
    verdict: input.verdict,
    summary: input.summary,
    concerns: Array.isArray(input.concerns) ? input.concerns : [],
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    model: MODEL,
  };
}
