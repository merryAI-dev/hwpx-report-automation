/**
 * prompt-memory-builder.ts
 *
 * Converts accumulated human feedback (PreferenceData) into PromptMemory entries
 * that are injected into generation prompts to improve AI output quality over time.
 *
 * Three memory types:
 *   few_shot_example   — after ≥3 similar corrections, exemplary section pairs
 *   negative_example   — hallucination patterns to avoid
 *   instruction_rule   — after ≥5 repeating patterns, explicit instruction rules
 *
 * Injection into prompts:
 *   buildPromptMemoryContext() returns a formatted string block to prepend to
 *   section generation prompts.
 */

import { prisma } from "@/lib/persistence/client";
import type { ReportFamilyDraftSection } from "@/lib/report-family-draft-generator";
import type { CorrectionPattern } from "./section-diff-extractor";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FewShotExampleContent = {
  /** Structural summary of the section (no raw domain content) */
  sectionType: string;
  /** Human-approved version paragraphs (anonymized) */
  chosenParagraphs: string[];
  chosenHasTable: boolean;
  /** AI-generated version (for contrast) */
  rejectedParagraphs: string[];
  correctionPatterns: CorrectionPattern[];
};

export type NegativeExampleContent = {
  sectionType: string;
  /** Description of the pattern to avoid (abstract, not domain-specific) */
  avoidPattern: string;
  /** Structural signals that indicate this bad pattern */
  detectionSignals: string[];
};

export type InstructionRuleContent = {
  sectionType: string;
  /** Concise imperative rule */
  rule: string;
  /** Why this rule matters */
  rationale: string;
  /** Which correction pattern this rule addresses */
  addressesPattern: CorrectionPattern;
};

export type PromptMemoryContent =
  | FewShotExampleContent
  | NegativeExampleContent
  | InstructionRuleContent;

// ─── Instruction Rule Templates ───────────────────────────────────────────────

/**
 * Maps correction patterns to generated instruction rules.
 * Content-agnostic: rules describe structure, not domain.
 */
const PATTERN_TO_RULE: Record<
  CorrectionPattern,
  { rule: string; rationale: string } | null
> = {
  removed_hallucination: {
    rule: "수치나 연도를 제시할 때는 슬라이드 근거가 명확한 경우에만 작성하세요. 근거가 없으면 생략하세요.",
    rationale: "검토자가 수치/날짜를 포함한 문장을 반복적으로 삭제함",
  },
  bullet_to_narrative: {
    rule: "bullet 리스트 대신 연결된 문장으로 서술하세요. 각 항목을 '~이며', '~하고' 등으로 이어 쓰세요.",
    rationale: "검토자가 bullet 형식을 서술형 문단으로 반복 전환함",
  },
  narrative_to_bullet: {
    rule: "이 섹션은 bullet 형식이 적합합니다. 항목별로 간결하게 나열하세요.",
    rationale: "검토자가 서술형을 bullet 형식으로 반복 전환함",
  },
  added_context_paragraph: {
    rule: "슬라이드 내용을 요약한 후 의미 해석 문단을 추가하세요 (배경/시사점/결과 해석).",
    rationale: "검토자가 맥락 설명 문단을 반복적으로 추가함",
  },
  removed_paragraph: {
    rule: "슬라이드에 명확히 존재하는 내용만 작성하세요. 슬라이드에 없는 배경 설명은 생략하세요.",
    rationale: "검토자가 슬라이드 근거 없는 문단을 반복적으로 삭제함",
  },
  corrected_table_values: {
    rule: "표 값은 슬라이드 숫자를 그대로 옮기세요. 계산하거나 추정하지 마세요.",
    rationale: "검토자가 표 값을 반복적으로 수정함",
  },
  table_structure_changed: {
    rule: "표 헤더는 슬라이드 컬럼 구조와 일치시키세요. 임의로 열을 추가/삭제하지 마세요.",
    rationale: "검토자가 표 구조를 반복적으로 수정함",
  },
  rewritten_paragraph: null,  // Too generic for a rule
  table_added: null,
  table_removed: null,
  added_citation: null,
  section_accepted: null,
  section_rejected: null,
};

// ─── Core Builder Functions ───────────────────────────────────────────────────

/**
 * Scan PreferenceData for a family and create PromptMemory records.
 *
 * Thresholds:
 *   - ≥3 occurrences of a pattern → few_shot_example (if sections suitable)
 *   - ≥3 removed_hallucination → negative_example
 *   - ≥5 occurrences of a rule-able pattern → instruction_rule
 *
 * Returns IDs of newly created PromptMemory records.
 */
