// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-validation")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() => null),
    getClientIp: vi.fn(() => "127.0.0.1"),
  };
});

vi.mock("@/lib/hwpx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hwpx")>();
  return { ...actual, applyPlaceholders: vi.fn() };
});

import { POST } from "./route";
import { checkRateLimit } from "@/lib/api-validation";
import { applyPlaceholders } from "@/lib/hwpx";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockApplyPlaceholders = vi.mocked(applyPlaceholders);

function makeValidHwpxBuffer(): ArrayBuffer {
  // Minimal valid bytes (not real HWPX, but non-empty)
  return new Uint8Array([80, 75, 3, 4]).buffer;
}

function makeRequest(
  file?: File,
  data?: string,
): NextRequest {
  const formData = new FormData();
  if (file) formData.append("file", file);
  if (data !== undefined) formData.append("data", data);
  return new NextRequest("http://localhost/api/public/fill", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/public/fill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(null);
    mockApplyPlaceholders.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])]));
  });

  it("returns 200 with octet-stream on valid request", async () => {
    const file = new File([makeValidHwpxBuffer()], "template.hwpx", {
      type: "application/octet-stream",
    });
    const req = makeRequest(file, JSON.stringify({ TITLE: "테스트" }));

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("output.hwpx");
    expect(mockApplyPlaceholders).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      { TITLE: "테스트" },
    );
  });

  it("returns 200 when data field is omitted (empty placeholders)", async () => {
    const file = new File([makeValidHwpxBuffer()], "template.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockApplyPlaceholders).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      {},
    );
  });

  it("returns 429 when rate limit exceeded", async () => {
    const { NextResponse } = await import("next/server");
    mockCheckRateLimit.mockReturnValue(
      NextResponse.json({ error: "RATE_LIMITED", message: "요청 한도 초과. 잠시 후 재시도하세요." }, { status: 429 }),
    );

    const file = new File([makeValidHwpxBuffer()], "template.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("RATE_LIMITED");
  });

  it("returns 400 FILE_MISSING when file field is absent", async () => {
    const req = makeRequest(undefined, "{}");

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("FILE_MISSING");
  });

  it("returns 413 FILE_TOO_LARGE when file exceeds 10MB", async () => {
    const bigBuffer = new ArrayBuffer(11 * 1024 * 1024);
    const file = new File([bigBuffer], "big.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("FILE_TOO_LARGE");
  });

  it("returns 400 INVALID_HWPX when applyPlaceholders throws", async () => {
    mockApplyPlaceholders.mockRejectedValue(new Error("bad zip"));
    const file = new File([new Uint8Array([0, 0, 0])], "broken.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_HWPX");
  });

  it("returns 400 INVALID_DATA when data is not valid JSON", async () => {
    const file = new File([makeValidHwpxBuffer()], "template.hwpx");
    const req = makeRequest(file, "not-json");

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_DATA");
  });

  it("returns 400 INVALID_DATA when data contains non-string values", async () => {
    const file = new File([makeValidHwpxBuffer()], "template.hwpx");
    const req = makeRequest(file, JSON.stringify({ TITLE: 123, AUTHOR: "홍길동" }));

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_DATA");
  });

  it("returns 400 INVALID_DATA when data is a JSON array", async () => {
    const file = new File([makeValidHwpxBuffer()], "template.hwpx");
    const req = makeRequest(file, JSON.stringify(["TITLE", "테스트"]));

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_DATA");
  });

  it("error responses include message field in Korean", async () => {
    const req = makeRequest(undefined);

    const res = await POST(req);
    const json = await res.json();

    expect(json).toHaveProperty("error");
    expect(json).toHaveProperty("message");
    expect(typeof json.message).toBe("string");
  });
});
