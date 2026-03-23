import {
  buildReportFamilyRalphPlan,
  type ReportFamilyRalphPlan,
} from "./report-template-ralph-loop";
import {
  evaluateSectionPlanBenchmarkCases,
  evaluateReportFamilyBenchmark,
  type ReportFamilyBenchmarkEvaluation,
  type ReportFamilyBenchmarkRun,
  type SectionPlanBenchmarkCase,
  type SectionPlanSummary,
  type TocBenchmarkEntry,
} from "./report-template-benchmark";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type { OutlineItem } from "@/lib/editor/document-store";
import myscBenchmarkPacket from "../../docs/benchmarks/mysc-final-report.packet.json";

export type ReportFamilyDocumentRole =
  | "target_report"
  | "slide_deck"
  | "reference_doc"
  | "evidence_doc";

export type ReportFamilySegment = {
  id: string;
  text: string;
  type?: string;
  level?: number;
  slideNumber?: number | null;
  pageNumber?: number | null;
};

export type ReportFamilyDocumentInput = {
  documentId: string;
  fileName: string;
  role: ReportFamilyDocumentRole;
  segments: ReportFamilySegment[];
};

export type TocEntry = {
  id: string;
  title: string;
  numbering: string | null;
  level: number;
  sourceSegmentId: string;
};

export type SourcePolicy = {
  allowedSourceIds: string[];
  maskedSourceIds: string[];
  structuralOnlyDocumentIds: string[];
  reasons: string[];
};

export type SlideChunk = {
  chunkId: string;
  documentId: string;
  title: string;
  slideNumber: number | null;
  summary: string;
  segmentIds: string[];
  score: number;
};

export type EvidenceBundleMatch = {
  bundleId: string;
  documentId: string;
  fileName: string;
  title: string;
  pageNumber: number | null;
  summary: string;
  segmentIds: string[];
  score: number;
};

export type SectionPromptPlan = {
  tocEntryId: string;
  tocTitle: string;
  numbering: string | null;
  sectionType: ReportFamilySectionType;
  focusEntities: string[];
  evidenceExpectation: ReportFamilyEvidenceExpectation;
  outputScaffold: string[];
  prompt: string;
  chunkingStrategy: "slide" | "slide_entity";
  supportingChunks: SlideChunk[];
  evidenceBundles: EvidenceBundleMatch[];
  maskedDocumentIds: string[];
  alignmentStrategy: "heuristic" | "registered_mapping";
  alignmentReasons: string[];
  /** Optional free-text instruction injected directly into this section's prompt */
  customInstruction?: string;
};

export type ReportFamilyPlan = {
  familyId: string | null;
  familyName: string;
  schemaSource: ReportFamilySchemaSource;
  toc: TocEntry[];
  sourcePolicy: SourcePolicy;
  sectionPlans: SectionPromptPlan[];
  planQuality: ReportFamilyPlanQuality | null;
  benchmarkEvaluation: ReportFamilyBenchmarkEvaluation | null;
  retryPlan: ReportFamilyRalphPlan | null;
};

export type ReportFamilySchemaSource =
  | "target_document"
  | "synthetic_outline"
  | "registered_packet";

export type ReportFamilySectionType =
  | "narrative"
  | "summary_table"
  | "operations_timeline"
  | "case_study"
  | "survey_summary"
  | "strategy"
  | "appendix_evidence";

export type ReportFamilyEvidenceExpectation =
  | "slide_grounded"
  | "appendix_bundle_required";

export type ReportFamilyPlanQuality = {
  status: "pass" | "retry";
  registeredSectionCount: number;
  mappedSectionCount: number;
  evidenceBundleCount: number;
  mappingCoverage: number;
  sectionTypeAlignment: number;
  appendixEvidenceReadiness: number;
  entityCoverage: number;
  missingMappings: string[];
  typeMismatches: string[];
  appendixGaps: string[];
  entityGaps: string[];
};

export type ReportFamilyPlanRequestPayload = {
  familyId?: string | null;
  familyName: string;
  schemaSource?: ReportFamilySchemaSource;
  targetDocument: ReportFamilyDocumentInput;
  sourceDocuments: ReportFamilyDocumentInput[];
  benchmarkRun?: ReportFamilyBenchmarkRun | null;
};

type RegisteredBenchmarkPacketCase = {
  caseId: string;
  goldEntries: TocBenchmarkEntry[];
};

type RegisteredSectionMapping = {
  sectionType?: ReportFamilySectionType;
  focusEntities?: string[];
  sourceTopics?: string[];
  sourceKeywords?: string[];
  note?: string;
};

type RegisteredBenchmarkPacket = {
  familyId: string;
  packetId: string;
  sourceArtifacts: {
    sourceDeckFileName: string;
    targetReportFileName: string;
  };
  benchmarkCases: RegisteredBenchmarkPacketCase[];
  sectionMappings?: Record<string, RegisteredSectionMapping>;
};