export async function buildPromptMemoriesForFamily(
  familyId: string,
): Promise<string[]> {
  const preferences = await prisma.preferenceData.findMany({
    where: { familyId },
    orderBy: { createdAt: "desc" },
  });

  if (preferences.length === 0) return [];

  // Count pattern frequencies per sectionType
  type PatternFreq = Record<string, Record<string, string[]>>; // sectionType → pattern → prefIds[]
  const freqByType: PatternFreq = {};

  for (const pref of preferences) {
    const patterns = JSON.parse(pref.correctionPatternJson) as CorrectionPattern[];
    for (const pattern of patterns) {
      freqByType[pref.sectionType] ??= {};
      freqByType[pref.sectionType][pattern] ??= [];
      freqByType[pref.sectionType][pattern].push(pref.id);
    }
  }

  const createdIds: string[] = [];

  for (const [sectionType, patternCounts] of Object.entries(freqByType)) {
    for (const [pattern, prefIds] of Object.entries(patternCounts)) {
      const count = prefIds.length;
      const typedPattern = pattern as CorrectionPattern;

      // Check if a memory for this pattern already exists
      const existing = await prisma.promptMemory.findFirst({
        where: {
          familyId,
          sectionType,
          status: "active",
          contentJson: { contains: `"addressesPattern":"${pattern}"` },
        },
      });
      if (existing) continue;

      // ── instruction_rule: ≥5 occurrences ──
      const ruleTemplate = PATTERN_TO_RULE[typedPattern];
      if (count >= 5 && ruleTemplate) {
        const content: InstructionRuleContent = {
          sectionType,
          rule: ruleTemplate.rule,
          rationale: ruleTemplate.rationale,
          addressesPattern: typedPattern,
        };
        const mem = await prisma.promptMemory.create({
          data: {
            familyId,
            sectionType,
            memoryType: "instruction_rule",
            contentJson: JSON.stringify(content),
            sourceFeedbackIds: JSON.stringify(prefIds.slice(0, 10)),
            priority: 10,
          },
        });
        createdIds.push(mem.id);
        continue;
      }

      // ── negative_example: ≥3 removed_hallucination ──
      if (count >= 3 && typedPattern === "removed_hallucination") {
        const content: NegativeExampleContent = {
          sectionType,
          avoidPattern:
            "수치, 연도, 인용구 등 슬라이드에 없는 구체적 데이터를 생성하지 마세요.",
          detectionSignals: [
            "연도 패턴 (예: 2023년)",
            "소수점 수치 (예: 38.5억원)",
            "따옴표 인용 없이 직접 인용 형식",
          ],
        };
        const mem = await prisma.promptMemory.create({
          data: {
            familyId,
            sectionType,
            memoryType: "negative_example",
            contentJson: JSON.stringify(content),
            sourceFeedbackIds: JSON.stringify(prefIds.slice(0, 10)),
            priority: 8,
          },
        });
        createdIds.push(mem.id);
        continue;
      }

      // ── few_shot_example: ≥3 of bullet/narrative shifts ──
      if (
        count >= 3 &&
        (typedPattern === "bullet_to_narrative" ||
          typedPattern === "narrative_to_bullet" ||
          typedPattern === "added_context_paragraph")
      ) {
        // Use the most recent high-quality preference as the exemplar
        const exemplar = preferences.find(
          (p) =>
            p.sectionType === sectionType &&
            (JSON.parse(p.correctionPatternJson) as string[]).includes(pattern),
        );
        if (!exemplar) continue;

        const chosen = JSON.parse(exemplar.chosenJson) as ReportFamilyDraftSection;
        const rejected = JSON.parse(exemplar.rejectedJson) as ReportFamilyDraftSection;

        const content: FewShotExampleContent = {
          sectionType,
          chosenParagraphs: chosen.paragraphs,
          chosenHasTable: chosen.table !== null,
          rejectedParagraphs: rejected.paragraphs,
          correctionPatterns: [typedPattern],
        };
        const mem = await prisma.promptMemory.create({
          data: {
            familyId,
            sectionType,
            memoryType: "few_shot_example",
            contentJson: JSON.stringify(content),
            sourceFeedbackIds: JSON.stringify(prefIds.slice(0, 5)),
            priority: 6,
          },
        });
        createdIds.push(mem.id);
      }
    }
  }

  return createdIds;
}

// ─── Prompt Context Builder ───────────────────────────────────────────────────

/**
 * Retrieve active PromptMemory entries for a family + sectionType combination
 * and format them as a prompt context string.
 *
 * Returns null if no relevant memories exist.
 */
export async function buildPromptMemoryContext(params: {
  familyId: string | null;
  sectionType: string;
  maxMemories?: number;
}): Promise<string | null> {
  const limit = params.maxMemories ?? 5;

  const memories = await prisma.promptMemory.findMany({
    where: {
      OR: [
        { familyId: params.familyId ?? undefined, sectionType: params.sectionType, status: "active" },
        { familyId: null, sectionType: params.sectionType, status: "active" },
      ],
    },
    orderBy: { priority: "desc" },
    take: limit,
  });

  if (memories.length === 0) return null;

  const lines: string[] = ["[검토자 피드백 기반 작성 지침]"];

  for (const mem of memories) {
    const content = JSON.parse(mem.contentJson) as PromptMemoryContent;

    if (mem.memoryType === "instruction_rule") {
      const rule = content as InstructionRuleContent;
      lines.push(`• 규칙: ${rule.rule}`);
    } else if (mem.memoryType === "negative_example") {
      const neg = content as NegativeExampleContent;
      lines.push(`• 금지: ${neg.avoidPattern}`);
    } else if (mem.memoryType === "few_shot_example") {
      const ex = content as FewShotExampleContent;
      lines.push(
        `• 참고 예시 (${ex.correctionPatterns.join(", ")} 패턴):`,
        `  [수정 전 (AI)]: ${ex.rejectedParagraphs.slice(0, 1).join(" ").slice(0, 120)}...`,
        `  [수정 후 (검토자)]: ${ex.chosenParagraphs.slice(0, 1).join(" ").slice(0, 120)}...`,
      );
    }
  }

  return lines.join("\n");
}
