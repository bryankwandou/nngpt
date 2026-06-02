export interface Profile {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  defaultModel: string;
}

export interface PresetTemplate {
  name: string;
  baseURL: string;
  models: string[];
  defaultModel: string;
}

export const PRESETS: PresetTemplate[] = [
  {
    name: "Jatevo Balancer",
    baseURL: "https://lb.jatevo.ai/v1",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5.4-mini", "gpt-5.2"],
    defaultModel: "gpt-5.4",
  },
  {
    name: "Jatevo Direct",
    baseURL: "https://jatevo.id/api/open/v1/inference",
    models: ["qwen3.5-plus", "qwen-plus", "qwen-max", "qwen-turbo"],
    defaultModel: "qwen3.5-plus",
  },
  {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"],
    defaultModel: "gpt-4o-mini",
  },
  {
    name: "Qwen (Alibaba Cloud)",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: [
      "qwen-max",
      "qwen-plus",
      "qwen-turbo",
      "qwen-long",
      "qwen2.5-72b-instruct",
      "qwen2.5-coder-32b-instruct",
      "qwq-plus",
    ],
    defaultModel: "qwen-plus",
  },
  {
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash-exp",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-chat",
    ],
    defaultModel: "openai/gpt-4o-mini",
  },
  {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
  {
    name: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    defaultModel: "mistral-small-latest",
  },
  {
    name: "Together AI",
    baseURL: "https://api.together.xyz/v1",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
    ],
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    name: "Custom",
    baseURL: "",
    models: [],
    defaultModel: "",
  },
];

export interface SettingsState {
  profiles: Profile[];
  activeId: string | null;
}

function settingsKey(accountId: string) {
  return `nngpt:settings:${accountId}:v1`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function defaultState(): SettingsState {
  const jatevo = PRESETS[0];
  const def: Profile = {
    id: uid(),
    name: "Jatevo Balancer (default)",
    baseURL: jatevo.baseURL,
    apiKey: "",
    models: [...jatevo.models],
    defaultModel: jatevo.defaultModel,
  };
  return { profiles: [def], activeId: def.id };
}

export function loadSettings(accountId: string): SettingsState {
  if (typeof window === "undefined") return { profiles: [], activeId: null };
  try {
    const raw = localStorage.getItem(settingsKey(accountId));
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as SettingsState;
    if (!parsed.profiles || !Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
      return defaultState();
    }
    if (!parsed.activeId || !parsed.profiles.find((p) => p.id === parsed.activeId)) {
      parsed.activeId = parsed.profiles[0].id;
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

export function saveSettings(accountId: string, s: SettingsState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(settingsKey(accountId), JSON.stringify(s));
  } catch {
    // ignore quota errors
  }
}

export function getActiveProfile(s: SettingsState): Profile | null {
  if (!s.activeId) return s.profiles[0] ?? null;
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0] ?? null;
}

// ── Server sync helpers (api keys never leave the client) ─────────

type ServerSettings = { profiles: Omit<Profile, "apiKey">[]; activeId: string | null };

/** Push current settings to server (strips API keys before sending). */
export async function syncSettingsToServer(
  accountId: string,
  sessionId: string,
  state: SettingsState
): Promise<void> {
  const stripped: ServerSettings = {
    activeId: state.activeId,
    profiles: state.profiles.map(({ apiKey: _k, ...rest }) => rest),
  };
  await fetch("/api/settings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionId}`,
    },
    body: JSON.stringify({ accountId, settings: stripped }),
  });
}

/** Fetch settings from server and merge with local (preserving local API keys). */
export async function fetchAndMergeSettings(
  accountId: string,
  sessionId: string,
  localState: SettingsState
): Promise<SettingsState> {
  try {
    const res = await fetch(`/api/settings?accountId=${accountId}`, {
      headers: { authorization: `Bearer ${sessionId}` },
    });
    if (!res.ok) return localState;
    const data = await res.json() as { settings?: ServerSettings | null };
    const server = data.settings;
    if (!server || !Array.isArray(server.profiles) || server.profiles.length === 0) {
      return localState;
    }

    // Build map of local profiles by id to preserve their apiKeys
    const localById = new Map(localState.profiles.map(p => [p.id, p]));

    const merged: Profile[] = server.profiles.map(sp => ({
      ...sp,
      apiKey: localById.get(sp.id)?.apiKey ?? "", // keep local key if exists
    }));

    // Ensure activeId is valid in merged list
    const activeId = merged.some(p => p.id === server.activeId)
      ? server.activeId
      : merged[0]?.id ?? null;

    return { profiles: merged, activeId };
  } catch {
    return localState;
  }
}
