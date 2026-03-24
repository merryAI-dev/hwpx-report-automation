import type { JSONContent } from "@tiptap/core";
import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type {
  ReportFamilyPlan,
  ReportFamilySectionType,
  SectionPromptPlan,
} from "@/lib/report-family-planner";

export type ReportFamilyDraftCitation = {
  sourceType: "slide_chunk" | "evidence_bundle";
  sourceId: string;
  title: string;
};

export type ReportFamilyDraftTable = {
  headers: string[];
  rows: string[][];
};

export type ReportFamilyDraftSectionEvaluation = {
  passed: boolean;
  hasContent: boolean;
  typeAligned: boolean;
  slideGrounded: boolean;
  appendixSatisfied: boolean;
  entityAligned: boolean;
  issues: string[];
};

export type ReportFamilyDraftSection = {
  tocEntryId: string;
  title: string;
  sectionType: ReportFamilySectionType;
  paragraphs: string[];
  table: ReportFamilyDraftTable | null;
  citations: ReportFamilyDraftCitation[];
  usedFallback: boolean;
  attempts: number;
  evaluation: ReportFamilyDraftSectionEvaluation;
};

export type ReportFamilyDraftEvaluation = {
  status: "pass" | "retry";
  totalSections: number;
  completedSections: number;
  sectionCoverage: number;
  typeAlignment: number;
  slideGroundingCoverage: number;
  appendixEvidenceReadiness: number;
  entityFocusCoverage: number;
  failedSections: string[];
  retryReasons: string[];
};

export type ReportFamilyDraft = {
  familyId: string | null;
  familyName: string;
  engine: "openai" | "fallback";
  warnings: string[];
  sections: ReportFamilyDraftSection[];
  evaluation: ReportFamilyDraftEvaluation;
};

type DraftSectionPayload = {
  tocEntryId?: unknown;
  title?: unknown;
  paragraphs?: unknown;
  table?: unknown;
  citations?: unknown;
};

type DraftSectionOptions = {
  attempts?: number;
  usedFallback?: boolean;
};

