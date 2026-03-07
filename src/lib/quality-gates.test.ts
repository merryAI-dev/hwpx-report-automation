import { describe, expect, it } from "vitest";
import { evaluateQualityGate } from "./quality-gates";

describe("evaluateQualityGate", () => {
  it("passes when critical numeric/date tokens are preserved", () => {
    const result = evaluateQualityGate({
      originalText: "2024. 4. 5. 총 68%가 찬성했습니다.",
      suggestion: "2024. 4. 5. 총 68%가 찬성한 것으로 정리했습니다.",
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("fails when critical tokens disappear", () => {
    const result = evaluateQualityGate({
      originalText: "2024. 4. 5. 총 68%가 찬성했습니다.",
      suggestion: "찬성 의견이 많았습니다.",
    });

    expect(result.passed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.issues.some((issue) => issue.code === "critical_token_loss")).toBe(true);
  });

  it("flags banned terms and large length shifts", () => {
    const result = evaluateQualityGate({
      originalText: "원문은 충분히 긴 문장입니다. 숫자는 123을 유지합니다.",
      suggestion: "금지어 포함",
      bannedTerms: ["금지어"],
    });

    expect(result.requiresApproval).toBe(true);
    expect(result.issues.some((issue) => issue.code === "banned_term")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "length_shift")).toBe(true);
  });
});
