"use client";

import { useEffect, useState } from "react";
import { toast } from "@/store/toast-store";
import { INSTRUCTION_PRESETS } from "@/lib/editor/ai-presets";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { loadPreferences, savePreferences } from "@/lib/preferences";

type KeyStatus = { provider: string; configured: boolean };

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
  const [saving, setSaving] = useState(false);
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [anthropicModel, setAnthropicModel] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [costLimit, setCostLimit] = useState(0);

  // Load preferences and key statuses on mount
  useEffect(() => {
    const prefs = loadPreferences();
    setAnthropicModel(prefs.anthropicModel);
    setOpenaiModel(prefs.openaiModel);
    setCostLimit(prefs.monthlyCostLimitUsd);

    fetch("/api/settings/api-keys")
      .then(async (resp) => {
        if (resp.ok) {
          const data = await resp.json();
          setKeyStatuses(data.keys ?? []);
        }
      })
      .catch(() => {
        // Silently fail — may not have DB configured
      })
      .finally(() => setKeysLoading(false));
  }, []);

  const isConfigured = (provider: string) =>
    keyStatuses.find((k) => k.provider === provider)?.configured ?? false;

  const handleSaveKey = async (provider: string, key: string) => {
    if (!key.trim()) {
      toast.warning("API 키를 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const resp = await fetch("/api/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: key }),
      });
      if (resp.ok) {
        toast.success(`${provider === "anthropic" ? "Anthropic" : "OpenAI"} API 키가 저장되었습니다.`);
        // Refresh status
        setKeyStatuses((prev) =>
          prev.map((k) => (k.provider === provider ? { ...k, configured: true } : k)),
        );
        if (provider === "anthropic") setAnthropicKey("");
        else setOpenaiKey("");
      } else {
        const data = await resp.json();
        toast.error(data.error || "API 키 저장 실패");
      }
    } catch {
      toast.error("서버 연결 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    setSaving(true);
    try {
      const resp = await fetch(`/api/settings/api-keys?provider=${provider}`, {
        method: "DELETE",
      });
      if (resp.ok) {
        toast.success(`${provider === "anthropic" ? "Anthropic" : "OpenAI"} API 키가 삭제되었습니다.`);
        setKeyStatuses((prev) =>
          prev.map((k) => (k.provider === provider ? { ...k, configured: false } : k)),
        );
      } else {
        const data = await resp.json();
        toast.error(data.error || "API 키 삭제 실패");
      }
    } catch {
      toast.error("서버 연결 실패");
    } finally {
      setSaving(false);
    }
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
          <div className="space-y-4">
            {keysLoading ? (
              <div className="flex flex-col gap-3">
                <div className="h-24 animate-pulse rounded-md bg-gray-100" />
                <div className="h-24 animate-pulse rounded-md bg-gray-100" />
              </div>
            ) : (<>
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
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    ANTHROPIC_API_KEY
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder={isConfigured("anthropic") ? "새 키로 교체..." : "sk-ant-..."}
                  className="flex-1 rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveKey("anthropic", anthropicKey)}
                  disabled={saving}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  저장
                </button>
                {isConfigured("anthropic") && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteKey("anthropic")}
                    disabled={saving}
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
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
                  <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    OPENAI_API_KEY
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={isConfigured("openai") ? "새 키로 교체..." : "sk-..."}
                  className="flex-1 rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveKey("openai", openaiKey)}
                  disabled={saving}
                  className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  저장
                </button>
                {isConfigured("openai") && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteKey("openai")}
                    disabled={saving}
                    className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    삭제
                  </button>
                )}
              </div>
            </div>
            </>)}
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
