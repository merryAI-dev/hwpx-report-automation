import { describe, expect, it, vi } from "vitest";
import { getSlashCommandItems } from "./slash-commands";

describe("getSlashCommandItems", () => {
  it("filters commands by query", () => {
    const items = getSlashCommandItems("", {
      onAiCommand: vi.fn(),
    });
    expect(items.length).toBeGreaterThanOrEqual(3);

    const filtered = getSlashCommandItems("표", {
      onAiCommand: vi.fn(),
    });
    expect(filtered.some((item) => item.title.includes("표"))).toBe(true);
    expect(
      filtered.every((item) => {
        const bucket = `${item.title} ${item.description} ${item.keywords.join(" ")}`;
        return bucket.includes("표");
      }),
    ).toBe(true);
  });
});
