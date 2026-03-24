// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-validation", () => ({
  checkRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/hwpx", () => ({
  inspectHwpx: vi.fn(),
}));

import { POST } from "./route";
import { checkRateLimit } from "@/lib/api-validation";
import { inspectHwpx } from "@/lib/hwpx";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockInspectHwpx = vi.mocked(inspectHwpx);

function makeRequest(file?: File): NextRequest {
  const formData = new FormData();
  if (file) formData.append("file", file);
  return new NextRequest("http://localhost/api/public/extract", {
    method: "POST",
    body: formData,
  });
}

const STUB_INSPECT_RESULT = {
  textNodes: [
    { fileName: "Contents/section0.xml", textIndex: 0, text: "제목 입력" },
    { fileName: "Contents/section0.xml", textIndex: 3, text: "홍길동" },
  ],
  styleCatalog: {},
  integrityIssues: [],
} as unknown as Awaited<ReturnType<typeof inspectHwpx>>;

describe("POST /api/public/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(null);
    mockInspectHwpx.mockResolvedValue(STUB_INSPECT_RESULT);
  });

  it("returns nodes array with correct shape on valid request", async () => {
    const file = new File([new Uint8Array([80, 75, 3, 4])], "doc.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    expect(json.nodes).toHaveLength(2);
    expect(json.nodes[0]).toEqual({
      file: "Contents/section0.xml",
      index: 0,
      text: "제목 입력",
    });
    expect(json.nodes[1]).toEqual({
      file: "Contents/section0.xml",
      index: 3,
      text: "홍길동",
    });
  });

  it("returns empty nodes array for document with no text", async () => {
    mockInspectHwpx.mockResolvedValue({
      textNodes: [],
      styleCatalog: {},
      integrityIssues: [],
    } as unknown as Awaited<ReturnType<typeof inspectHwpx>>);

    const file = new File([new Uint8Array([80, 75, 3, 4])], "empty.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nodes).toEqual([]);
    expect(json.count).toBe(0);
  });

  it("returns 429 when rate limit exceeded", async () => {
    const { NextResponse } = await import("next/server");
    mockCheckRateLimit.mockReturnValue(
      NextResponse.json({ error: "RATE_LIMITED", message: "요청 한도 초과. 잠시 후 재시도하세요." }, { status: 429 }),
    );

    const file = new File([new Uint8Array([1, 2, 3])], "doc.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("RATE_LIMITED");
  });

  it("returns 400 FILE_MISSING when file field is absent", async () => {
    const req = makeRequest(undefined);

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("FILE_MISSING");
  });

  it("returns 413 FILE_TOO_LARGE when file exceeds 10MB", async () => {
    const file = new File([new ArrayBuffer(11 * 1024 * 1024)], "big.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("FILE_TOO_LARGE");
  });

  it("returns 400 INVALID_HWPX when inspectHwpx throws", async () => {
    mockInspectHwpx.mockRejectedValue(new Error("invalid zip"));
    const file = new File([new Uint8Array([0, 0, 0])], "broken.hwpx");
    const req = makeRequest(file);

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("INVALID_HWPX");
  });

  it("error responses include error code and Korean message", async () => {
    const req = makeRequest(undefined);

    const res = await POST(req);
    const json = await res.json();

    expect(json).toHaveProperty("error");
    expect(json).toHaveProperty("message");
    expect(typeof json.message).toBe("string");
  });
});
