export type QualityGateIssue = {
  code: "empty_suggestion" | "critical_token_loss" | "length_shift" | "banned_term";
  severity: "error" | "warning";
  message: string;
};

export type QualityGateResult = {
  passed: boolean;
  requiresApproval: boolean;
  issues: QualityGateIssue[];
};

export type EvaluateQualityGateParams = {
  originalText: string;
  suggestion: string;
  bannedTerms?: string[];
};

const CRITICAL_TOKEN_PATTERNS = [
  /\b\d{4}[./-]\s?\d{1,2}[./-]\s?\d{1,2}\b/g,
  /\b\d+(?:[.,]\d+)?%/g,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
  /\b\d+(?:\.\d+)?\b/g,
  /[A-Za-z]+\d+[A-Za-z\d-]*/g,
] as const;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function collectCriticalTokens(text: string): string[] {
  const found: string[] = [];
  for (const pattern of CRITICAL_TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const token = match[0]?.trim();
      if (token) {
        found.push(token);
      }
    }
  }
  return unique(found);
}

function hasCriticalToken(text: string, token: string): boolean {
  return text.includes(token);
}

function trimTerms(terms: string[] | undefined): string[] {
  return (terms || []).map((term) => term.trim()).filter(Boolean);
}

export function evaluateQualityGate(params: EvaluateQualityGateParams): QualityGateResult {
  const originalText = params.originalText.trim();
  const suggestion = params.suggestion.trim();
  const issues: QualityGateIssue[] = [];

  if (!suggestion) {
    issues.push({
      code: "empty_suggestion",
      severity: "error",
      message: "제안 텍스트가 비어 있습니다.",
    });
  }

  const criticalTokens = collectCriticalTokens(originalText);
  const missingCriticalTokens = criticalTokens.filter((token) => !hasCriticalToken(suggestion, token));
  if (missingCriticalTokens.length) {
    issues.push({
      code: "critical_token_loss",
      severity: "error",
      message: `원문의 핵심 토큰이 누락되었습니다: ${missingCriticalTokens.slice(0, 5).join(", ")}`,
    });
  }

  if (originalText.length >= 20 && suggestion) {
    const ratio = suggestion.length / Math.max(originalText.length, 1);
    if (ratio < 0.5 || ratio > 2) {
      issues.push({
        code: "length_shift",
        severity: "warning",
        message: `문장 길이가 크게 변했습니다. 원문 ${originalText.length}자 / 제안 ${suggestion.length}자`,
      });
    }
  }

  const bannedTerms = trimTerms(params.bannedTerms);
  const matchedBannedTerms = bannedTerms.filter((term) => suggestion.includes(term));
  if (matchedBannedTerms.length) {
    issues.push({
      code: "banned_term",
      severity: "error",
      message: `금지어가 포함되었습니다: ${matchedBannedTerms.join(", ")}`,
    });
  }

  const requiresApproval = issues.some((issue) => issue.severity === "error");
  return {
    passed: issues.length === 0,
    requiresApproval,
    issues,
  };
}
