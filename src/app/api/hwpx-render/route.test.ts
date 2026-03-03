// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    time: vi.fn(
      (_label: string, fn: () => Promise<unknown>, _meta?: unknown) => fn(),
    ),
  },
}));

vi.mock("@/lib/api-validation", () => ({
  checkRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/api-utils", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NextResponse } = require("next/server");
  return {
    withTimeout: vi.fn((promise: Promise<unknown>) => promise),
    handleApiError: vi.fn((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: msg }, { status: 500 });
    }),
  };
});

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeFormDataRequest(fileContent: Uint8Array, fileName = "test.hwpx"): NextRequest {
  const file = new File([fileContent], fileName, {
    type: "application/octet-stream",
  });
  const formData = new FormData();
  formData.append("file", file);

  return new NextRequest("http://localhost/api/hwpx-render", {
    method: "POST",
    body: formData,
  });
}

describe("/api/hwpx-render", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("proxies request to Java API and returns JSON", async () => {
    const responseData = { html: "<p>test</p>", elementMap: {}, outline: [] };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const req = makeFormDataRequest(new Uint8Array([1, 2, 3]));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.html).toBe("<p>test</p>");
  });

  it("returns error when file field is missing", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost/api/hwpx-render", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it("returns error when Java API returns non-ok status", async () => {
    mockFetch.mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const req = makeFormDataRequest(new Uint8Array([1, 2, 3]));
    const res = await POST(req);

    expect(res.status).toBe(500);
  });

  it("returns error when Java API returns invalid JSON", async () => {
    mockFetch.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const req = makeFormDataRequest(new Uint8Array([1, 2, 3]));
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
