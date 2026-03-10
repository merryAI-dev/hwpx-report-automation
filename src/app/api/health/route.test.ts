import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("/api/health", () => {
  it("returns status ok with timestamp", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.timestamp).toBeDefined();
    expect(() => new Date(json.timestamp)).not.toThrow();
  });

  it("returns version string", async () => {
    const res = await GET();
    const json = await res.json();
    expect(typeof json.version).toBe("string");
  });
});
