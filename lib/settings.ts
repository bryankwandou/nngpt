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
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
    defaultModel: "gpt-4o-mini",
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

const STORAGE_KEY = "nngpt:settings:v1";

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

export function loadSettings(): SettingsState {
  if (typeof window === "undefined") return { profiles: [], activeId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

export function saveSettings(s: SettingsState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota errors
  }
}

export function getActiveProfile(s: SettingsState): Profile | null {
  if (!s.activeId) return s.profiles[0] ?? null;
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0] ?? null;
}
