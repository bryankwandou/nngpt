export type ModelId =
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.3-codex"
  | "gpt-5.4-mini"
  | "gpt-5.2";

export interface ModelInfo {
  id: ModelId;
  label: string;
  description: string;
}

export const MODELS: ModelInfo[] = [
  { id: "gpt-5.5", label: "GPT-5.5", description: "Most capable, best for complex reasoning" },
  { id: "gpt-5.4", label: "GPT-5.4", description: "Balanced performance and speed" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Specialized for code generation" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "Fast and lightweight" },
  { id: "gpt-5.2", label: "GPT-5.2", description: "Legacy general-purpose" },
];

export const DEFAULT_MODEL: ModelId = "gpt-5.4";
