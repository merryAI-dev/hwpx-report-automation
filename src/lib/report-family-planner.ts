import {
  buildReportFamilyRalphPlan,
  type ReportFamilyRalphPlan,
} from "./report-template-ralph-loop";
import {
  evaluateReportFamilyBenchmark,
  type ReportFamilyBenchmarkEvaluation,
  type ReportFamilyBenchmarkRun,
} from "./report-template-benchmark";

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

export type SectionPromptPlan = {
  tocEntryId: string;
  tocTitle: string;
  numbering: string | null;
  prompt: string;
  supportingChunks: SlideChunk[];
  maskedDocumentIds: string[];
};

export type ReportFamilyPlan = {
  familyName: string;
  toc: TocEntry[];
  sourcePolicy: SourcePolicy;
  sectionPlans: SectionPromptPlan[];
  benchmarkEvaluation: ReportFamilyBenchmarkEvaluation | null;
  retryPlan: ReportFamilyRalphPlan | null;
};

const MAX_TOC_ENTRIES = 24;
const MAX_SECTION_CHUNKS = 3;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

type RawSlideChunk = {
  chunkId: string;
  documentId: string;
  title: string;
  slideNumber: number | null;
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
    current.summary = normalizeWhitespace(current.summary).slice(0, 800);
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
): SectionPromptPlan[] {
  const allowedSlideChunks = sourceDocuments
    .filter((document) => sourcePolicy.allowedSourceIds.includes(document.documentId))
    .flatMap((document) => buildSlideChunks(document));

  return toc.map((entry) => {
    const supportingChunks = allowedSlideChunks
      .map((chunk) => ({
        ...chunk,
        score: Math.max(
          scoreTokenOverlap(entry.title, chunk.title),
          scoreTokenOverlap(entry.title, chunk.summary),
        ),
      }))
      .sort((left, right) => right.score - left.score)
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

    const chunkText = supportingChunks.length
      ? supportingChunks
          .map((chunk, index) => {
            const slideLabel =
              chunk.slideNumber !== null ? `슬라이드 ${chunk.slideNumber}` : `청크 ${index + 1}`;
            return `- ${slideLabel} | ${chunk.title}\n  ${chunk.summary}`;
          })
          .join("\n")
      : "- 매칭된 슬라이드 청크가 없습니다. reviewer가 section-source alignment를 먼저 확인해야 합니다.";

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
      "",
      "허용된 슬라이드 근거:",
      chunkText,
      "",
      "출력 규칙:",
      "- 한국어 보고서 문체로 작성",
      "- 2~4개 짧은 문단 또는 bullet로 정리",
      "- 슬라이드에 없는 사실은 쓰지 않음",
      "- 마지막에 `근거 슬라이드:` 라인으로 사용한 slide title을 나열",
    ].join("\n");

    return {
      tocEntryId: entry.id,
      tocTitle: entry.title,
      numbering: entry.numbering,
      prompt,
      supportingChunks,
      maskedDocumentIds: sourcePolicy.maskedSourceIds,
    };
  });
}

export function buildReportFamilyPlan(params: {
  familyName: string;
  targetDocument: ReportFamilyDocumentInput;
  sourceDocuments: ReportFamilyDocumentInput[];
  benchmarkRun?: ReportFamilyBenchmarkRun | null;
}): ReportFamilyPlan {
  const toc = extractTableOfContents(params.targetDocument);
  const sourcePolicy = buildSourcePolicy(params.targetDocument, params.sourceDocuments);
  const sectionPlans = buildSectionPromptPlans(
    params.familyName,
    toc,
    params.targetDocument,
    params.sourceDocuments,
    sourcePolicy,
  );

  const benchmarkEvaluation = params.benchmarkRun
    ? evaluateReportFamilyBenchmark(params.benchmarkRun)
    : null;
  const retryPlan = benchmarkEvaluation
    ? buildReportFamilyRalphPlan(benchmarkEvaluation)
    : null;

  return {
    familyName: params.familyName,
    toc,
    sourcePolicy,
    sectionPlans,
    benchmarkEvaluation,
    retryPlan,
  };
}
