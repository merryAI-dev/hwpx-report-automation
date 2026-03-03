import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadPreferences,
  savePreferences,
  getPreferredModel,
  getCostLimit,
  checkCostLimit,
} from "./preferences";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

describe("preferences", () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
  });

  describe("loadPreferences", () => {
    it("returns defaults when localStorage is empty", () => {
      const prefs = loadPreferences();
      expect(prefs.anthropicModel).toBe("");
      expect(prefs.openaiModel).toBe("");
      expect(prefs.monthlyCostLimitUsd).toBe(0);
    });

    it("loads saved preferences from localStorage", () => {
      store["hwpx-editor-preferences"] = JSON.stringify({
        anthropicModel: "claude-sonnet-4-20250514",
        openaiModel: "gpt-4.1",
        monthlyCostLimitUsd: 50,
      });

      const prefs = loadPreferences();
      expect(prefs.anthropicModel).toBe("claude-sonnet-4-20250514");
      expect(prefs.openaiModel).toBe("gpt-4.1");
      expect(prefs.monthlyCostLimitUsd).toBe(50);
    });

    it("merges partial saved data with defaults", () => {
      store["hwpx-editor-preferences"] = JSON.stringify({ anthropicModel: "custom" });

      const prefs = loadPreferences();
      expect(prefs.anthropicModel).toBe("custom");
      expect(prefs.openaiModel).toBe("");
      expect(prefs.monthlyCostLimitUsd).toBe(0);
    });

    it("returns defaults on malformed JSON", () => {
      store["hwpx-editor-preferences"] = "not-json";

      const prefs = loadPreferences();
      expect(prefs.anthropicModel).toBe("");
    });
  });

  describe("savePreferences", () => {
    it("saves and returns merged preferences", () => {
      const result = savePreferences({ anthropicModel: "new-model" });
      expect(result.anthropicModel).toBe("new-model");
      expect(result.openaiModel).toBe("");

      const stored = JSON.parse(store["hwpx-editor-preferences"]);
      expect(stored.anthropicModel).toBe("new-model");
    });

    it("merges with existing preferences", () => {
      savePreferences({ anthropicModel: "model-a" });
      const result = savePreferences({ openaiModel: "model-b" });

      expect(result.anthropicModel).toBe("model-a");
      expect(result.openaiModel).toBe("model-b");
    });

    it("handles localStorage write failure gracefully", () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });

      // Should not throw
      const result = savePreferences({ anthropicModel: "test" });
      expect(result.anthropicModel).toBe("test");
    });
  });

  describe("getPreferredModel", () => {
    it("returns anthropic model", () => {
      savePreferences({ anthropicModel: "claude-model" });
      expect(getPreferredModel("anthropic")).toBe("claude-model");
    });

    it("returns openai model", () => {
      savePreferences({ openaiModel: "gpt-model" });
      expect(getPreferredModel("openai")).toBe("gpt-model");
    });

    it("returns empty string when not set", () => {
      expect(getPreferredModel("anthropic")).toBe("");
      expect(getPreferredModel("openai")).toBe("");
    });
  });

  describe("getCostLimit", () => {
    it("returns 0 when not set", () => {
      expect(getCostLimit()).toBe(0);
    });

    it("returns saved cost limit", () => {
      savePreferences({ monthlyCostLimitUsd: 25 });
      expect(getCostLimit()).toBe(25);
    });
  });
});

describe("checkCostLimit", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageMock.clear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns null when no limit is set (0)", async () => {
    savePreferences({ monthlyCostLimitUsd: 0 });
    const result = await checkCostLimit();
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when cost is within limit", async () => {
    savePreferences({ monthlyCostLimitUsd: 100 });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ monthly: { totalCostUsd: 50 } }), { status: 200 }),
    );

    const result = await checkCostLimit();
    expect(result).toBeNull();
  });

  it("returns error message when cost exceeds limit", async () => {
    savePreferences({ monthlyCostLimitUsd: 10 });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ monthly: { totalCostUsd: 15.5 } }), { status: 200 }),
    );

    const result = await checkCostLimit();
    expect(result).not.toBeNull();
    expect(result).toContain("$10");
    expect(result).toContain("15.5");
  });

  it("returns null when API call fails (non-200)", async () => {
    savePreferences({ monthlyCostLimitUsd: 10 });
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }));

    const result = await checkCostLimit();
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    savePreferences({ monthlyCostLimitUsd: 10 });
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const result = await checkCostLimit();
    expect(result).toBeNull();
  });

  it("returns error message when cost equals limit exactly", async () => {
    savePreferences({ monthlyCostLimitUsd: 25 });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ monthly: { totalCostUsd: 25 } }), { status: 200 }),
    );

    const result = await checkCostLimit();
    expect(result).not.toBeNull();
  });
});
