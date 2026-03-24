// @vitest-environment node
import { describe, it, expect } from "vitest";

import { GET } from "./route";

describe("GET /api/public/health", () => {
  it("returns { status: 'ok', ts: ISO8601 }", async () => {
    const before = Date.now();
    const res = await GET();
    const after = Date.now();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(typeof json.ts).toBe("string");

    const ts = new Date(json.ts).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("ts field is a valid ISO 8601 datetime string", async () => {
    const res = await GET();
    const json = await res.json();

    expect(json.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