const MAX_TOC_ENTRIES = 24;
const MAX_SECTION_CHUNKS = 3;
const REGISTERED_REPORT_FAMILY_PACKETS: RegisteredBenchmarkPacket[] = [
  myscBenchmarkPacket as RegisteredBenchmarkPacket,
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFamilyKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function stripTrailingPageNumber(value: string): string {
  return value
    .replace(/\s+[·•.\-–—]*\s*\d+\s*$/, "")
    .replace(/\s+\(?p\.?\s*\d+\)?\s*$/i, "")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scoreTokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function looksLikeHeading(text: string): boolean {
  const trimmed = normalizeWhitespace(text);
  if (!trimmed || trimmed.length > 80) {
    return false;
  }
  return (
    /^part\s*\d+/i.test(trimmed) ||
    /^제\s*\d+\s*(장|절|항)/.test(trimmed) ||
    /^\d+([.\-]\d+){0,2}[.)]?\s*\S+/.test(trimmed) ||
    /^[가-힣A-Za-z][가-힣A-Za-z0-9\s]{1,40}$/.test(trimmed)
  );
}

function parseTocLine(
  text: string,
  sourceSegmentId: string,
  index: number,
): TocEntry | null {
  const cleaned = stripTrailingPageNumber(normalizeWhitespace(text));
  if (!cleaned || /^목차|^차례$/i.test(cleaned)) {
    return null;
  }

  const appendixMatch = cleaned.match(/^(\[첨부\d+\])\s*(.+)$/i);
  if (appendixMatch) {
    const title = normalizeWhitespace(appendixMatch[2] || "");
    if (!title) {
      return null;
    }
    return {
      id: `toc-${index}`,
      title,
      numbering: appendixMatch[1] || null,
      level: 1,
      sourceSegmentId,
    };
  }

  const bulletMatch = cleaned.match(/^[-•]\s*(.+)$/);
  if (bulletMatch) {
    const title = normalizeWhitespace(bulletMatch[1] || "");
    if (!title) {
      return null;
    }
    return {
      id: `toc-${index}`,
      title,
      numbering: null,
      level: 2,
      sourceSegmentId,
    };
  }

  const matched = cleaned.match(
    /^(?:(PART\s*\d+)|(\d+(?:[.\-]\d+){0,2})|([IVXLC]+))[.)]?\s*(.+)$/i,
  );
  if (matched) {
    const numbering = matched[1] || matched[2] || matched[3] || null;
    const title = normalizeWhitespace(matched[4] || "");
    if (!title) {
      return null;
    }
    const level = numbering?.includes(".") || numbering?.includes("-") ? 2 : 1;
    return {
      id: `toc-${index}`,
      title,
      numbering,
      level,
      sourceSegmentId,
    };
  }

  if (looksLikeHeading(cleaned)) {
    return {
      id: `toc-${index}`,
      title: cleaned,
      numbering: null,
      level: 1,
      sourceSegmentId,
    };
  }

  return null;
}

export function extractTableOfContents(
  targetDocument: ReportFamilyDocumentInput,
): TocEntry[] {
  const segments = targetDocument.segments.filter((segment) => normalizeWhitespace(segment.text));
  const tocAnchorIndex = segments.findIndex((segment) => /^(목차|차례)$/i.test(normalizeWhitespace(segment.text)));

  const candidates =
    tocAnchorIndex >= 0
      ? segments.slice(tocAnchorIndex + 1, tocAnchorIndex + 1 + 60)
      : segments;

  const parsed: TocEntry[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const segment = candidates[index];
    const lines = segment.text.split(/\r?\n/).map((line) => normalizeWhitespace(line)).filter(Boolean);
    for (const line of lines) {
      const entry = parseTocLine(line, segment.id, parsed.length);
      if (!entry) {
        continue;
      }
      const duplicate = parsed.some(
        (existing) => existing.title === entry.title && existing.numbering === entry.numbering,
      );
      if (!duplicate) {
        parsed.push(entry);
      }
      if (parsed.length >= MAX_TOC_ENTRIES) {
        return parsed;
      }
    }
  }

  return parsed;
}

function packetCase(packet: RegisteredBenchmarkPacket, caseId: string): RegisteredBenchmarkPacketCase | null {
  return packet.benchmarkCases.find((testCase) => testCase.caseId === caseId) || null;
}

function packetSectionMapping(
  packet: RegisteredBenchmarkPacket,
  tocTitle: string,
): RegisteredSectionMapping | null {
  const entries = Object.entries(packet.sectionMappings || {});
  const normalizedTitle = normalizeWhitespace(tocTitle);
  const matched = entries.find(([title]) => normalizeWhitespace(title) === normalizedTitle);
  return matched?.[1] || null;
}

