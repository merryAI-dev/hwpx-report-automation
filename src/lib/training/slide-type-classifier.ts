/**
 * Slide Type Classifier
 *
 * Classifies PPTX slides into abstract structural types based on
 * content-agnostic signals (numbers, tables, dates, bullet density, etc.).
 *
 * Design principle: No classification logic may reference specific
 * organization names, domain keywords, or document-specific content.
 * Only structural patterns like "has_table", "has_percentage", "is_title_only".
 */

import type { EditorSegment } from "@/lib/editor/hwpx-to-prosemirror";
import type {
  SlideClassification,
  SlideStructuralSignal,
  SlideTypeId,
} from "./types";

// ─── Signal Detection Thresholds ─────────────────────────────────────────────

const LOW_TEXT_DENSITY_CHAR_THRESHOLD = 80; // < 80 chars total → low density
const BULLET_DENSITY_RATIO = 0.5;           // > 50% of segments are bullets → high density
const TABLE_DOMINANT_RATIO = 0.4;           // > 40% of content is table cells
const CONFIDENCE_THRESHOLD = 0.4;          // Below this → "unknown"

// ─── Keyword Signals (structural role keywords, not domain-specific) ─────────

/** Keywords that indicate an organization/program introduction section. */
const ORG_INTRO_KEYWORDS = [
  "소개", "연혁", "미션", "비전", "설립", "법인", "현황", "운영사", "수행기관",
  "about", "overview", "introduction", "mission", "history",
];

/** Keywords that indicate KPI / performance tracking. */
const KPI_KEYWORDS = [
  "달성", "목표", "kpi", "성과", "지표", "실적", "현황", "결과",
  "achievement", "target", "performance",
];

/** Keywords that indicate a timeline or schedule. */
const TIMELINE_KEYWORDS = [
  "일정", "일자", "추진", "계획", "단계", "phase", "schedule", "timeline",
];

/** Keywords indicating per-entity details. */
const ENTITY_KEYWORDS = [
  "기업", "업체", "스타트업", "팀", "회사", "법인", "참여기업", "보육기업",
  "company", "startup", "team", "entity",
];

/** Keywords indicating recommendations or strategies. */
const RECOMMENDATION_KEYWORDS = [
  "제언", "제안", "전략", "향후", "개선", "방향", "계획", "추진방안",
  "recommendation", "strategy", "next", "future", "improvement",
];

/** Keywords indicating survey / satisfaction data. */
const SURVEY_KEYWORDS = [
  "만족도", "조사", "설문", "평가", "피드백", "의견", "점수",
  "satisfaction", "survey", "feedback", "rating",
];

// ─── Date Pattern Detection ───────────────────────────────────────────────────

/** Matches Korean/numeric date patterns: 2024.03, 25.01, 3월, 2분기, Q1 */
const DATE_PATTERN = /\b(\d{2,4}[./년]\s*\d{1,2}[월./]?|\d+분기|[Qq][1-4]|[1-4]분기)\b/;

/** Matches ordinal/sequential markers: 1기, Phase1, Step2 */
const SEQUENTIAL_PATTERN = /\b(\d+기|phase\s*\d+|step\s*\d+|단계\s*\d+|\d+단계)\b/i;

// ─── Structural Signal Extraction ────────────────────────────────────────────

type SlideSegmentGroup = {
  slideNumber: number;
  segments: EditorSegment[];
};

function groupSegmentsBySlide(segments: EditorSegment[]): SlideSegmentGroup[] {
  const groups = new Map<number, EditorSegment[]>();

  for (const seg of segments) {
    const slideNum = Number(seg.styleHints["slideNumber"] ?? 0);
    if (!groups.has(slideNum)) groups.set(slideNum, []);
    groups.get(slideNum)!.push(seg);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([slideNumber, segs]) => ({ slideNumber, segments: segs }));
}

