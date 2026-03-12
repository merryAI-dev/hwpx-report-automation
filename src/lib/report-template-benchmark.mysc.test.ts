import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateReportFamilyBenchmark,
  evaluateTocBenchmarkCases,
  type TocBenchmarkCase,
} from "./report-template-benchmark";
import { buildReportFamilyRalphPlan } from "./report-template-ralph-loop";

type PacketEntry = {
  numbering?: string | null;
  title: string;
};

type PacketCase = {
  caseId: string;
  goldEntries: PacketEntry[];
  baselinePredictedEntries: PacketEntry[];
};

type MyscPacket = {
  familyId: string;
  benchmarkCases: PacketCase[];
};

function loadMyscPacket(): MyscPacket {
  const currentFilePath = fileURLToPath(import.meta.url);
  const packetPath = path.join(
    path.dirname(currentFilePath),
    "../../docs/benchmarks/mysc-final-report.packet.json",
  );
  return JSON.parse(readFileSync(packetPath, "utf8")) as MyscPacket;
}

function toTocCases(packet: MyscPacket): TocBenchmarkCase[] {
  return packet.benchmarkCases.map((testCase) => ({
    caseId: testCase.caseId,
    goldEntries: testCase.goldEntries.map((entry) => ({ ...entry, required: true })),
    predictedEntries: testCase.baselinePredictedEntries.map((entry) => ({ ...entry, required: true })),
  }));
}

describe("MYSC real-world benchmark packet", () => {
  it("shows that the current slide-deck TOC baseline is not submission-grade", () => {
    const packet = loadMyscPacket();
    const tocCases = toTocCases(packet);
    const tocSummary = evaluateTocBenchmarkCases(tocCases);

    expect(tocSummary.exactMatchRate).toBe(0);
    expect(tocSummary.requiredSectionMatchRate).toBeLessThan(0.2);
    expect(tocSummary.caseResults[0]?.missingRequiredEntries).toContain("1 프로그램 개요");
    expect(tocSummary.caseResults[0]?.missingRequiredEntries).toContain("[첨부2] 기업 만족도 조사 결과");
  });

  it("forces retry and prioritizes TOC extractor improvement on the MYSC pair", () => {
    const packet = loadMyscPacket();
    const evaluation = evaluateReportFamilyBenchmark({
      familyId: packet.familyId,
      sampleCount: 3,
      tocExtractionAccuracy: 1,
      tocBenchmarkCases: toTocCases(packet),
      sectionCoverage: 0.96,
      slideGroundingCoverage: 0.94,
      documentMaskingCoverage: 1,
      maskedSourceLeakageRate: 0,
      layoutSimilarity: 0.93,
      tableStructureAccuracy: 0.91,
      promptIterationWinRate: 0.8,
      reviewerEditRate: 0.08,
      criticalHallucinationRate: 0,
      manualCorrectionMinutes: 18,
    });

    expect(evaluation.status).toBe("retry");
    expect(evaluation.blockers.some((metric) => metric.id === "toc_extraction_accuracy")).toBe(true);
    expect(evaluation.tocSummary?.exactMatchRate).toBe(0);

    const retryPlan = buildReportFamilyRalphPlan(evaluation);
    expect(retryPlan.actions.some((action) => action.bucket === "improve_toc_extractor")).toBe(true);
  });
});