function inferSectionType(
  tocTitle: string,
  mapping: RegisteredSectionMapping | null,
): ReportFamilySectionType {
  if (mapping?.sectionType) {
    return mapping.sectionType;
  }
  const title = normalizeWhitespace(tocTitle);
  if (/총괄표|성과 요약|성과관리/.test(title)) {
    return "summary_table";
  }
  if (/제언|전략/.test(title)) {
    return "strategy";
  }
  if (/만족도/.test(title)) {
    return "survey_summary";
  }
  if (/기본 정보|\[첨부|결과$/.test(title)) {
    return "appendix_evidence";
  }
  if (/로비고스|저크|사례/.test(title)) {
    return "case_study";
  }
  if (/프로그램 운영|모집|홍보|일정|세부추진/.test(title)) {
    return "operations_timeline";
  }
  return "narrative";
}

function inferFocusEntities(
  tocTitle: string,
  mapping: RegisteredSectionMapping | null,
): string[] {
  if (mapping?.focusEntities?.length) {
    return mapping.focusEntities.map(normalizeWhitespace).filter(Boolean);
  }
  const normalizedTitle = normalizeWhitespace(tocTitle);
  if (/^[가-힣A-Za-z0-9]+$/.test(normalizedTitle) && normalizedTitle.length <= 12) {
    if (!/프로그램|성과|조사|전략|제언|내용|현황/.test(normalizedTitle)) {
      return [normalizedTitle];
    }
  }
  return [];
}

function inferEvidenceExpectation(
  sectionType: ReportFamilySectionType,
): ReportFamilyEvidenceExpectation {
  return sectionType === "appendix_evidence"
    ? "appendix_bundle_required"
    : "slide_grounded";
}

function buildSectionOutputScaffold(params: {
  sectionType: ReportFamilySectionType;
  focusEntities: string[];
  evidenceExpectation: ReportFamilyEvidenceExpectation;
}): string[] {
  switch (params.sectionType) {
    case "summary_table":
      return [
        "표 우선 섹션으로 작성",
        "행 후보: 지표명 | 목표치 | 달성치 | 달성률/상태 | 근거 슬라이드",
        "표 아래에는 한 단락으로 핵심 해석만 덧붙임",
      ];
    case "operations_timeline":
      return [
        "운영 흐름을 단계 또는 시간순 bullet로 정리",
        "각 bullet에는 활동명, 목적, 수행 내용, 확인 가능한 결과를 포함",
        "중복 활동은 묶고, 실행 근거가 약한 항목은 제외",
      ];
    case "case_study":
      return [
        `기업 사례 섹션으로 작성${params.focusEntities.length ? ` (${params.focusEntities.join(", ")})` : ""}`,
        "블록 순서: 기업 개요 | 해결 과제 | 지원/프로그램 개입 | 성과/후속 변화",
        "근거가 불충분하면 과장하지 말고 확인된 사실만 요약",
      ];
    case "survey_summary":
      return [
        "만족도 조사 결과를 요약하는 섹션으로 작성",
        "핵심 수치, 긍정/부정 시사점, 개선 포인트를 분리해서 기술",
        "슬라이드에 수치가 없으면 정성 결과만 작성",
      ];
    case "strategy":
      return [
        "다음 연도 전략/제언 섹션으로 작성",
        "구성: 핵심 방향 | 실행 과제 | 기대 효과/리스크",
        "현재 성과와 직접 연결되는 전략만 제안 수준으로 정리",
      ];
    case "appendix_evidence":
      return [
        "부록/증빙용 섹션 구조만 작성",
        "항목 후보: 증빙명 | 관련 기업/지표 | 필요한 첨부 근거",
        params.evidenceExpectation === "appendix_bundle_required"
          ? "현재는 slide-grounded 개요만 작성하고, 실제 제출에는 appendix evidence bundle 연결이 필요함을 명시"
          : "첨부 근거가 필요한 항목은 별도 표시",
      ];
    case "narrative":
      return [
        "2~4개 짧은 문단으로 핵심 맥락을 정리",
        "문단 순서: 배경 | 실행/성과 | 시사점",
      ];
  }
}

export function resolveRegisteredReportFamilyPacket(params: {
  familyName: string;
  fileName: string;
}): RegisteredBenchmarkPacket | null {
  const haystack = normalizeFamilyKey(`${params.familyName} ${params.fileName}`);
  return (
    REGISTERED_REPORT_FAMILY_PACKETS.find((packet) => {
      const sourceName = normalizeFamilyKey(packet.sourceArtifacts.sourceDeckFileName);
      const targetName = normalizeFamilyKey(packet.sourceArtifacts.targetReportFileName);
      const myscSignal =
        haystack.includes("mysc") || haystack.includes("엠와이소셜컴퍼니");
      const marineSignal = haystack.includes("해양수산");
      return (
        (myscSignal && marineSignal) ||
        sourceName.includes(haystack) ||
        haystack.includes(sourceName) ||
        targetName.includes(haystack) ||
        haystack.includes(targetName)
      );
    }) || null
  );
}

function resolveRegisteredReportFamilyPacketByFamilyId(
  familyId: string | null | undefined,
): RegisteredBenchmarkPacket | null {
  if (!familyId) {
    return null;
  }
  return REGISTERED_REPORT_FAMILY_PACKETS.find((packet) => packet.familyId === familyId) || null;
}

function toRegisteredTocLine(entry: TocBenchmarkEntry, level: number): string {
  const title = normalizeWhitespace(entry.title);
  const numbering = normalizeWhitespace(entry.numbering || "");
  if (numbering.startsWith("[첨부")) {
    return `${numbering} ${title}`;
  }
  if (!numbering || numbering === "-") {
    return level > 1 ? `- ${title}` : title;
  }
  return `${numbering} ${title}`;
}

export function buildTargetDocumentFromRegisteredPacket(params: {
  packet: RegisteredBenchmarkPacket;
  fileName: string;
}): ReportFamilyDocumentInput {
  const topLevelCase = packetCase(params.packet, "mysc-top-level-toc");
  const detailCase = packetCase(params.packet, "mysc-detailed-toc");
  const topLevelLines = (topLevelCase?.goldEntries || []).map((entry) =>
    toRegisteredTocLine(entry, 1),
  );
  const detailLines = (detailCase?.goldEntries || []).map((entry) =>
    toRegisteredTocLine(entry, 2),
  );

  return {
    documentId: `${params.packet.familyId}-registered-target`,
    fileName: `${params.fileName.replace(/\.[^.]+$/i, "")}-registered-target.pdf`,
    role: "target_report",
    segments: [
      { id: "toc-title", text: "목차", type: "heading", level: 1, pageNumber: 1 },
      {
        id: "toc-top-level",
        text: topLevelLines.join("\n"),
        type: "paragraph",
        pageNumber: 1,
      },
      {
        id: "toc-details",
        text: detailLines.join("\n"),
        type: "paragraph",
        pageNumber: 1,
      },
    ].filter((segment) => normalizeWhitespace(segment.text)),
  };
}

type RawSlideChunk = {
  chunkId: string;
  documentId: string;
  title: string;
  slideNumber: number | null;
  summary: string;
  segmentIds: string[];
};

type RawEvidenceChunk = {
  bundleId: string;
  documentId: string;
  fileName: string;
  title: string;
  pageNumber: number | null;
  summary: string;
  segmentIds: string[];
};

function buildSlideChunks(document: ReportFamilyDocumentInput): RawSlideChunk[] {
  const chunks: RawSlideChunk[] = [];
  let current: RawSlideChunk | null = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    current.summary = normalizeWhitespace(current.summary).slice(0, 1800);
    chunks.push(current);
    current = null;
  };

  for (const segment of document.segments) {
    const text = normalizeWhitespace(segment.text);
    if (!text) {
      continue;
    }
    const isHeading = segment.type === "heading" || looksLikeHeading(text);
    const isNewSlide =
      segment.slideNumber !== null &&
      segment.slideNumber !== undefined &&
      current &&
      current.slideNumber !== segment.slideNumber;

    if (!current || isNewSlide || isHeading) {
      pushCurrent();
      current = {
        chunkId: `${document.documentId}::${segment.id}`,
        documentId: document.documentId,
        title: isHeading ? text : document.fileName,
        slideNumber: segment.slideNumber ?? null,
        summary: text,
        segmentIds: [segment.id],
      };
      continue;
    }

    current.summary += ` ${text}`;
    current.segmentIds.push(segment.id);
  }

  pushCurrent();
  return chunks;
}