function extractSignals(group: SlideSegmentGroup): Set<SlideStructuralSignal> {
  const signals = new Set<SlideStructuralSignal>();
  const { segments } = group;

  const allText = segments.map((s) => s.text).join(" ");
  const allTextLower = allText.toLowerCase();
  const titleSegs = segments.filter((s) => s.styleHints["pptxRole"] === "title");
  const bodySegs = segments.filter((s) => s.styleHints["pptxRole"] === "body");
  const tableSegs = segments.filter((s) => s.styleHints["pptxRole"] === "table");

  const totalChars = allText.replace(/\s/g, "").length;
  const totalSegments = segments.length;

  // is_title_only: only title segment(s), negligible body
  if (titleSegs.length > 0 && bodySegs.length === 0 && tableSegs.length === 0) {
    signals.add("is_title_only");
  }

  // has_table: any table segments present
  if (tableSegs.length > 0) {
    signals.add("has_table");
  }

  // has_numbers: multiple numeric values (not just slide numbers)
  const numberMatches = allText.match(/\b\d+[,.]?\d*\b/g) ?? [];
  if (numberMatches.length >= 3) {
    signals.add("has_numbers");
  }

  // has_percentage: percentage sign or percent-related Korean
  if (/%|퍼센트|percent/i.test(allText)) {
    signals.add("has_percentage");
  }

  // has_goal_actual_pair: both 목표 and 달성/실적 appear
  if (/목표/.test(allText) && /달성|실적|결과/.test(allText)) {
    signals.add("has_goal_actual_pair");
  }

  // has_date_pattern: date-like patterns
  if (DATE_PATTERN.test(allText) || SEQUENTIAL_PATTERN.test(allText)) {
    signals.add("has_date_pattern");
  }

  // has_timeline_markers: multiple date patterns or timeline keywords
  const dateMatches = allText.match(DATE_PATTERN) ?? [];
  if (
    dateMatches.length >= 2 ||
    TIMELINE_KEYWORDS.some((k) => allTextLower.includes(k))
  ) {
    signals.add("has_timeline_markers");
  }

  // has_bullet_list: high ratio of short body segments (< 50 chars each)
  if (bodySegs.length > 0) {
    const shortSegs = bodySegs.filter((s) => s.text.trim().length < 60);
    if (shortSegs.length / bodySegs.length >= BULLET_DENSITY_RATIO) {
      signals.add("has_bullet_list");
    }
  }

  // has_low_text_density: very little text overall
  if (totalChars < LOW_TEXT_DENSITY_CHAR_THRESHOLD) {
    signals.add("has_low_text_density");
  }

  // has_image_placeholder: truly empty slide (no segments at all)
  // Do NOT fire just because text is short — that conflates with cover slides
  if (totalSegments === 0) {
    signals.add("has_image_placeholder");
  }

  // has_column_headers: table with header row pattern
  if (
    tableSegs.length > 0 &&
    tableSegs.some(
      (s) =>
        s.styleHints["tableRole"] === "header" ||
        /구분|항목|분류|내용|결과|현황/.test(s.text),
    )
  ) {
    signals.add("has_column_headers");
  }

  // has_entity_repetition: entity-type keywords appearing multiple times
  const entityMatches = ENTITY_KEYWORDS.filter((k) =>
    allTextLower.includes(k),
  );
  if (entityMatches.length >= 2 || /기업\s*\d+|[①②③④⑤⑥⑦⑧⑨⑩]/.test(allText)) {
    signals.add("has_entity_repetition");
  }

  // has_satisfaction_keywords
  if (SURVEY_KEYWORDS.some((k) => allTextLower.includes(k))) {
    signals.add("has_satisfaction_keywords");
  }

  // has_recommendation_keywords
  if (RECOMMENDATION_KEYWORDS.some((k) => allTextLower.includes(k))) {
    signals.add("has_recommendation_keywords");
  }

  // has_organization_keywords
  if (ORG_INTRO_KEYWORDS.some((k) => allTextLower.includes(k))) {
    signals.add("has_organization_keywords");
  }

  return signals;
}

// ─── Type Scoring ─────────────────────────────────────────────────────────────

type TypeScore = { type: SlideTypeId; score: number };

