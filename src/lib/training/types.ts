/**
 * RLHF Training Infrastructure — Core Types
 *
 * All types here are content-agnostic: they describe structural patterns,
 * not specific document content (no "MYSC", "해양수산", etc.).
 *
 * Design principle: a SlideTypeId or TransformationRule must be reusable
 * across any accelerator final report, investment review, or program report —
 * regardless of the specific organization or domain.
 */

// ─── Slide Type Classification ───────────────────────────────────────────────

/**
 * Abstract taxonomy of slide types based on structural signals only.
 * Adding a new type requires: a structural signal definition + test coverage.
 */
export type SlideTypeId =
  | "kpi_dashboard"        // Metrics, numbers, achievement rates, goal vs. actual
  | "organization_overview" // Company/program intro, history timeline, mission
  | "timeline_gantt"       // Sequential activities, date patterns, schedule grids
  | "entity_detail_card"   // Per-company / per-item summary (1-2 slides per entity)
  | "comparison_table"     // Table-dominant slides with column headers
  | "infographic_visual"   // Low text density, image/chart placeholders
  | "bullet_summary"       // High bullet density, short text items, lists
  | "cover_divider"        // Minimal text, section dividers, title-only slides
  | "recommendation"       // Proposals, next steps, strategy suggestions
  | "survey_result"        // Satisfaction scores, survey percentages, ratings
  | "unknown";             // Does not meet threshold for any above type

/** Structural signals extracted from slide content (content-agnostic). */
export type SlideStructuralSignal =
  | "has_table"
  | "has_numbers"
  | "has_percentage"
  | "has_date_pattern"
  | "has_timeline_markers"
  | "has_bullet_list"
  | "has_low_text_density"
  | "has_image_placeholder"
  | "has_entity_repetition"
  | "has_column_headers"
  | "has_goal_actual_pair"
  | "has_satisfaction_keywords"
  | "has_recommendation_keywords"
  | "has_organization_keywords"
  | "is_title_only";

export type SlideClassification = {
  slideNumber: number;
  slideType: SlideTypeId;
  /** Confidence in [0, 1]. Below 0.4 → "unknown". */
  confidence: number;
  /** Which structural signals fired for this classification. */
  structuralSignals: SlideStructuralSignal[];
};

// ─── Report Section Type Classification ──────────────────────────────────────

/**
 * Abstract taxonomy of report section types.
 * Maps to the output side of a PPTX → Report transformation.
 */
export type ReportSectionTypeId =
  | "narrative_overview"           // Flowing text describing background/context
  | "performance_analysis_table"   // Achievement table + interpretation paragraphs
  | "operations_timeline_detail"   // Chronological activity list with dates/results
  | "entity_case_study"            // Multi-paragraph detail per entity/company
  | "survey_analysis"              // Survey results with commentary
  | "strategy_recommendation"      // Forward-looking proposals and next steps
  | "appendix_evidence"            // Supporting evidence, attachments list
  | "toc_cover";                   // Table of contents or cover page

export type ReportSectionClassification = {
  sectionId: string;   // tocEntryId or derived ID
  title: string;
  sectionType: ReportSectionTypeId;
  confidence: number;
  structuralSignals: string[];
};

// ─── Transformation Rules ─────────────────────────────────────────────────────

/**
 * Describes how a slide type maps to a report section type.
 * This is the core abstraction that enables generalization.
 *
 * Example:
 *   kpi_dashboard → performance_analysis_table
 *   pattern: "table_with_narrative_interpretation"
 *   expansionFactor: 2.5  (report is ~2.5x the length of the slide)
 *   outputComponents: ["achievement_table", "interpretation_paragraph"]
 */
export type TransformationPattern =
  | "table_with_narrative_interpretation"  // Table + explanatory text
  | "bullet_to_chronological_narrative"    // Bullets become prose timeline
  | "card_to_multi_page_detail"            // 1-page slide → multi-section report
  | "kpi_to_achievement_table"             // Dashboard → structured table
  | "visual_to_text_description"           // Infographic → text explanation
  | "recommendation_to_strategy_section"   // Bullets → strategic narrative
  | "survey_to_analysis_section"           // Survey data → analysis + commentary
  | "overview_to_narrative_section"        // Intro slide → background narrative
  | "divider_to_chapter_heading"           // Section divider → chapter intro
  | "unknown";

export type TransformationRule = {
  ruleId: string;
  slideType: SlideTypeId;
  reportSectionType: ReportSectionTypeId;
  transformationPattern: TransformationPattern;
  /**
   * Approximate ratio of report content length to slide content length.
   * 1.0 = same length, 3.0 = report is ~3x longer than the slide.
   */
  structuralExpansionFactor: number;
  /**
   * The structural components that appear in the report output.
   * e.g. ["table", "interpretation_paragraph", "evidence_reference"]
   */
  outputComponents: string[];
  /** Confidence derived from training packet evidence. */
  confidence: number;
  /** How many training examples support this rule. */
  supportingExampleCount: number;
};

// ─── Training Packet Structures ───────────────────────────────────────────────

export type TransformationPair = {
  slideNumber: number;
  slideType: SlideTypeId;
  reportSectionId: string;
  reportSectionType: ReportSectionTypeId;
  transformationPattern: TransformationPattern;
  expansionFactor: number;
  /** Notes from human reviewer explaining the mapping. */
  reviewerNote?: string;
};

export type TrainingPacketSourceArtifacts = {
  slideDeckFile: string;
  reportFile: string;
  uploadedAt: string;
};

/** Summary of what was extracted from a training packet. */
export type TrainingPacketSummary = {
  packetId: string;
  familyId: string;
  slideCount: number;
  sectionCount: number;
  transformationPairCount: number;
  slideTypeDistribution: Record<SlideTypeId, number>;
  sectionTypeDistribution: Record<ReportSectionTypeId, number>;
  topTransformationRules: TransformationRule[];
  status: "pending" | "reviewed" | "gold";
};

// ─── Family Schema ────────────────────────────────────────────────────────────

export type TocSchemaEntry = {
  id: string;
  title: string;
  sectionType: ReportSectionTypeId;
  required: boolean;
  order: number;
};

export type FamilySchema = {
  familyId: string;
  version: number;
  tocSchema: TocSchemaEntry[];
  slideTypePatterns: SlideTypeId[];
  transformationRules: TransformationRule[];
  status: "draft" | "active" | "deprecated";
};

// ─── API Request/Response Types ───────────────────────────────────────────────

export type ExtractPatternsRequest = {
  familyId: string;
  slideDeckFile: string;   // filename reference
  reportFile: string;      // filename reference
  /** Pre-computed slide segments from pptx-to-prosemirror parser. */
  slideSegmentsJson: string;
  /** Optional: existing benchmark packet data to cross-reference. */
  existingPacketJson?: string;
};

export type ExtractPatternsResponse = {
  packetId: string;
  slideClassifications: SlideClassification[];
  reportSectionClassifications: ReportSectionClassification[];
  transformationPairs: TransformationPair[];
  inferredRules: TransformationRule[];
  warnings: string[];
};
