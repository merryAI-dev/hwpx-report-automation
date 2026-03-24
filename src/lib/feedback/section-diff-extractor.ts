/**
 * section-diff-extractor.ts
 *
 * Computes a structural diff between an AI-generated section and a human-edited
 * version. Produces abstract correction patterns that form the RLHF learning signal.
 *
 * Correction patterns (content-agnostic):
 *   - added_context_paragraph      : human added ≥1 paragraph not in AI version
 *   - removed_paragraph            : human removed ≥1 AI paragraph
 *   - rewritten_paragraph          : paragraph kept but significantly reworded
 *   - bullet_to_narrative          : bullet-style → flowing prose conversion
 *   - narrative_to_bullet          : flowing prose → bullet-style conversion
 *   - table_added                  : table added where AI had none
 *   - table_removed                : AI had table, human removed it
 *   - table_structure_changed      : table headers/row count changed
 *   - corrected_table_values       : same structure, cell content changed
 *   - removed_hallucination        : paragraph removed AND it had hallucination signals
 *   - added_citation               : new citation added
 *   - section_accepted             : no meaningful changes (clean accept)
 *   - section_rejected             : entire content replaced
 */

import type { ReportFamilyDraftSection, ReportFamilyDraftTable } from "@/lib/report-family-draft-generator";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CorrectionPattern =
  | "added_context_paragraph"
  | "removed_paragraph"
  | "rewritten_paragraph"
  | "bullet_to_narrative"
  | "narrative_to_bullet"
  | "table_added"
  | "table_removed"
  | "table_structure_changed"
  | "corrected_table_values"
  | "removed_hallucination"
  | "added_citation"
  | "section_accepted"
  | "section_rejected";

export type ParagraphChange = {
  type: "added" | "removed" | "rewritten" | "unchanged";
  aiText?: string;
  humanText?: string;
};

export type TableDiff = {
  type: "added" | "removed" | "structure_changed" | "values_changed" | "unchanged";
  headerChanges: string[];
  rowCountDelta: number;
};

export type SectionDiff = {
  tocEntryId: string;
  sectionType: string;

  /** Abstract correction patterns applied to this section */
  correctionPatterns: CorrectionPattern[];

  /** Per-paragraph change list */
  paragraphChanges: ParagraphChange[];

  /** Table diff (null if neither version has a table) */
  tableDiff: TableDiff | null;

  /** Citation count delta */
  citationsDelta: number;

  /** 0 = identical, 1 = completely replaced */
  changeMagnitude: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Rough bullet-detection: starts with -, •, *, or is short (<60 chars) */
function isBulletStyle(paragraphs: string[]): boolean {
  if (paragraphs.length === 0) return false;
  const bulletLike = paragraphs.filter(
    (p) => /^[-•*·]/.test(p.trim()) || p.trim().length < 60,
  );
  return bulletLike.length / paragraphs.length > 0.5;
}

/**
 * Hallucination signal heuristics (content-agnostic):
 * - Contains a year pattern e.g. "2023" with no surrounding context match
 * - Contains precise numeric claims (e.g. "38.5%", "KRW 2.3 billion")
 * - Contains quoted speech with no citation
 */
function hasHallucinationSignal(text: string): boolean {
  const hasIsolatedYear = /\b(19|20)\d{2}\b/.test(text);
  const hasPreciseNumber = /\b\d+[.,]\d+\s*(%|억|만|명|개|건|회)\b/.test(text);
  const hasQuotedSpeech = /"[^"]{10,}"/.test(text) || /"[^"]{10,}"/.test(text);
  return hasIsolatedYear || hasPreciseNumber || hasQuotedSpeech;
}

/** Normalized Levenshtein similarity [0, 1] between two short strings */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const longerLen = longer.length;
  if (longerLen === 0) return 1;
  return (longerLen - editDistance(longer, shorter)) / longerLen;
}

