/**
 * OpenAI-compatible client factory.
 * Supports OpenAI and Google Gemini (via OpenAI-compatible endpoint).
 *
 * Priority: Gemini key header → OpenAI key header → env vars
 */
import OpenAI from "openai";
import { ApiKeyError } from "@/lib/errors";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

export type OpenAIClient = {
  client: OpenAI;
  defaultModel: string;
  provider: "openai" | "gemini";
};

/**
 * Returns an OpenAI-compatible client based on available API keys in the request.
 * Gemini takes priority when its key is present.
 */
export function getOpenAIClientFromRequest(request: Request): OpenAIClient {
  const geminiKey = request.headers.get("x-gemini-api-key");
  if (geminiKey) {
    return {
      client: new OpenAI({ apiKey: geminiKey, baseURL: GEMINI_BASE_URL }),
      defaultModel: GEMINI_DEFAULT_MODEL,
      provider: "gemini",
    };
  }

  const openaiKey = request.headers.get("x-openai-api-key") || process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    // Return a client that will fail with a meaningful error when used
    return {
      client: new OpenAI({ apiKey: "missing" }),
      defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      provider: "openai",
    };
  }

  return {
    client: new OpenAI({
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    }),
    defaultModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    provider: "openai",
  };
}

/**
 * Throws ApiKeyError if no OpenAI-compatible key is available.
 */
export function requireOpenAIClientFromRequest(request: Request): OpenAIClient {
  const result = getOpenAIClientFromRequest(request);
  if (result.client.apiKey === "missing") {
    throw new ApiKeyError("OpenAI");
  }
  return result;
}
