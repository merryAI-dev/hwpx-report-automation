import { describe, it, expect } from "vitest";
import {
  AppError,
  ValidationError,
  ApiKeyError,
  ApiError,
  HwpxParseError,
  ExportError,
  TimeoutError,
  extractErrorMessage,
  toErrorResponse,
} from "./errors";

describe("Error classes", () => {
  it("AppError has correct defaults", () => {
    const err = new AppError("test");
    expect(err.message).toBe("test");
    expect(err.code).toBe("APP_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("AppError");
    expect(err).toBeInstanceOf(Error);
  });

  it("AppError accepts custom code, status, and context", () => {
    const err = new AppError("msg", "CUSTOM", 418, { key: "val" });
    expect(err.code).toBe("CUSTOM");
    expect(err.statusCode).toBe(418);
    expect(err.context).toEqual({ key: "val" });
  });

  it("ValidationError sets 400 status", () => {
    const err = new ValidationError("bad input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.name).toBe("ValidationError");
    expect(err).toBeInstanceOf(AppError);
  });

  it("ApiKeyError formats provider message", () => {
    const err = new ApiKeyError("OpenAI");
    expect(err.message).toContain("OpenAI");
    expect(err.code).toBe("API_KEY_MISSING");
    expect(err.statusCode).toBe(500);
  });

  it("ApiError sets 502 status", () => {
    const err = new ApiError("upstream failed");
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe("API_ERROR");
  });

  it("HwpxParseError sets 422 status", () => {
    const err = new HwpxParseError("bad format");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("HWPX_PARSE_ERROR");
  });

  it("ExportError sets 500 status", () => {
    const err = new ExportError("export failed");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("EXPORT_ERROR");
  });

  it("TimeoutError includes operation and limit", () => {
    const err = new TimeoutError("AI call", 30000);
    expect(err.message).toContain("30000ms");
    expect(err.message).toContain("AI call");
    expect(err.code).toBe("TIMEOUT");
    expect(err.statusCode).toBe(504);
  });
});

describe("extractErrorMessage", () => {
  it("extracts message from Error", () => {
    expect(extractErrorMessage(new Error("hello"))).toBe("hello");
  });

  it("returns string as-is", () => {
    expect(extractErrorMessage("a string")).toBe("a string");
  });

  it("returns fallback for non-error types", () => {
    expect(extractErrorMessage(42)).toBe("알 수 없는 오류");
    expect(extractErrorMessage(null, "custom fallback")).toBe("custom fallback");
  });
});

describe("toErrorResponse", () => {
  it("maps AppError to correct body and status", () => {
    const err = new ValidationError("bad field");
    const { body, status } = toErrorResponse(err);
    expect(status).toBe(400);
    expect(body.error).toBe("bad field");
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("maps unknown error to 500", () => {
    const { body, status } = toErrorResponse(new Error("oops"));
    expect(status).toBe(500);
    expect(body.error).toBe("oops");
    expect(body.code).toBeUndefined();
  });

  it("maps string error to 500", () => {
    const { body, status } = toErrorResponse("raw string");
    expect(status).toBe(500);
    expect(body.error).toBe("raw string");
  });
});