function normalizeWhitespace(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeSentence(value: string | null | undefined): string {
  const text = normalizeWhitespace(value);
  if (!text) {
    return "";
  }
  return /[.!?。…]$/.test(text) ? text : `${text}.`;
}

function normalizeToken(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function uniqueByNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeToken(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(item);
  }
  return result;
}

function defaultHeadersForSectionType(sectionType: ReportFamilySectionType): string[] {
  switch (sectionType) {
    case "summary_table":
      return ["항목", "핵심 내용", "근거 슬라이드"];
    case "operations_timeline":
      return ["구분", "주요 내용", "근거 슬라이드"];
    case "survey_summary":
      return ["조사 항목", "요약", "근거 슬라이드"];
    default:
      return ["항목", "내용", "근거"];
  }
}

function buildFallbackParagraphs(section: SectionPromptPlan): string[] {
  const summaryParagraphs = uniqueByNormalized(
    section.supportingChunks
      .slice(0, 3)
      .map((chunk) => normalizeSentence(chunk.summary || chunk.title))
      .filter(Boolean),
  );

  const paragraphs: string[] = [];
  if (summaryParagraphs.length) {
    paragraphs.push(...summaryParagraphs.slice(0, 2));
  } else if (section.outputScaffold.length) {
    paragraphs.push(
      normalizeSentence(
        `${section.tocTitle} 섹션은 ${section.outputScaffold.slice(0, 2).join(", ")} 기준으로 정리한다`,
      ),
    );
  } else {
    paragraphs.push(
      normalizeSentence(`${section.tocTitle} 섹션에 대해 현재 확보된 슬라이드 근거를 중심으로 초안을 구성한다`),
    );
  }

  if (
    section.focusEntities.length &&
    !normalizeToken(paragraphs.join(" ")).includes(normalizeToken(section.focusEntities[0]))
  ) {
    paragraphs.unshift(
      normalizeSentence(
        `${section.focusEntities[0]} 중심으로 슬라이드 근거를 재구성해 해당 섹션의 핵심 내용을 정리한다`,
      ),
    );
  }

  if (
    section.evidenceExpectation === "appendix_bundle_required" &&
    section.evidenceBundles.length
  ) {
    paragraphs.push(
      normalizeSentence(
        `첨부 근거는 ${section.evidenceBundles
          .slice(0, 2)
          .map((bundle) => bundle.title)
          .join(", ")}를 우선 참고한다`,
      ),
    );
  }

  return uniqueByNormalized(paragraphs).slice(0, 3);
}

function buildFallbackTable(section: SectionPromptPlan): ReportFamilyDraftTable | null {
  if (
    section.sectionType !== "summary_table" &&
    section.sectionType !== "operations_timeline" &&
    section.sectionType !== "survey_summary"
  ) {
    return null;
  }

  const rows = section.supportingChunks.slice(0, 4).map((chunk) => [
    chunk.title,
    normalizeWhitespace(chunk.summary) || chunk.title,
    chunk.slideNumber ? `슬라이드 ${chunk.slideNumber}` : "슬라이드 요약",
  ]);

  if (!rows.length) {
    return {
      headers: defaultHeadersForSectionType(section.sectionType),
      rows: [[section.tocTitle, "슬라이드 근거를 재정렬해 수기 검토가 필요합니다.", "근거 부족"]],
    };
  }

  return {
    headers: defaultHeadersForSectionType(section.sectionType),
    rows,
  };
}

export function buildFallbackDraftSection(section: SectionPromptPlan): ReportFamilyDraftSection {
  return materializeDraftSection(section, {
    tocEntryId: section.tocEntryId,
    title: section.tocTitle,
    paragraphs: buildFallbackParagraphs(section),
    table: buildFallbackTable(section),
    citations: [
      ...section.supportingChunks.slice(0, 3).map((chunk) => ({
        sourceType: "slide_chunk" as const,
        sourceId: chunk.chunkId,
        title: chunk.title,
      })),
      ...section.evidenceBundles.slice(0, 2).map((bundle) => ({
        sourceType: "evidence_bundle" as const,
        sourceId: bundle.bundleId,
        title: bundle.title,
      })),
    ],
  }, {
    attempts: 1,
    usedFallback: true,
  });
}

function normalizeTable(table: unknown): ReportFamilyDraftTable | null {
  if (!table || typeof table !== "object") {
    return null;
  }
  const record = table as { headers?: unknown; rows?: unknown };
  const headers = Array.isArray(record.headers)
    ? record.headers.map((header) => normalizeWhitespace(String(header || ""))).filter(Boolean)
    : [];
  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((row) =>
          Array.isArray(row)
            ? row.map((cell) => normalizeWhitespace(String(cell || ""))).filter(Boolean)
            : [],
        )
        .filter((row) => row.length > 0)
    : [];

  if (!headers.length && !rows.length) {
    return null;
  }

  return {
    headers,
    rows,
  };
}

function buildCitationLookup(section: SectionPromptPlan): Map<string, ReportFamilyDraftCitation> {
  const entries: ReportFamilyDraftCitation[] = [
    ...section.supportingChunks.map((chunk) => ({
      sourceType: "slide_chunk" as const,
      sourceId: chunk.chunkId,
      title: chunk.title,
    })),
    ...section.evidenceBundles.map((bundle) => ({
      sourceType: "evidence_bundle" as const,
      sourceId: bundle.bundleId,
      title: bundle.title,
    })),
  ];

  return new Map(
    entries.flatMap((entry) => [
      [normalizeToken(entry.sourceId), entry],
      [normalizeToken(entry.title), entry],
    ]),
  );
}

function normalizeCitations(
  section: SectionPromptPlan,
  citations: unknown,
): ReportFamilyDraftCitation[] {
  if (!Array.isArray(citations)) {
    return [];
  }

  const lookup = buildCitationLookup(section);
  const normalized: ReportFamilyDraftCitation[] = [];
  for (const item of citations) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as {
      sourceType?: unknown;
      sourceId?: unknown;
      title?: unknown;
    };
    const sourceType =
      record.sourceType === "evidence_bundle" ? "evidence_bundle" : "slide_chunk";
    const sourceId = normalizeWhitespace(String(record.sourceId || ""));
    const title = normalizeWhitespace(String(record.title || ""));
    const matched =
      lookup.get(normalizeToken(sourceId)) ||
      lookup.get(normalizeToken(title)) ||
      null;
    if (!matched || matched.sourceType !== sourceType) {
      continue;
    }
    normalized.push(matched);
  }
  return uniqueDraftCitations(normalized);
}

