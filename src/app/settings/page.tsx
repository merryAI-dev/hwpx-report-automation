"use client";

import { useEffect, useState } from "react";
import { toast } from "@/store/toast-store";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { loadPreferences, savePreferences } from "@/lib/preferences";
import {
  getStoredApiKey,
  setStoredApiKey,
  hasStoredApiKey,
  type ApiProvider,
} from "@/lib/client-api-keys";

const MODEL_OPTIONS = {
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-haiku-4-20250414", label: "Claude Haiku 4 (빠름)" },
  ],
  openai: [
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini (기본)" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4o", label: "GPT-4o" },
  ],
};

export default function SettingsPage() {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [anthropicConfigured, setAnthropicConfigured] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [anthropicModel, setAnthropicModel] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [costLimit, setCostLimit] = useState(0);

  // Load preferences and key statuses from localStorage on mount
  useEffect(() => {
    const prefs = loadPreferences();
    setAnthropicModel(prefs.anthropicModel);
    setOpenaiModel(prefs.openaiModel);
    setCostLimit(prefs.monthlyCostLimitUsd);
    setAnthropicConfigured(hasStoredApiKey("anthropic"));
    setOpenaiConfigured(hasStoredApiKey("openai"));
    setGeminiConfigured(hasStoredApiKey("gemini"));
  }, []);

  const PROVIDER_LABEL: Record<ApiProvider, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
  };

  const isConfigured = (provider: ApiProvider) =>
    provider === "anthropic" ? anthropicConfigured
    : provider === "openai" ? openaiConfigured
    : geminiConfigured;

  const handleSaveKey = (provider: ApiProvider, key: string) => {
    if (!key.trim()) {
      toast.warning("API 키를 입력하세요.");
      return;
    }
    setStoredApiKey(provider, key.trim());
    toast.success(`${PROVIDER_LABEL[provider]} API 키가 저장되었습니다.`);
    if (provider === "anthropic") { setAnthropicConfigured(true); setAnthropicKey(""); }
    else if (provider === "openai") { setOpenaiConfigured(true); setOpenaiKey(""); }
    else { setGeminiConfigured(true); setGeminiKey(""); }
  };

  const handleDeleteKey = (provider: ApiProvider) => {
    setStoredApiKey(provider, "");
    toast.success(`${PROVIDER_LABEL[provider]} API 키가 삭제되었습니다.`);
    if (provider === "anthropic") setAnthropicConfigured(false);
    else if (provider === "openai") setOpenaiConfigured(false);
    else setGeminiConfigured(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "설정" }]} />
          <h1 className="text-xl font-bold text-gray-900">설정</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI 모델, API 키, 기본 프리셋을 관리합니다.
          </p>
        </div>

        {/* API Key Configuration */}
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            API 키 설정
          </h2>
          <p className="mb-4 text-xs text-gray-500">
            API 키는 이 브라우저의 로컬 스토리지에만 저장되며 서버로 전송되지 않습니다.
          </p>
          <div className="space-y-4">
            {/* Anthropic */}
            <div className="rounded-md border border-gray-100 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Anthropic (Claude) — 채팅 AI
                </span>
                <div className="flex items-center gap-2">
                  {isConfigured("anthropic") && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      설정됨
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={isConfigured("anthropic") ? "새 키로 교체..." : "sk-ant-..."}
                  className="flex-1 rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveKey("anthropic", anthropicKey); }}
                />
                <button
                  type="button"
                  onClick={() => handleSaveKey("anthropic", anthropicKey)}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  저장
                </button>
                {isConfigured("anthropic") && (
                  <button
                    type="button"
                    onClick={() => handleDeleteKey("anthropic")}
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            {/* OpenAI */}
            <div className="rounded-md border border-gray-100 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  OpenAI (GPT) — 제안/검증 AI
                </span>
                <div className="flex items-center gap-2">
                  {isConfigured("openai") && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      설정됨
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={isConfigured("openai") ? "새 키로 교체..." : "sk-..."}
                  className="flex-1 rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveKey("openai", openaiKey); }}
                />
                <button
                  type="button"
                  onClick={() => handleSaveKey("openai", openaiKey)}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  저장
                </button>
                {isConfigured("openai") && (
                  <button
                    type="button"
                    onClick={() => handleDeleteKey("openai")}
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>

            {/* Gemini */}
            <div className="rounded-md border border-blue-50 bg-blue-50/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Google Gemini — 제안/검증 AI
                  <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">OpenAI 대체 가능</span>
                </span>
                <div className="flex items-center gap-2">
                  {isConfigured("gemini") && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      설정됨
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={isConfigured("gemini") ? "새 키로 교체..." : "AIza..."}
                  className="flex-1 rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveKey("gemini", geminiKey); }}
                />
                <button
                  type="button"
                  onClick={() => handleSaveKey("gemini", geminiKey)}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  저장
                </button>
                {isConfigured("gemini") && (
                  <button
                    type="button"
                    onClick={() => handleDeleteKey("gemini")}
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    삭제
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Gemini 키가 있으면 OpenAI 대신 자동으로 사용됩니다. 기본 모델: gemini-2.0-flash
              </p>
            </div>
          </div>
        </section>

        {/* Model Selection */}
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            AI 모델 설정
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                채팅 모델 (Anthropic)
              </label>
              <select
                value={anthropicModel}
                onChange={(e) => {
                  setAnthropicModel(e.target.value);
                  savePreferences({ anthropicModel: e.target.value });
                  toast.success("채팅 모델이 변경되었습니다.");
                }}
                className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">기본값 (서버 환경변수)</option>
                {MODEL_OPTIONS.anthropic.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                비어있으면 서버 환경변수 ANTHROPIC_MODEL 사용
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                제안/검증 모델 (OpenAI)
              </label>
              <select
                value={openaiModel}
                onChange={(e) => {
                  setOpenaiModel(e.target.value);
                  savePreferences({ openaiModel: e.target.value });
                  toast.success("제안/검증 모델이 변경되었습니다.");
                }}
                className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">기본값 (서버 환경변수)</option>
                {MODEL_OPTIONS.openai.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                비어있으면 서버 환경변수 OPENAI_MODEL 사용
              </p>
            </div>
            {/* Monthly Cost Limit */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                월간 비용 한도 (USD)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={costLimit}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value) || 0);
                    setCostLimit(val);
                    savePreferences({ monthlyCostLimitUsd: val });
                  }}
                  className="w-32 rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {costLimit > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCostLimit(0);
                      savePreferences({ monthlyCostLimitUsd: 0 });
                      toast.success("비용 한도가 해제되었습니다.");
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    해제
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {costLimit > 0
                  ? `월 $${costLimit} 초과 시 AI 기능이 차단됩니다.`
                  : "0 = 제한 없음"}
              </p>
            </div>
          </div>
        </section>

        {/* Instruction Presets */}
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            AI 지시 프리셋
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            문서 유형별 AI 지시 프리셋입니다. 편집기에서 문서를 불러오면 문서
            유형에 맞는 프리셋이 자동으로 선택됩니다.
          </p>
          <div className="space-y-3">
            {INSTRUCTION_PRESETS.filter((p) => p.key !== "custom").map(
              (preset) => (
                <div
                  key={preset.key}
                  className="rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="mb-1 text-sm font-medium text-gray-800">
                    {preset.label}
                  </div>
                  <p className="text-xs leading-relaxed text-gray-600">
                    {preset.instruction}
                  </p>
                </div>
              ),
            )}
          </div>
        </section>

        {/* System Info */}
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            시스템 정보
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-gray-500">버전</dt>
            <dd className="text-gray-900">1.0.0</dd>
            <dt className="text-gray-500">프레임워크</dt>
            <dd className="text-gray-900">Next.js 15 + TipTap v3</dd>
            <dt className="text-gray-500">AI 엔진</dt>
            <dd className="text-gray-900">Anthropic Claude + OpenAI GPT</dd>
            <dt className="text-gray-500">문서 형식</dt>
            <dd className="text-gray-900">HWPX, DOCX, PPTX</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