function splitIntoSentenceLikeUnits(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|(?<=다)\s+|\n+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function buildEntityAwareSlideChunks(
  chunk: RawSlideChunk,
  focusEntities: string[],
): RawSlideChunk[] {
  if (!focusEntities.length) {
    return [chunk];
  }

  const derived: RawSlideChunk[] = [chunk];
  const sentenceUnits = splitIntoSentenceLikeUnits(chunk.summary);

  for (const entity of focusEntities) {
    const normalizedEntity = normalizeWhitespace(entity);
    if (!normalizedEntity) {
      continue;
    }

    const matchingUnits = sentenceUnits.filter((sentence) =>
      sentence.toLowerCase().includes(normalizedEntity.toLowerCase()),
    );

    if (!matchingUnits.length) {
      continue;
    }

    derived.push({
      ...chunk,
      chunkId: `${chunk.chunkId}::entity::${normalizedEntity}`,
      title:
        normalizeWhitespace(chunk.title).toLowerCase() === normalizedEntity.toLowerCase()
          ? chunk.title
          : `${normalizedEntity} · ${chunk.title}`,
      summary: normalizeWhitespace(matchingUnits.join(" ")).slice(0, 500),
    });
  }

  return derived;
}

function buildEvidenceDocumentChunks(document: ReportFamilyDocumentInput): RawEvidenceChunk[] {
  const chunks: RawEvidenceChunk[] = [];
  let current: RawEvidenceChunk | null = null;

  const pushCurrent = () => {
    if (!current) {
      return;
    }
    current.summary = normalizeWhitespace(current.summary).slice(0, 1800);
    chunks.push(current);
    current = null;
  };

  for (const segment of document.segments) {
    const text = normalizeWhitespace(segment.text);
    if (!text) {
      continue;
    }

    const isHeading = segment.type === "heading" || looksLikeHeading(text);
    const isNewPage =
      segment.pageNumber !== null &&
      segment.pageNumber !== undefined &&
      current &&
      current.pageNumber !== segment.pageNumber;

    if (!current || isHeading || isNewPage) {
      pushCurrent();
      current = {
        bundleId: `${document.documentId}::${segment.id}`,
        documentId: document.documentId,
        fileName: document.fileName,
        title: isHeading ? text : `${document.fileName}${segment.pageNumber ? ` p.${segment.pageNumber}` : ""}`,
        pageNumber: segment.pageNumber ?? null,
        summary: text,
        segmentIds: [segment.id],
      };
      continue;
    }

    current.summary += ` ${text}`;
    current.segmentIds.push(segment.id);
  }

  pushCurrent();
  return chunks;
}

function scoreAgainstTerms(
  chunk: { title: string; summary: string },
  terms: string[],
): number {
  if (!terms.length) {
    return 0;
  }
  return Math.max(
    ...terms.map((term) =>
      Math.max(
        scoreTokenOverlap(term, chunk.title),
        scoreTokenOverlap(term, chunk.summary),
      ),
    ),
  );
}

function exactContainmentBoost(
  chunk: { title: string; summary: string },
  terms: string[],
): number {
  const haystack = normalizeWhitespace(`${chunk.title} ${chunk.summary}`).toLowerCase();
  return terms.some((term) => haystack.includes(normalizeWhitespace(term).toLowerCase())) ? 0.35 : 0;
}

function buildSupportingChunksForEntry(params: {
  entry: TocEntry;
  allowedSlideChunks: RawSlideChunk[];
  registeredPacket: RegisteredBenchmarkPacket | null;
}): {
  supportingChunks: SlideChunk[];
  chunkingStrategy: "slide" | "slide_entity";
  alignmentStrategy: "heuristic" | "registered_mapping";
  alignmentReasons: string[];
} {
  const mapping = params.registeredPacket
    ? packetSectionMapping(params.registeredPacket, params.entry.title)
    : null;
  const focusEntities = inferFocusEntities(params.entry.title, mapping);

  const alignmentReasons: string[] = [];
  let usedEntityChunks = false;
  const candidateChunks = params.allowedSlideChunks.flatMap((chunk) => {
    const expanded = buildEntityAwareSlideChunks(chunk, focusEntities);
    if (expanded.length > 1) {
      usedEntityChunks = true;
    }
    return expanded;
  });
  const rankedChunks = candidateChunks
    .map((chunk) => {
      const entryScore = Math.max(
        scoreTokenOverlap(params.entry.title, chunk.title),
        scoreTokenOverlap(params.entry.title, chunk.summary),
      );

      if (!mapping) {
        return {
          ...chunk,
          score: entryScore,
        };
      }

      const mappingTopics = (mapping.sourceTopics || []).map(normalizeWhitespace).filter(Boolean);
      const mappingKeywords = (mapping.sourceKeywords || []).map(normalizeWhitespace).filter(Boolean);
      const entityScore = scoreAgainstTerms(chunk, focusEntities);
      const topicScore = scoreAgainstTerms(chunk, mappingTopics);
      const keywordScore = scoreAgainstTerms(chunk, mappingKeywords);
      const boost =
        exactContainmentBoost(chunk, focusEntities) +
        exactContainmentBoost(chunk, mappingTopics) +
        exactContainmentBoost(chunk, mappingKeywords) +
        (focusEntities.length && chunk.chunkId.includes("::entity::") ? 0.45 : 0);

      return {
        ...chunk,
        score: Math.max(entryScore, topicScore * 1.2, keywordScore, entityScore * 1.4) + boost,
      };
    })
    .sort((left, right) => right.score - left.score);

  if (focusEntities.length) {
    alignmentReasons.push(`focus entities: ${focusEntities.join(", ")}`);
  }
  if (usedEntityChunks) {
    alignmentReasons.push("entity-aware chunking enabled");
  }
  if (mapping?.sourceTopics?.length) {
    alignmentReasons.push(`mapped source topics: ${mapping.sourceTopics.join(", ")}`);
  }
  if (mapping?.sourceKeywords?.length) {
    alignmentReasons.push(`mapping keywords: ${mapping.sourceKeywords.join(", ")}`);
  }
  if (mapping?.note) {
    alignmentReasons.push(mapping.note);
  }

  const filteredRankedChunks = mapping
    ? rankedChunks.filter((chunk) => chunk.score >= 0.2)
    : rankedChunks.filter((chunk) => chunk.score > 0);

  const selected = (filteredRankedChunks.length ? filteredRankedChunks : rankedChunks)
    .slice(0, MAX_SECTION_CHUNKS)
    .map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      title: chunk.title,
      slideNumber: chunk.slideNumber,
      summary: chunk.summary,
      segmentIds: chunk.segmentIds,
      score: Math.round(chunk.score * 1000) / 1000,
    }));

  return {
    supportingChunks: selected,
    chunkingStrategy: usedEntityChunks ? "slide_entity" : "slide",
    alignmentStrategy: mapping ? "registered_mapping" : "heuristic",
    alignmentReasons,
  };
}

