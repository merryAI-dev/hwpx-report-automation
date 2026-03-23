/**
 * Client-side user preferences stored in localStorage.
 */

const STORAGE_KEY = "hwpx-studio-preferences";

export type UserPreferences = {
  anthropicModel: string;
  openaiModel: string;
  monthlyCostLimitUsd: number;
};

const DEFAULTS: UserPreferences = {
  anthropicModel: "",
  openaiModel: "",
  monthlyCostLimitUsd: 0, // 0 = no limit
};

export function loadPreferences(): UserPreferences {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
  const current = loadPreferences();
  const merged = { ...current, ...prefs };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage full or unavailable
  }
  return merged;
}

export function getPreferredModel(provider: "anthropic" | "openai"): string {
  const prefs = loadPreferences();
  return provider === "anthropic" ? prefs.anthropicModel : prefs.openaiModel;
}

/** Get the monthly cost limit for sending in API request bodies. */
export function getCostLimit(): number {
  return loadPreferences().monthlyCostLimitUsd;
}

/**
 * Check if the monthly cost limit is exceeded.
 * Fetches /api/dashboard/costs and compares against the user's limit.
 * Returns null if within limit (or no limit set), or an error message if exceeded.
 */
export async function checkCostLimit(): Promise<string | null> {
  const prefs = loadPreferences();
  if (prefs.monthlyCostLimitUsd <= 0) return null;

  try {
    const resp = await fetch("/api/dashboard/costs");
    if (!resp.ok) return null; // can't check → allow
    const data = await resp.json();
    const monthlyCost = data?.monthly?.totalCostUsd ?? 0;
    if (monthlyCost >= prefs.monthlyCostLimitUsd) {
      return `월간 비용 한도($${prefs.monthlyCostLimitUsd})를 초과했습니다. (현재: $${monthlyCost.toFixed(4)}) 설정에서 한도를 조정하세요.`;
    }
    return null;
  } catch {
    return null; // network error → allow
  }
}