function editDistance(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1[i - 1] !== s2[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

/**
 * Align two paragraph lists using greedy similarity matching.
 * Returns an array of change records.
 */
function alignParagraphs(
  aiParas: string[],
  humanParas: string[],
): ParagraphChange[] {
  const used = new Set<number>();
  const changes: ParagraphChange[] = [];

  for (const aiPara of aiParas) {
    // Find best matching human paragraph
    let bestIdx = -1;
    let bestSim = 0;
    for (let j = 0; j < humanParas.length; j++) {
      if (used.has(j)) continue;
      const sim = similarity(aiPara.slice(0, 200), humanParas[j].slice(0, 200));
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }

    if (bestSim >= 0.85 && bestIdx >= 0) {
      used.add(bestIdx);
      changes.push({ type: "unchanged", aiText: aiPara, humanText: humanParas[bestIdx] });
    } else if (bestSim >= 0.3 && bestIdx >= 0) {
      used.add(bestIdx);
      changes.push({ type: "rewritten", aiText: aiPara, humanText: humanParas[bestIdx] });
    } else {
      changes.push({ type: "removed", aiText: aiPara });
    }
  }

  // Remaining human paragraphs are additions
  for (let j = 0; j < humanParas.length; j++) {
    if (!used.has(j)) {
      changes.push({ type: "added", humanText: humanParas[j] });
    }
  }

  return changes;
}

function diffTable(
  ai: ReportFamilyDraftTable | null,
  human: ReportFamilyDraftTable | null,
): TableDiff | null {
  if (!ai && !human) return null;

  if (!ai && human) {
    return { type: "added", headerChanges: [], rowCountDelta: human.rows.length };
  }
  if (ai && !human) {
    return { type: "removed", headerChanges: [], rowCountDelta: -ai.rows.length };
  }
  if (!ai || !human) return null;

  // Both present
  const headerChanges: string[] = [];
  const aiHeaders = ai.headers.join("|");
  const humanHeaders = human.headers.join("|");
  if (aiHeaders !== humanHeaders) {
    headerChanges.push(`${aiHeaders} → ${humanHeaders}`);
  }
  const rowDelta = human.rows.length - ai.rows.length;

  if (headerChanges.length > 0 || rowDelta !== 0) {
    return { type: "structure_changed", headerChanges, rowCountDelta: rowDelta };
  }

  // Same structure — check if values changed
  const aiFlat = ai.rows.flat().join("|");
  const humanFlat = human.rows.flat().join("|");
  if (aiFlat !== humanFlat) {
    return { type: "values_changed", headerChanges: [], rowCountDelta: 0 };
  }

  return { type: "unchanged", headerChanges: [], rowCountDelta: 0 };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Compute a structural diff between an AI-generated section and its human-edited version.
 */
export function extractSectionDiff(
  ai: ReportFamilyDraftSection,
  human: ReportFamilyDraftSection,
): SectionDiff {
  const paraChanges = alignParagraphs(ai.paragraphs, human.paragraphs);
  const tableDiff = diffTable(ai.table, human.table);
  const citationsDelta = human.citations.length - ai.citations.length;

  // Count changes
  const added = paraChanges.filter((c) => c.type === "added").length;
  const removed = paraChanges.filter((c) => c.type === "removed").length;
  const rewritten = paraChanges.filter((c) => c.type === "rewritten").length;
  const unchanged = paraChanges.filter((c) => c.type === "unchanged").length;
  const total = Math.max(ai.paragraphs.length, human.paragraphs.length, 1);

  const changeMagnitude = Math.min(
    1,
    (added + removed + rewritten * 0.8) / total,
  );

  // Derive correction patterns
  const patterns = new Set<CorrectionPattern>();

  if (changeMagnitude < 0.05 && !tableDiff && citationsDelta === 0) {
    patterns.add("section_accepted");
  } else if (changeMagnitude > 0.9) {
    patterns.add("section_rejected");
  } else {
    if (added > 0) patterns.add("added_context_paragraph");
    if (removed > 0) {
      patterns.add("removed_paragraph");
      // Check for hallucination signals in removed paragraphs
      const removedHallucinationCount = paraChanges
        .filter((c) => c.type === "removed" && c.aiText)
        .filter((c) => hasHallucinationSignal(c.aiText!)).length;
      if (removedHallucinationCount > 0) patterns.add("removed_hallucination");
    }
    if (rewritten > 0) patterns.add("rewritten_paragraph");
  }

  // Style shift detection: always apply, even on rejection
  if (!patterns.has("section_accepted")) {
    const aiIsBullet = isBulletStyle(ai.paragraphs);
    const humanIsBullet = isBulletStyle(human.paragraphs);
    if (aiIsBullet && !humanIsBullet && human.paragraphs.length > 0) {
      patterns.add("bullet_to_narrative");
    } else if (!aiIsBullet && humanIsBullet && human.paragraphs.length > 0) {
      patterns.add("narrative_to_bullet");
    }
  }

  // Table patterns
  if (tableDiff) {
    if (tableDiff.type === "added") patterns.add("table_added");
    else if (tableDiff.type === "removed") patterns.add("table_removed");
    else if (tableDiff.type === "structure_changed") patterns.add("table_structure_changed");
    else if (tableDiff.type === "values_changed") patterns.add("corrected_table_values");
  }

  if (citationsDelta > 0) patterns.add("added_citation");

  return {
    tocEntryId: ai.tocEntryId,
    sectionType: ai.sectionType,
    correctionPatterns: Array.from(patterns),
    paragraphChanges: paraChanges,
    tableDiff,
    citationsDelta,
    changeMagnitude,
  };
}

/**
 * Compute diffs for all sections in a draft pair.
 * Sections are matched by tocEntryId; unmatched human sections are treated as additions.
 */
export function extractDraftDiff(
  aiSections: ReportFamilyDraftSection[],
  humanSections: ReportFamilyDraftSection[],
): SectionDiff[] {
  const humanByTocId = new Map(humanSections.map((s) => [s.tocEntryId, s]));
  const diffs: SectionDiff[] = [];

  for (const ai of aiSections) {
    const human = humanByTocId.get(ai.tocEntryId);
    if (human) {
      diffs.push(extractSectionDiff(ai, human));
    }
    // If no matching human section, skip (section may have been deleted entirely)
  }

  return diffs;
}

/**
 * Aggregate correction patterns across all section diffs.
 * Returns a frequency map.
 */
export function aggregateCorrectionPatterns(
  diffs: SectionDiff[],
): Record<CorrectionPattern, number> {
  const counts = {} as Record<CorrectionPattern, number>;
  for (const diff of diffs) {
    for (const pattern of diff.correctionPatterns) {
      counts[pattern] = (counts[pattern] ?? 0) + 1;
    }
  }
  return counts;
}