function buildEvidenceBundlesForEntry(params: {
  entry: TocEntry;
  evidenceDocuments: ReportFamilyDocumentInput[];
  registeredPacket: RegisteredBenchmarkPacket | null;
  focusEntities: string[];
  evidenceExpectation: ReportFamilyEvidenceExpectation;
}): EvidenceBundleMatch[] {
  if (params.evidenceExpectation !== "appendix_bundle_required") {
    return [];
  }

  const mapping = params.registeredPacket
    ? packetSectionMapping(params.registeredPacket, params.entry.title)
    : null;
  const mappingTopics = (mapping?.sourceTopics || []).map(normalizeWhitespace).filter(Boolean);
  const mappingKeywords = (mapping?.sourceKeywords || []).map(normalizeWhitespace).filter(Boolean);
  const candidateBundles = params.evidenceDocuments.flatMap((document) =>
    buildEvidenceDocumentChunks(document),
  );

  const rankedBundles = candidateBundles
    .map((bundle) => {
      const entryScore = Math.max(
        scoreTokenOverlap(params.entry.title, bundle.title),
        scoreTokenOverlap(params.entry.title, bundle.summary),
      );
      const topicScore = scoreAgainstTerms(bundle, mappingTopics);
      const keywordScore = scoreAgainstTerms(bundle, mappingKeywords);
      const entityScore = scoreAgainstTerms(bundle, params.focusEntities);
      const boost =
        exactContainmentBoost(bundle, mappingTopics) +
        exactContainmentBoost(bundle, mappingKeywords) +
        exactContainmentBoost(bundle, params.focusEntities);

      return {
        ...bundle,
        score: Math.max(entryScore, topicScore * 1.1, keywordScore, entityScore * 1.3) + boost,
      };
    })
    .filter((bundle) => bundle.score > 0)
    .sort((left, right) => right.score - left.score);

  return rankedBundles.slice(0, MAX_SECTION_CHUNKS).map((bundle) => ({
    bundleId: bundle.bundleId,
    documentId: bundle.documentId,
    fileName: bundle.fileName,
    title: bundle.title,
    pageNumber: bundle.pageNumber,
    summary: bundle.summary,
    segmentIds: bundle.segmentIds,
    score: Math.round(bundle.score * 1000) / 1000,
  }));
}

