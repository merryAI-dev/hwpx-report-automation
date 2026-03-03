import { describe, it, expect } from "vitest";
import { DOCUMENT_TEMPLATES } from "./document-templates";
import { INSTRUCTION_PRESETS } from "./ai-presets";

describe("document-templates", () => {
  it("has at least 3 templates", () => {
    expect(DOCUMENT_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("all templates have unique IDs", () => {
    const ids = DOCUMENT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates reference valid AI presets", () => {
    const presetKeys = new Set(INSTRUCTION_PRESETS.map((p) => p.key));
    for (const tpl of DOCUMENT_TEMPLATES) {
      expect(presetKeys.has(tpl.defaultPreset)).toBe(true);
    }
  });

  it("all templates have non-empty starter content", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      expect(tpl.starterContent.length).toBeGreaterThan(0);
      expect(tpl.name).toBeTruthy();
      expect(tpl.description).toBeTruthy();
      expect(tpl.icon).toBeTruthy();
    }
  });

  it("each template has at least one heading in starter content", () => {
    for (const tpl of DOCUMENT_TEMPLATES) {
      const hasHeading = tpl.starterContent.some(
        (n) => n.type === "heading",
      );
      // Official letter may not have heading, that's fine
      if (tpl.category !== "official") {
        expect(hasHeading).toBe(true);
      }
    }
  });
});
