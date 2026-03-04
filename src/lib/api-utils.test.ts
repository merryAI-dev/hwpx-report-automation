import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { email: "test@example.com" } }),
}));

vi.mock("./api-keys", () => ({
  getApiKey: vi.fn().mockResolvedValue("test-key"),
}));

import { requireString, requireApiKey, withTimeout, handleApiError } from "./api-utils";

describe("requireString", () => {
  it("returns trimmed string when valid", () => {
    expect(requireString("  hello  ", "name")).toBe("hello");
  });

  it("throws ValidationError for empty string", () => {
    expect(() => requireString("", "name")).toThrow("name");
  });

  it("throws ValidationError for non-string", () => {
    expect(() => requireString(undefined, "field")).toThrow("field");
    expect(() => requireString(null, "field")).toThrow("field");
    expect(() => requireString(123, "field")).toThrow("field");
  });
});

describe("requireApiKey", () => {
  it("returns key when env var exists", () => {
    process.env.TEST_API_KEY_UTILS = "my-key";
    expect(requireApiKey("TEST_API_KEY_UTILS", "TestProvider")).toBe("my-key");
    delete process.env.TEST_API_KEY_UTILS;
  });

  it("throws ApiKeyError when env var missing", () => {
    delete process.env.NONEXISTENT_KEY;
    expect(() => requireApiKey("NONEXISTENT_KEY", "TestProvider")).toThrow("TestProvider");
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("done"),
      5000,
      "test-op",
    );
    expect(result).toBe("done");
  });

  it("rejects when promise exceeds timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 10000));
    await expect(
      withTimeout(slow, 50, "slow-op"),
    ).rejects.toThrow("시간 초과");
  });

  it("passes through promise rejection", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("original error")), 5000, "op"),
    ).rejects.toThrow("original error");
  });
});

describe("handleApiError", () => {
  it("returns JSON response with error info", async () => {
    const res = handleApiError(new Error("something broke"), "/api/test");
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("something broke");
  });
});