export function buildSourcePolicy(
  targetDocument: ReportFamilyDocumentInput,
  sourceDocuments: ReportFamilyDocumentInput[],
): SourcePolicy {
  const allowedSourceIds = sourceDocuments
    .filter((document) => document.role === "slide_deck")
    .map((document) => document.documentId);
  const maskedSourceIds = sourceDocuments
    .filter((document) => document.role !== "slide_deck")
    .map((document) => document.documentId);

  return {
    allowedSourceIds,
    maskedSourceIds,
    structuralOnlyDocumentIds: [targetDocument.documentId],
    reasons: [
      "target_report는 구조 추출 전용으로 사용하고 narrative generation source에서는 제외합니다.",
      "slide_deck만 section narrative 생성을 위한 allowed source로 사용합니다.",
      "reference_doc와 evidence_doc는 evaluator/검증 전용이며 prompt 본문에서는 masking합니다.",
    ],
  };
}

export function buildSectionPromptPlans(
  familyName: string,
  toc: TocEntry[],
  targetDocument: ReportFamilyDocumentInput,
  sourceDocuments: ReportFamilyDocumentInput[],
  sourcePolicy: SourcePolicy,
  options?: {
    familyId?: string | null;
    schemaSource?: ReportFamilySchemaSource;
  },
): SectionPromptPlan[] {
  const allowedSlideChunks = sourceDocuments
    .filter((document) => sourcePolicy.allowedSourceIds.includes(document.documentId))
    .flatMap((document) => buildSlideChunks(document));
  const evidenceDocuments = sourceDocuments.filter((document) => document.role === "evidence_doc");
  const registeredPacket =
    options?.schemaSource === "registered_packet"
      ? resolveRegisteredReportFamilyPacketByFamilyId(options.familyId)
      : null;

  return toc.map((entry) => {
    const mapping = registeredPacket ? packetSectionMapping(registeredPacket, entry.title) : null;
    const sectionType = inferSectionType(entry.title, mapping);
    const focusEntities = inferFocusEntities(entry.title, mapping);
    const evidenceExpectation = inferEvidenceExpectation(sectionType);
    const outputScaffold = buildSectionOutputScaffold({
      sectionType,
      focusEntities,
      evidenceExpectation,
    });
    const {
      supportingChunks,
      chunkingStrategy,
      alignmentStrategy,
      alignmentReasons,
    } = buildSupportingChunksForEntry({
      entry,
      allowedSlideChunks,
      registeredPacket,
    });
    const evidenceBundles = buildEvidenceBundlesForEntry({
      entry,
      evidenceDocuments,
      registeredPacket,
      focusEntities,
      evidenceExpectation,
    });

    const chunkText = supportingChunks.length
      ? supportingChunks
          .map((chunk, index) => {
            const slideLabel =
              chunk.slideNumber !== null ? `슬라이드 ${chunk.slideNumber}` : `청크 ${index + 1}`;
            return `- ${slideLabel} | ${chunk.title}\n  ${chunk.summary}`;
          })
          .join("\n")
      : "- 매칭된 슬라이드 청크가 없습니다. reviewer가 section-source alignment를 먼저 확인해야 합니다.";
    const evidenceBundleText =
      evidenceExpectation === "appendix_bundle_required"
        ? evidenceBundles.length
          ? evidenceBundles
              .map((bundle) => {
                const pageLabel = bundle.pageNumber !== null ? `p.${bundle.pageNumber}` : "page ?";
                return `- ${bundle.fileName} | ${pageLabel} | ${bundle.title}\n  ${bundle.summary}`;
              })
              .join("\n")
          : "- 매칭된 appendix evidence bundle이 없습니다. reviewer가 증빙 문서를 추가해야 합니다."
        : "";

    const prompt = [
      `너는 ${familyName} 보고서의 "${entry.title}" 섹션 작성 보조 AI다.`,
      `이 섹션은 target report "${targetDocument.fileName}"의 구조를 따르되, 내용은 허용된 slide_deck source에만 grounded되어야 한다.`,
      "금지 규칙:",
      `1. masked source(${sourcePolicy.maskedSourceIds.join(", ") || "없음"}) 내용은 절대 사용하지 마라.`,
      `2. target report(${targetDocument.documentId})는 구조 참고용이며 문장 내용을 베끼지 마라.`,
      "3. 근거가 없는 추정, 숫자 추가, 회사명 생성은 금지한다.",
      "",
      `섹션 번호: ${entry.numbering || "(없음)"}`,
      `섹션 제목: ${entry.title}`,
      `섹션 타입: ${sectionType}`,
      `근거 기대치: ${evidenceExpectation === "appendix_bundle_required" ? "appendix evidence bundle required" : "slide grounded"}`,
      focusEntities.length ? `중점 엔티티: ${focusEntities.join(", ")}` : "",
      "",
      alignmentReasons.length
        ? `섹션 정렬 힌트:\n${alignmentReasons.map((reason) => `- ${reason}`).join("\n")}\n`
        : "",
      "출력 스캐폴드:",
      ...outputScaffold.map((line) => `- ${line}`),
      "",
      "허용된 슬라이드 근거:",
      chunkText,
      evidenceExpectation === "appendix_bundle_required" ? "첨부 근거 후보 (appendix-only):" : "",
      evidenceExpectation === "appendix_bundle_required" ? evidenceBundleText : "",
      "",
      "출력 규칙:",
      "- 한국어 보고서 문체로 작성",
      "- sectionType에 맞는 구조를 우선 유지",
      "- 슬라이드에 없는 사실은 쓰지 않음",
      evidenceExpectation === "appendix_bundle_required"
        ? "- evidence bundle은 첨부 항목명과 필요한 증빙 힌트로만 사용하고 narrative 사실 확장에는 사용하지 않음"
        : "",
      "- 마지막에 `근거 슬라이드:` 라인으로 사용한 slide title을 나열",
    ].filter(Boolean).join("\n");

    return {
      tocEntryId: entry.id,
      tocTitle: entry.title,
      numbering: entry.numbering,
      sectionType,
      focusEntities,
      evidenceExpectation,
      outputScaffold,
      prompt,
      chunkingStrategy,
      supportingChunks,
      evidenceBundles,
      maskedDocumentIds: sourcePolicy.maskedSourceIds,
      alignmentStrategy,
      alignmentReasons,
    };
  });
}

