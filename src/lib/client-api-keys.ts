/**
 * Client-side API key storage (localStorage).
 * Keys are stored per-provider and sent as request headers to API routes.
 */

export type ApiProvider = "anthropic" | "openai" | "gemini";

const STORAGE_KEY = (provider: ApiProvider) => `hwpx_api_key_${provider}`;

export function getStoredApiKey(provider: ApiProvider): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY(provider)) ?? "";
}

export function setStoredApiKey(provider: ApiProvider, key: string): void {
  if (typeof window === "undefined") return;
  if (key.trim()) {
    localStorage.setItem(STORAGE_KEY(provider), key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY(provider));
  }
}

export function hasStoredApiKey(provider: ApiProvider): boolean {
  return !!getStoredApiKey(provider);
}

/** Returns headers to attach to AI API requests. */
export function getApiKeyHeaders(): Record<string, string> {
  const anthropic = getStoredApiKey("anthropic");
  const openai = getStoredApiKey("openai");
  const gemini = getStoredApiKey("gemini");
  return {
    ...(anthropic ? { "X-Anthropic-Api-Key": anthropic } : {}),
    ...(openai ? { "X-OpenAI-Api-Key": openai } : {}),
    ...(gemini ? { "X-Gemini-Api-Key": gemini } : {}),
  };
}
