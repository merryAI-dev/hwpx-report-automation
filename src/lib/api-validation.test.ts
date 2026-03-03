import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock("./logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/persistence/client", () => ({
  prisma: {
    auditLog: {
      findMany: mockFindMany,
    },
  },
}));

import {
  validateBodySize,
  validateMessageCount,
  validateSegmentCount,
  checkRateLimit,
  checkMonthlyCostLimit,
  getClientIp,
} from "./api-validation";

describe("validateBodySize", () => {
  it("returns null for small body", () => {
    expect(validateBodySize("hello")).toBeNull();
  });

  it("returns 400 response for oversized body", async () => {
    const bigBody = "x".repeat(200);
    const res = validateBodySize(bigBody, 100);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.code).toBe("BODY_TOO_LARGE");
  });

  it("checks byte length not character count (Korean)", () => {
    // Korean characters are 3 bytes each in UTF-8
    const korean = "가".repeat(40); // 120 bytes
    const res = validateBodySize(korean, 100);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
  });
});

describe("validateMessageCount", () => {
  it("returns null when under limit", () => {
    expect(validateMessageCount([1, 2, 3], 10)).toBeNull();
  });

  it("returns 400 when over limit", async () => {
    const messages = Array.from({ length: 55 }, (_, i) => i);
    const res = validateMessageCount(messages, 50);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.code).toBe("TOO_MANY_MESSAGES");
  });
});

describe("validateSegmentCount", () => {
  it("returns null when under limit", () => {
    expect(validateSegmentCount([1, 2], 100)).toBeNull();
  });

  it("returns 400 when over limit", async () => {
    const segments = Array.from({ length: 110 }, (_, i) => i);
    const res = validateSegmentCount(segments, 100);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const json = await res!.json();
    expect(json.code).toBe("TOO_MANY_SEGMENTS");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Reset rate limit state by using a unique IP per test
  });

  it("allows requests within limit", () => {
    const ip = `test-ip-${Date.now()}-1`;
    expect(checkRateLimit(ip, 5)).toBeNull();
    expect(checkRateLimit(ip, 5)).toBeNull();
  });

  it("blocks requests exceeding limit", async () => {
    const ip = `test-ip-${Date.now()}-2`;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(ip, 3)).toBeNull();
    }
    const res = checkRateLimit(ip, 3);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    const json = await res!.json();
    expect(json.code).toBe("RATE_LIMITED");
  });
});

describe("getClientIp", () => {
  it("extracts from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("extracts from x-real-ip", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("returns 'unknown' when no header", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("checkMonthlyCostLimit", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns null when limit is 0 (no limit)", async () => {
    const res = await checkMonthlyCostLimit(0);
    expect(res).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns null when limit is negative", async () => {
    const res = await checkMonthlyCostLimit(-5);
    expect(res).toBeNull();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns null when cost is within limit", async () => {
    mockFindMany.mockResolvedValueOnce([
      { details: JSON.stringify({ costUsd: 3.0, model: "gpt-4.1-mini", inputTokens: 100, outputTokens: 50 }) },
      { details: JSON.stringify({ costUsd: 2.0, model: "gpt-4.1-mini", inputTokens: 100, outputTokens: 50 }) },
    ]);
    const res = await checkMonthlyCostLimit(10);
    expect(res).toBeNull();
  });

  it("returns 429 when cost exceeds limit", async () => {
    mockFindMany.mockResolvedValueOnce([
      { details: JSON.stringify({ costUsd: 8.0, model: "gpt-4.1-mini", inputTokens: 100, outputTokens: 50 }) },
      { details: JSON.stringify({ costUsd: 5.0, model: "gpt-4.1-mini", inputTokens: 100, outputTokens: 50 }) },
    ]);
    const res = await checkMonthlyCostLimit(10);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    const json = await res!.json();
    expect(json.code).toBe("MONTHLY_COST_LIMIT_EXCEEDED");
  });

  it("returns 429 when cost equals limit exactly", async () => {
    mockFindMany.mockResolvedValueOnce([
      { details: JSON.stringify({ costUsd: 10.0, model: "gpt-4.1-mini", inputTokens: 100, outputTokens: 50 }) },
    ]);
    const res = await checkMonthlyCostLimit(10);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it("fails open on DB error (returns null)", async () => {
    mockFindMany.mockRejectedValueOnce(new Error("DB down"));
    const res = await checkMonthlyCostLimit(10);
    expect(res).toBeNull();
  });
});