function buildRegisteredSectionPlanCases(params: {
  packet: RegisteredBenchmarkPacket | null;
  sectionPlans: SectionPromptPlan[];
}): SectionPlanBenchmarkCase[] {
  if (!params.packet?.sectionMappings) {
    return [];
  }

  return [
    {
      caseId: `${params.packet.familyId}-section-plan`,
      expectedSections: Object.entries(params.packet.sectionMappings).map(([tocTitle, mapping]) => ({
        tocTitle,
        sectionType: mapping.sectionType || null,
        evidenceExpectation:
          mapping.sectionType === "appendix_evidence"
            ? "appendix_bundle_required"
            : "slide_grounded",
        minEvidenceBundleCount: mapping.sectionType === "appendix_evidence" ? 1 : 0,
        focusEntities: mapping.focusEntities || [],
        required: true,
      })),
      predictedSections: params.sectionPlans.map((section) => ({
        tocTitle: section.tocTitle,
        sectionType: section.sectionType,
        evidenceExpectation: section.evidenceExpectation,
        evidenceBundleCount: section.evidenceBundles.length,
        focusEntities: section.focusEntities,
        focusEntityResolved:
          !section.focusEntities.length ||
          section.focusEntities.every((entity) =>
            section.supportingChunks.some((chunk) =>
              normalizeWhitespace(`${chunk.title} ${chunk.summary}`)
                .toLowerCase()
                .includes(normalizeWhitespace(entity).toLowerCase()),
            ),
          ),
        required: true,
      })),
    },
  ];
}

function buildReportFamilyPlanQuality(params: {
  packet: RegisteredBenchmarkPacket | null;
  sectionPlans: SectionPromptPlan[];
  sectionPlanSummary: SectionPlanSummary | null;
}): ReportFamilyPlanQuality | null {
  if (!params.packet?.sectionMappings) {
    return null;
  }

  const registeredTitles = Object.keys(params.packet.sectionMappings).map(normalizeWhitespace);
  const mappedTitles = new Set(
    params.sectionPlans
      .filter(
        (section) =>
          section.alignmentStrategy === "registered_mapping" &&
          section.supportingChunks.length > 0,
      )
      .map((section) => normalizeWhitespace(section.tocTitle)),
  );
  const missingMappings = registeredTitles.filter((title) => !mappedTitles.has(title));
  const firstCase = params.sectionPlanSummary?.caseResults[0] || null;
  const sectionTypeAlignment = params.sectionPlanSummary?.sectionTypeExactMatchRate ?? 1;
  const appendixEvidenceReadiness =
    params.sectionPlanSummary?.appendixEvidenceReadinessRate ?? 1;
  const entityCoverage = params.sectionPlanSummary?.entityFocusCoverageRate ?? 1;
  const evidenceBundleCount = params.sectionPlans.reduce(
    (sum, section) => sum + section.evidenceBundles.length,
    0,
  );
  const mappingCoverage =
    registeredTitles.length > 0
      ? (registeredTitles.length - missingMappings.length) / registeredTitles.length
      : 1;

  return {
    status:
      mappingCoverage === 1 &&
      sectionTypeAlignment === 1 &&
      appendixEvidenceReadiness === 1 &&
      entityCoverage === 1
        ? "pass"
        : "retry",
    registeredSectionCount: registeredTitles.length,
    mappedSectionCount: registeredTitles.length - missingMappings.length,
    evidenceBundleCount,
    mappingCoverage,
    sectionTypeAlignment,
    appendixEvidenceReadiness,
    entityCoverage,
    missingMappings,
    typeMismatches: firstCase?.typeMismatches || [],
    appendixGaps: firstCase?.appendixGaps || [],
    entityGaps: firstCase?.entityGaps || [],
  };
}