function scoreSlideType(
  signals: Set<SlideStructuralSignal>,
  segmentGroup: SlideSegmentGroup,
): TypeScore[] {
  const scores: TypeScore[] = [];

  const has = (s: SlideStructuralSignal) => signals.has(s);

  // cover_divider: title-only or very low text
  {
    let score = 0;
    if (has("is_title_only")) score += 0.7;
    if (has("has_low_text_density")) score += 0.3;
    scores.push({ type: "cover_divider", score: Math.min(score, 1) });
  }

  // kpi_dashboard: numbers + percentage + goal/actual pair
  {
    let score = 0;
    if (has("has_numbers")) score += 0.3;
    if (has("has_percentage")) score += 0.3;
    if (has("has_goal_actual_pair")) score += 0.4;
    if (has("has_table")) score += 0.2;
    scores.push({ type: "kpi_dashboard", score: Math.min(score, 1) });
  }

  // comparison_table: table dominant with column headers
  {
    let score = 0;
    if (has("has_table")) score += 0.5;
    if (has("has_column_headers")) score += 0.4;
    if (has("has_numbers")) score += 0.1;
    scores.push({ type: "comparison_table", score: Math.min(score, 1) });
  }

  // timeline_gantt: date patterns + timeline markers
  {
    let score = 0;
    if (has("has_date_pattern")) score += 0.3;
    if (has("has_timeline_markers")) score += 0.5;
    if (has("has_bullet_list")) score += 0.1;
    scores.push({ type: "timeline_gantt", score: Math.min(score, 1) });
  }

  // organization_overview: org keywords, narrative, no heavy tables
  {
    let score = 0;
    if (has("has_organization_keywords")) score += 0.5;
    if (!has("has_table")) score += 0.2;
    if (!has("has_goal_actual_pair")) score += 0.1;
    scores.push({ type: "organization_overview", score: Math.min(score, 1) });
  }

  // entity_detail_card: entity repetition
  {
    let score = 0;
    if (has("has_entity_repetition")) score += 0.6;
    if (has("has_table")) score += 0.2;
    scores.push({ type: "entity_detail_card", score: Math.min(score, 1) });
  }

  // survey_result: satisfaction keywords + numbers
  {
    let score = 0;
    if (has("has_satisfaction_keywords")) score += 0.6;
    if (has("has_numbers")) score += 0.2;
    if (has("has_percentage")) score += 0.2;
    scores.push({ type: "survey_result", score: Math.min(score, 1) });
  }

  // recommendation: recommendation keywords, no heavy tables
  {
    let score = 0;
    if (has("has_recommendation_keywords")) score += 0.6;
    if (has("has_bullet_list")) score += 0.2;
    scores.push({ type: "recommendation", score: Math.min(score, 1) });
  }

  // bullet_summary: high bullet density, no dominant tables
  {
    let score = 0;
    if (has("has_bullet_list")) score += 0.4;
    if (!has("has_table")) score += 0.2;
    if (!has("has_goal_actual_pair") && !has("has_satisfaction_keywords")) {
      score += 0.1;
    }
    scores.push({ type: "bullet_summary", score: Math.min(score, 1) });
  }

  // infographic_visual: low density + image placeholder
  {
    let score = 0;
    if (has("has_image_placeholder")) score += 0.4;
    if (has("has_low_text_density")) score += 0.4;
    scores.push({ type: "infographic_visual", score: Math.min(score, 1) });
  }

  return scores.sort((a, b) => b.score - a.score);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify all slides in a parsed PPTX segment array.
 *
 * @param segments - EditorSegment[] from parsePptxToProseMirror()
 * @returns SlideClassification[] sorted by slideNumber
 */
export function classifySlides(segments: EditorSegment[]): SlideClassification[] {
  const groups = groupSegmentsBySlide(segments);

  return groups.map((group) => {
    const signals = extractSignals(group);
    const scores = scoreSlideType(signals, group);
    const best = scores[0];

    const slideType: SlideTypeId =
      best.score >= CONFIDENCE_THRESHOLD ? best.type : "unknown";

    return {
      slideNumber: group.slideNumber,
      slideType,
      confidence: best.score,
      structuralSignals: Array.from(signals),
    };
  });
}

/**
 * Classify a single slide given its segments.
 */
export function classifySingleSlide(
  slideNumber: number,
  segments: EditorSegment[],
): SlideClassification {
  const group: SlideSegmentGroup = { slideNumber, segments };
  const signals = extractSignals(group);
  const scores = scoreSlideType(signals, group);
  const best = scores[0];

  const slideType: SlideTypeId =
    best.score >= CONFIDENCE_THRESHOLD ? best.type : "unknown";

  return {
    slideNumber,
    slideType,
    confidence: best.score,
    structuralSignals: Array.from(signals),
  };
}

/**
 * Summarize the distribution of slide types across a deck.
 */
export function summarizeSlideTypeDistribution(
  classifications: SlideClassification[],
): Record<SlideTypeId, number> {
  const dist: Record<string, number> = {};
  for (const c of classifications) {
    dist[c.slideType] = (dist[c.slideType] ?? 0) + 1;
  }
  return dist as Record<SlideTypeId, number>;
}