function uniqueDraftCitations(
  citations: ReportFamilyDraftCitation[],
): ReportFamilyDraftCitation[] {
  const seen = new Set<string>();
  const result: ReportFamilyDraftCitation[] = [];
  for (const citation of citations) {
    const key = `${citation.sourceType}:${citation.sourceId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function hasTableContent(table: ReportFamilyDraftTable | null): boolean {
  return Boolean(table?.rows.length || table?.headers.length);
}

export function evaluateDraftSection(
  section: SectionPromptPlan,
  draftSection: Pick<ReportFamilyDraftSection, "paragraphs" | "table" | "citations">,
): ReportFamilyDraftSectionEvaluation {
  const combinedText = normalizeToken(
    [
      ...draftSection.paragraphs,
      ...(draftSection.table?.rows.flat() || []),
      ...(draftSection.table?.headers || []),
    ].join(" "),
  );
  const hasContent = draftSection.paragraphs.length > 0 || hasTableContent(draftSection.table);
  const requiresTable =
    section.sectionType === "summary_table" ||
    section.sectionType === "operations_timeline" ||
    section.sectionType === "survey_summary";
  const typeAligned = requiresTable
    ? Boolean(draftSection.table?.rows.length)
    : draftSection.paragraphs.length > 0;
  const slideGrounded = section.supportingChunks.length
    ? draftSection.citations.some((citation) => citation.sourceType === "slide_chunk")
    : true;
  const appendixSatisfied =
    section.evidenceExpectation === "appendix_bundle_required"
      ? draftSection.citations.some((citation) => citation.sourceType === "evidence_bundle")
      : true;
  const entityAligned = section.focusEntities.length
    ? section.focusEntities.some((entity) => combinedText.includes(normalizeToken(entity)))
    : true;

  const issues: string[] = [];
  if (!hasContent) {
    issues.push("section body missing");
  }
  if (!typeAligned) {
    issues.push(
      requiresTable ? "section type requires a table-shaped output" : "section type requires narrative paragraphs",
    );
  }
  if (!slideGrounded) {
    issues.push("slide grounding missing");
  }
  if (!appendixSatisfied) {
    issues.push("appendix evidence missing");
  }
  if (!entityAligned) {
    issues.push("focus entity missing");
  }

  return {
    passed: issues.length === 0,
    hasContent,
    typeAligned,
    slideGrounded,
    appendixSatisfied,
    entityAligned,
    issues,
  };
}

export function materializeDraftSection(
  section: SectionPromptPlan,
  payload: DraftSectionPayload | null | undefined,
  options?: DraftSectionOptions,
): ReportFamilyDraftSection {
  const paragraphs = Array.isArray(payload?.paragraphs)
    ? uniqueByNormalized(
        payload!.paragraphs
          .map((paragraph) => normalizeSentence(String(paragraph || "")))
          .filter(Boolean),
      ).slice(0, 4)
    : [];
  const table = normalizeTable(payload?.table);
  const citations = normalizeCitations(section, payload?.citations);

  const draftSection: ReportFamilyDraftSection = {
    tocEntryId: normalizeWhitespace(String(payload?.tocEntryId || section.tocEntryId)) || section.tocEntryId,
    title: normalizeWhitespace(String(payload?.title || section.tocTitle)) || section.tocTitle,
    sectionType: section.sectionType,
    paragraphs,
    table,
    citations,
    usedFallback: options?.usedFallback ?? false,
    attempts: options?.attempts ?? 1,
    evaluation: {
      passed: false,
      hasContent: false,
      typeAligned: false,
      slideGrounded: false,
      appendixSatisfied: false,
      entityAligned: false,
      issues: [],
    },
  };

  draftSection.evaluation = evaluateDraftSection(section, draftSection);
  return draftSection;
}

export function evaluateReportFamilyDraft(
  plan: ReportFamilyPlan,
  sections: ReportFamilyDraftSection[],
): ReportFamilyDraftEvaluation {
  const totalSections = plan.sectionPlans.length;
  const completedSections = sections.filter((section) => section.evaluation.hasContent).length;
  const typeAlignedSections = sections.filter((section) => section.evaluation.typeAligned).length;
  const slideGroundedSections = sections.filter((section) => section.evaluation.slideGrounded).length;
  const appendixRequiredCount = plan.sectionPlans.filter(
    (section) => section.evidenceExpectation === "appendix_bundle_required",
  ).length;
  const appendixSatisfiedCount = sections.filter(
    (section) => section.evaluation.appendixSatisfied,
  ).length;
  const entityRequiredCount = plan.sectionPlans.filter((section) => section.focusEntities.length > 0).length;
  const entityAlignedCount = sections.filter((section) => section.evaluation.entityAligned).length;
  const failedSections = sections
    .filter((section) => !section.evaluation.passed)
    .map((section) => section.title);
  const retryReasons = uniqueByNormalized(
    sections.flatMap((section) =>
      section.evaluation.issues.map((issue) => `${section.title}: ${issue}`),
    ),
  );

  return {
    status: failedSections.length ? "retry" : "pass",
    totalSections,
    completedSections,
    sectionCoverage: totalSections ? completedSections / totalSections : 0,
    typeAlignment: totalSections ? typeAlignedSections / totalSections : 0,
    slideGroundingCoverage: totalSections ? slideGroundedSections / totalSections : 0,
    appendixEvidenceReadiness: appendixRequiredCount
      ? appendixSatisfiedCount / appendixRequiredCount
      : 1,
    entityFocusCoverage: entityRequiredCount ? entityAlignedCount / entityRequiredCount : 1,
    failedSections,
    retryReasons,
  };
}

export function buildReportFamilyDraft(
  plan: ReportFamilyPlan,
  params?: {
    engine?: "openai" | "fallback";
    warnings?: string[];
    sections?: ReportFamilyDraftSection[];
  },
): ReportFamilyDraft {
  const sections =
    params?.sections && params.sections.length
      ? params.sections
      : plan.sectionPlans.map((section) => buildFallbackDraftSection(section));

  return {
    familyId: plan.familyId,
    familyName: plan.familyName,
    engine: params?.engine || "fallback",
    warnings: params?.warnings || [],
    sections,
    evaluation: evaluateReportFamilyDraft(plan, sections),
  };
}

function buildTableNode(
  table: ReportFamilyDraftTable,
  state: { segmentIndex: number },
  segments: EditorSegment[],
  sectionTitle: string,
): JSONContent {
  const rows = [
    table.headers.length ? table.headers : defaultHeadersForSectionType("summary_table"),
    ...table.rows,
  ];

  return {
    type: "table",
    attrs: {
      tableId: `generated::table::${state.segmentIndex}`,
      sourceRowCount: rows.length,
      sourceColCount: Math.max(...rows.map((row) => row.length), 1),
    },
    content: rows.map((row, rowIndex) => ({
      type: "tableRow",
      attrs: {
        rowIndex,
        sourceCellCount: row.length,
      },
      content: row.map((cell) => {
        const segmentId = `generated::seg::${state.segmentIndex}`;
        const textIndex = state.segmentIndex;
        state.segmentIndex += 1;
        const text = normalizeWhitespace(cell);
        segments.push({
          segmentId,
          fileName: "generated-report",
          textIndex,
          text,
          originalText: text,
          tag: "p",
          styleHints: {
            generated: "true",
            sectionTitle,
            location: rowIndex === 0 ? "table_header" : "table_cell",
          },
        });
        return {
          type: rowIndex === 0 ? "tableHeader" : "tableCell",
          attrs: {
            sourceColspan: 1,
            sourceRowspan: 1,
            colspan: 1,
            rowspan: 1,
          },
          content: [
            {
              type: "paragraph",
              attrs: {
                segmentId,
                fileName: "generated-report",
                textIndex,
                originalText: text,
              },
              content: text ? [{ type: "text", text }] : [],
            },
          ],
        };
      }),
    })),
  };
}

export function buildReportFamilyDraftEditorArtifacts(
  draft: ReportFamilyDraft,
): {
  doc: JSONContent;
  segments: EditorSegment[];
} {
  const content: JSONContent[] = [];
  const segments: EditorSegment[] = [];
  const state = { segmentIndex: 0 };

  const pushParagraph = (
    text: string,
    tag: "p" | "h1" | "h2",
    sectionTitle?: string,
  ) => {
    const normalized = normalizeWhitespace(text);
    const segmentId = `generated::seg::${state.segmentIndex}`;
    const textIndex = state.segmentIndex;
    state.segmentIndex += 1;
    segments.push({
      segmentId,
      fileName: "generated-report",
      textIndex,
      text: normalized,
      originalText: normalized,
      tag,
      styleHints: {
        generated: "true",
        sectionTitle: sectionTitle || draft.familyName,
      },
    });
    content.push({
      type: tag === "p" ? "paragraph" : "heading",
      attrs: {
        level: tag === "h1" ? 1 : tag === "h2" ? 2 : undefined,
        segmentId,
        fileName: "generated-report",
        textIndex,
        originalText: normalized,
      },
      content: normalized ? [{ type: "text", text: normalized }] : [],
    });
  };

  pushParagraph(`${draft.familyName} 보고서 초안`, "h1");

  for (const section of draft.sections) {
    pushParagraph(section.title, "h2", section.title);
    if (!section.evaluation.passed && section.evaluation.issues.length) {
      pushParagraph(
        `[점검 필요] ${section.evaluation.issues.join(", ")}`,
        "p",
        section.title,
      );
    }
    for (const paragraph of section.paragraphs) {
      pushParagraph(paragraph, "p", section.title);
    }
    if (section.table) {
      content.push(buildTableNode(section.table, state, segments, section.title));
    }
  }

  return {
    doc: {
      type: "doc",
      content,
    },
    segments,
  };
}

type PromptSectionOptions = {
  retryIssues?: string[];
};

function buildPromptSectionPacket(
  section: SectionPromptPlan,
  options?: PromptSectionOptions,
): string {
  const lines: string[] = [
    `[section]`,
    `toc_entry_id: ${section.tocEntryId}`,
    `title: ${section.tocTitle}`,
    `section_type: ${section.sectionType}`,
    `evidence_expectation: ${section.evidenceExpectation}`,
    `chunking_strategy: ${section.chunkingStrategy}`,
  ];

  if (section.focusEntities.length) {
    lines.push(`focus_entities: ${section.focusEntities.join(", ")}`);
  }
  if (section.outputScaffold.length) {
    lines.push("output_scaffold:");
    for (const scaffold of section.outputScaffold.slice(0, 4)) {
      lines.push(`- ${scaffold}`);
    }
  }
  if (section.supportingChunks.length) {
    lines.push("supporting_slide_chunks:");
    for (const chunk of section.supportingChunks.slice(0, 10)) {
      lines.push(`[slide ${chunk.slideNumber ?? "?"}] ${chunk.title}`);
      lines.push(normalizeWhitespace(chunk.summary));
    }
  }
  if (section.evidenceBundles.length) {
    lines.push("appendix_evidence_bundles:");
    for (const bundle of section.evidenceBundles.slice(0, 6)) {
      lines.push(`[${bundle.fileName} p.${bundle.bundleId}] ${bundle.title}`);
      lines.push(normalizeWhitespace(bundle.summary));
    }
  }
  if (section.customInstruction?.trim()) {
    lines.push(`custom_instruction: ${section.customInstruction.trim()}`);
  }
  if (options?.retryIssues?.length) {
    lines.push("retry_issues:");
    for (const issue of options.retryIssues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join("\n");
}

export function buildReportFamilyDraftPrompt(
  plan: ReportFamilyPlan,
  sections: SectionPromptPlan[],
  options?: {
    retryIssuesBySectionId?: Record<string, string[]>;
    /** PromptMemory context string injected from human feedback history */
    promptMemoryContext?: string | null;
    /** Free-text global instruction from the user (e.g. "표는 기업명 순으로 정렬") */
    userGlobalInstruction?: string | null;
  },
): string {
  const lines: string[] = [
    `family_name: ${plan.familyName}`,
    `family_id: ${plan.familyId || "unregistered"}`,
    `schema_source: ${plan.schemaSource}`,
    `rules: use only slide chunks and appendix evidence listed below`,
    `rules: do not copy or infer from masked sources`,
    `rules: produce Korean report prose for the target report schema, not slide bullets`,
    `rules: if section_type is table-like, emit a filled table`,
    `rules: citations must reference only sourceId values listed in each section packet`,
    `response_json_schema: {"sections":[{"tocEntryId":"string","title":"string","paragraphs":["string"],"table":{"headers":["string"],"rows":[["string"]]}|null,"citations":[{"sourceType":"slide_chunk|evidence_bundle","sourceId":"string","title":"string"}]}]}`,
  ];

  // Inject PromptMemory context from accumulated human feedback
  if (options?.promptMemoryContext) {
    lines.push(options.promptMemoryContext);
  }

  // Inject user-supplied global instruction
  if (options?.userGlobalInstruction?.trim()) {
    lines.push(`[사용자 추가 지시]\n${options.userGlobalInstruction.trim()}`);
  }

  for (const section of sections) {
    lines.push(
      buildPromptSectionPacket(section, {
        retryIssues: options?.retryIssuesBySectionId?.[section.tocEntryId],
      }),
    );
  }
  return lines.join("\n\n");
}