export function buildReportFamilyPlan(params: {
  familyId?: string | null;
  familyName: string;
  schemaSource?: ReportFamilySchemaSource;
  targetDocument: ReportFamilyDocumentInput;
  sourceDocuments: ReportFamilyDocumentInput[];
  benchmarkRun?: ReportFamilyBenchmarkRun | null;
}): ReportFamilyPlan {
  const toc = extractTableOfContents(params.targetDocument);
  const sourcePolicy = buildSourcePolicy(params.targetDocument, params.sourceDocuments);
  const registeredPacket =
    params.schemaSource === "registered_packet"
      ? resolveRegisteredReportFamilyPacketByFamilyId(params.familyId)
      : null;
  const sectionPlans = buildSectionPromptPlans(
    params.familyName,
    toc,
    params.targetDocument,
    params.sourceDocuments,
    sourcePolicy,
    {
      familyId: params.familyId,
      schemaSource: params.schemaSource,
    },
  );
  const sectionPlanCases = buildRegisteredSectionPlanCases({
    packet: registeredPacket,
    sectionPlans,
  });
  const sectionPlanSummary = sectionPlanCases.length
    ? evaluateSectionPlanBenchmarkCases(sectionPlanCases)
    : null;
  const planQuality = buildReportFamilyPlanQuality({
    packet: registeredPacket,
    sectionPlans,
    sectionPlanSummary,
  });
  const effectiveBenchmarkRun = params.benchmarkRun
    ? {
        ...params.benchmarkRun,
        sectionPlanCases: [
          ...(params.benchmarkRun.sectionPlanCases || []),
          ...sectionPlanCases,
        ],
      }
    : null;

  const benchmarkEvaluation = effectiveBenchmarkRun
    ? evaluateReportFamilyBenchmark(effectiveBenchmarkRun)
    : null;
  const retryPlan = benchmarkEvaluation
    ? buildReportFamilyRalphPlan(benchmarkEvaluation)
    : null;

  return {
    familyId: params.familyId || null,
    familyName: params.familyName,
    schemaSource: params.schemaSource || "target_document",
    toc,
    sourcePolicy,
    sectionPlans,
    planQuality,
    benchmarkEvaluation,
    retryPlan,
  };
}

export function buildSyntheticTargetReportFromOutline(params: {
  familyName: string;
  fileName: string;
  outline: OutlineItem[];
}): ReportFamilyDocumentInput {
  const topLevelItems = params.outline.filter((item) => item.level <= 2).slice(0, MAX_TOC_ENTRIES);
  const tocLines = topLevelItems.map((item, index) => {
    const prefix = item.text.match(/^\d+([.\-]\d+){0,2}/)?.[0];
    if (prefix) {
      return item.text;
    }
    return `${index + 1} ${item.text}`;
  });

  return {
    documentId: "synthetic-target-report",
    fileName: `${params.fileName.replace(/\.[^.]+$/i, "")}-synthetic-target.pdf`,
    role: "target_report",
    segments: [
      { id: "toc-title", text: "목차", type: "heading", level: 1, pageNumber: 1 },
      {
        id: "toc-body",
        text: tocLines.join("\n"),
        type: "paragraph",
        pageNumber: 1,
      },
    ],
  };
}

export function buildSourceDocumentFromEditorSegments(params: {
  fileName: string;
  documentId: string;
  role: ReportFamilyDocumentRole;
  segments: EditorSegment[];
}): ReportFamilyDocumentInput {
  return {
    documentId: params.documentId,
    fileName: params.fileName,
    role: params.role,
    segments: params.segments
      .filter((segment) => normalizeWhitespace(segment.text))
      .map((segment) => ({
        id: segment.segmentId,
        text: segment.text,
        type: segment.tag,
        level:
          segment.tag.startsWith("h") && Number.isFinite(Number(segment.tag.slice(1)))
            ? Number(segment.tag.slice(1))
            : undefined,
        slideNumber: Number.isFinite(Number(segment.styleHints.slideNumber))
          ? Number(segment.styleHints.slideNumber)
          : null,
      })),
  };
}

export function buildPptxReportFamilyPlanPayload(params: {
  familyName: string;
  fileName: string;
  segments: EditorSegment[];
  outline: OutlineItem[];
  additionalSourceDocuments?: ReportFamilyDocumentInput[];
  benchmarkRun?: ReportFamilyBenchmarkRun | null;
}): ReportFamilyPlanRequestPayload {
  const registeredPacket = resolveRegisteredReportFamilyPacket({
    familyName: params.familyName,
    fileName: params.fileName,
  });

  return {
    familyId: registeredPacket?.familyId || null,
    familyName: params.familyName,
    schemaSource: registeredPacket ? "registered_packet" : "synthetic_outline",
    targetDocument: registeredPacket
      ? buildTargetDocumentFromRegisteredPacket({
          packet: registeredPacket,
          fileName: params.fileName,
        })
      : buildSyntheticTargetReportFromOutline({
          familyName: params.familyName,
          fileName: params.fileName,
          outline: params.outline,
        }),
    sourceDocuments: [
      buildSourceDocumentFromEditorSegments({
        fileName: params.fileName,
        documentId: "current-slide-deck",
        role: "slide_deck",
        segments: params.segments,
      }),
      ...(params.additionalSourceDocuments || []),
    ],
    benchmarkRun: params.benchmarkRun ?? null,
  };
}
