import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("/api/health", () => {
  it("returns a health response with timestamp and checks", async () => {
    const res = await GET();
    // In test environments without API keys, the status may be "degraded" (503).
    // We only assert the shape of the response, not the exact ok/degraded result.
    expect([200, 503]).toContain(res.status);

    const json = await res.json();
    expect(["ok", "degraded"]).toContain(json.status);
    expect(json.timestamp).toBeDefined();
    expect(() => new Date(json.timestamp)).not.toThrow();
    expect(json.checks).toBeDefined();
    expect(json.checks.storage).toBeDefined();
    expect(json.checks.ai).toBeDefined();
  });

  it("returns version string", async () => {
    const res = await GET();
    const json = await res.json();
    expect(typeof json.version).toBe("string");
  });
});
