import { describe, it, expect } from "vitest";
import {
  extractSectionDiff,
  extractDraftDiff,
  aggregateCorrectionPatterns,
  type SectionDiff,
} from "./section-diff-extractor";
import type { ReportFamilyDraftSection } from "@/lib/report-family-draft-generator";

function makeSection(
  tocEntryId: string,
  paragraphs: string[],
  table?: { headers: string[]; rows: string[][] } | null,
): ReportFamilyDraftSection {
  return {
    tocEntryId,
    title: `Section ${tocEntryId}`,
    sectionType: "narrative",
    paragraphs,
    table: table ?? null,
    citations: [],
    usedFallback: false,
    attempts: 1,
    evaluation: {
      passed: true,
      hasContent: true,
      typeAligned: true,
      slideGrounded: true,
      appendixSatisfied: true,
      entityAligned: true,
      issues: [],
    },
  };
}

describe("extractSectionDiff", () => {
  it("detects section_accepted when content is identical", () => {
    const ai = makeSection("s1", ["동일한 문장입니다.", "또 다른 문장입니다."]);
    const human = makeSection("s1", ["동일한 문장입니다.", "또 다른 문장입니다."]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("section_accepted");
    expect(diff.changeMagnitude).toBeLessThan(0.05);
  });

  it("detects added_context_paragraph when human adds paragraphs", () => {
    const ai = makeSection("s1", ["기존 문장입니다."]);
    const human = makeSection("s1", ["기존 문장입니다.", "추가된 맥락 설명 문장입니다. 새로운 내용이 담겨 있습니다."]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("added_context_paragraph");
    expect(diff.paragraphChanges.some((c) => c.type === "added")).toBe(true);
  });

  it("detects removed_paragraph when human removes paragraphs", () => {
    const ai = makeSection("s1", ["남길 문장입니다.", "삭제할 문장입니다."]);
    const human = makeSection("s1", ["남길 문장입니다."]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("removed_paragraph");
    expect(diff.paragraphChanges.some((c) => c.type === "removed")).toBe(true);
  });

  it("detects removed_hallucination when removed paragraph has numeric claims", () => {
    const ai = makeSection("s1", [
      "정상적인 내용입니다.",
      "2023년 기준 달성률 38.5억원으로 집계됩니다.", // hallucination signal
    ]);
    const human = makeSection("s1", ["정상적인 내용입니다."]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("removed_hallucination");
  });

  it("detects rewritten_paragraph on partial similarity", () => {
    const ai = makeSection("s1", ["원래의 문장이 여기에 있습니다. 내용이 좀 다를 수 있습니다."]);
    const human = makeSection("s1", ["원래의 문장이 여기에 있습니다. 하지만 사람이 수정했습니다."]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.paragraphChanges.some((c) => c.type === "rewritten")).toBe(true);
  });

  it("detects section_rejected when content is completely replaced", () => {
    const ai = makeSection("s1", [
      "AI가 생성한 첫 번째 문장입니다.",
      "AI가 생성한 두 번째 문장입니다.",
      "AI가 생성한 세 번째 문장입니다.",
    ]);
    const human = makeSection("s1", [
      "사람이 완전히 새로 쓴 문장 1번.",
      "사람이 완전히 새로 쓴 문장 2번.",
      "사람이 완전히 새로 쓴 문장 3번.",
    ]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.changeMagnitude).toBeGreaterThan(0.7);
  });

  it("detects table_added when human adds a table", () => {
    const ai = makeSection("s1", ["내용 문장입니다."], null);
    const human = makeSection("s1", ["내용 문장입니다."], {
      headers: ["항목", "값"],
      rows: [["A", "10"], ["B", "20"]],
    });
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("table_added");
    expect(diff.tableDiff?.type).toBe("added");
  });

  it("detects table_removed when human removes a table", () => {
    const ai = makeSection("s1", ["내용"], { headers: ["항목"], rows: [["A"]] });
    const human = makeSection("s1", ["내용"], null);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("table_removed");
  });

  it("detects corrected_table_values when same structure but different values", () => {
    const ai = makeSection("s1", [], {
      headers: ["기업명", "성과"],
      rows: [["A사", "100"], ["B사", "200"]],
    });
    const human = makeSection("s1", [], {
      headers: ["기업명", "성과"],
      rows: [["A사", "150"], ["B사", "250"]],
    });
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("corrected_table_values");
  });

  it("detects table_structure_changed when header count changes", () => {
    const ai = makeSection("s1", [], {
      headers: ["기업명", "성과"],
      rows: [["A사", "100"]],
    });
    const human = makeSection("s1", [], {
      headers: ["기업명", "성과", "메모"],
      rows: [["A사", "100", "추가"]],
    });
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("table_structure_changed");
  });

  it("detects bullet_to_narrative style shift", () => {
    const ai = makeSection("s1", [
      "- 첫 번째 항목",
      "- 두 번째 항목",
      "- 세 번째 항목",
    ]);
    const human = makeSection("s1", [
      "이 프로그램은 다양한 활동을 통해 참가자들이 역량을 키울 수 있도록 지원합니다. 특히 네트워킹과 멘토링 기회를 제공하여 장기적인 성장을 도모합니다.",
    ]);
    const diff = extractSectionDiff(ai, human);
    expect(diff.correctionPatterns).toContain("bullet_to_narrative");
  });

  it("citationsDelta reflects added citations", () => {
    const ai = makeSection("s1", ["내용"]);
    const human = { ...makeSection("s1", ["내용"]), citations: [{ sourceType: "slide_chunk" as const, sourceId: "s1", title: "슬라이드 1" }] };
    const diff = extractSectionDiff(ai, human);
    expect(diff.citationsDelta).toBe(1);
    expect(diff.correctionPatterns).toContain("added_citation");
  });
});

describe("extractDraftDiff", () => {
  it("matches sections by tocEntryId", () => {
    const aiSections = [
      makeSection("toc-1", ["AI 내용 1"]),
      makeSection("toc-2", ["AI 내용 2"]),
    ];
    const humanSections = [
      makeSection("toc-1", ["AI 내용 1"]),
      makeSection("toc-2", ["사람이 완전히 다르게 수정한 내용입니다."]),
    ];
    const diffs = extractDraftDiff(aiSections, humanSections);
    expect(diffs).toHaveLength(2);
    const diff2 = diffs.find((d) => d.tocEntryId === "toc-2")!;
    expect(diff2.changeMagnitude).toBeGreaterThan(0);
  });

  it("skips unmatched AI sections", () => {
    const aiSections = [
      makeSection("toc-1", ["내용"]),
      makeSection("toc-3", ["삭제된 섹션"]),
    ];
    const humanSections = [makeSection("toc-1", ["내용"])];
    const diffs = extractDraftDiff(aiSections, humanSections);
    // toc-3 has no matching human section — skipped
    expect(diffs.map((d) => d.tocEntryId)).not.toContain("toc-3");
  });
});

describe("aggregateCorrectionPatterns", () => {
  it("sums pattern frequencies across multiple diffs", () => {
    const diffs: SectionDiff[] = [
      {
        tocEntryId: "s1",
        sectionType: "narrative",
        correctionPatterns: ["added_context_paragraph", "removed_paragraph"],
        paragraphChanges: [],
        tableDiff: null,
        citationsDelta: 0,
        changeMagnitude: 0.3,
      },
      {
        tocEntryId: "s2",
        sectionType: "narrative",
        correctionPatterns: ["added_context_paragraph"],
        paragraphChanges: [],
        tableDiff: null,
        citationsDelta: 0,
        changeMagnitude: 0.1,
      },
    ];
    const freq = aggregateCorrectionPatterns(diffs);
    expect(freq.added_context_paragraph).toBe(2);
    expect(freq.removed_paragraph).toBe(1);
  });
});
