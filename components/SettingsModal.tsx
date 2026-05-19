"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PRESETS,
  type Profile,
  type SettingsState,
  uid,
  loadSettings,
  saveSettings,
} from "@/lib/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  onChange: (next: SettingsState) => void;
  accountId: string;
}

type TestResult =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; modelCount?: number }
  | { state: "fail"; error: string };

export default function SettingsModal({ open, onClose, onChange, accountId }: Props) {
  const [state, setState] = useState<SettingsState>({ profiles: [], activeId: null });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestResult>({ state: "idle" });

  useEffect(() => {
    if (!open) return;
    const loaded = loadSettings(accountId);
    setState(loaded);
    setEditingId(loaded.activeId ?? loaded.profiles[0]?.id ?? null);
    setShowKey(false);
    setTest({ state: "idle" });
  }, [open]);

  // close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const commit = useCallback(
    (next: SettingsState) => {
      setState(next);
      saveSettings(accountId, next);
      onChange(next);
    },
    [onChange, accountId]
  );

  const editing = useMemo(
    () => state.profiles.find((p) => p.id === editingId) ?? null,
    [state, editingId]
  );

  const updateEditing = useCallback(
    (patch: Partial<Profile>) => {
      if (!editing) return;
      const updatedProfile = { ...editing, ...patch };
      // ensure defaultModel is in models list
      if (patch.models && !updatedProfile.models.includes(updatedProfile.defaultModel)) {
        updatedProfile.defaultModel = updatedProfile.models[0] ?? "";
      }
      const next: SettingsState = {
        ...state,
        profiles: state.profiles.map((p) => (p.id === editing.id ? updatedProfile : p)),
      };
      commit(next);
      setTest({ state: "idle" });
    },
    [editing, state, commit]
  );

  const setActive = useCallback(
    (id: string) => {
      commit({ ...state, activeId: id });
    },
    [state, commit]
  );

  const addProfile = useCallback(() => {
    const jatevo = PRESETS[0];
    const np: Profile = {
      id: uid(),
      name: `New profile ${state.profiles.length + 1}`,
      baseURL: jatevo.baseURL,
      apiKey: "",
      models: [...jatevo.models],
      defaultModel: jatevo.defaultModel,
    };
    const next: SettingsState = {
      profiles: [...state.profiles, np],
      activeId: state.activeId ?? np.id,
    };
    commit(next);
    setEditingId(np.id);
    setTest({ state: "idle" });
  }, [state, commit]);

  const deleteProfile = useCallback(
    (id: string) => {
      if (state.profiles.length <= 1) {
        alert("Keep at least one profile. Use 'Revoke key' to clear the key instead.");
        return;
      }
      if (!confirm("Delete this profile permanently?")) return;
      const profiles = state.profiles.filter((p) => p.id !== id);
      const activeId = state.activeId === id ? profiles[0]?.id ?? null : state.activeId;
      commit({ profiles, activeId });
      if (editingId === id) setEditingId(profiles[0]?.id ?? null);
    },
    [state, commit, editingId]
  );

  const revokeKey = useCallback(() => {
    if (!editing) return;
    if (!confirm("Clear the API key for this profile? (Falls back to server env if any.)")) return;
    updateEditing({ apiKey: "" });
  }, [editing, updateEditing]);

  const applyPreset = useCallback(
    (presetName: string) => {
      if (!editing) return;
      const preset = PRESETS.find((p) => p.name === presetName);
      if (!preset) return;
      updateEditing({
        baseURL: preset.baseURL,
        models: [...preset.models],
        defaultModel: preset.defaultModel,
        name: editing.name.startsWith("New profile") ? preset.name : editing.name,
      });
    },
    [editing, updateEditing]
  );

  const runTest = useCallback(async () => {
    if (!editing) return;
    setTest({ state: "loading" });
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: editing.apiKey, baseURL: editing.baseURL }),
      });
      const json = await res.json();
      if (json.ok) {
        setTest({ state: "ok", modelCount: json.modelCount });
      } else {
        setTest({ state: "fail", error: json.error || `HTTP ${res.status}` });
      }
    } catch (err) {
      setTest({
        state: "fail",
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [editing]);

  const exportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nngpt-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const importSettings = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text) as SettingsState;
        if (!parsed.profiles || !Array.isArray(parsed.profiles)) throw new Error("Invalid file");
        commit({
          profiles: parsed.profiles,
          activeId: parsed.activeId ?? parsed.profiles[0]?.id ?? null,
        });
        setEditingId(parsed.activeId ?? parsed.profiles[0]?.id ?? null);
        alert("Settings imported.");
      } catch (e) {
        alert("Failed to import: " + (e instanceof Error ? e.message : "bad file"));
      }
    };
    input.click();
  }, [commit]);

  if (!open) return null;

  const modelsText = editing ? editing.models.join("\n") : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[640px] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#3a3a3a] bg-[#212121] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-[#2f2f2f] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-[#ececec]">Settings</h2>
            <span className="text-xs text-[#8e8ea0]">API profiles & keys</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={importSettings}
              className="rounded-lg px-2 py-1.5 text-xs text-[#b4b4b4] hover:bg-[#2a2a2a] hover:text-white"
              title="Import settings JSON"
            >
              Import
            </button>
            <button
              type="button"
              onClick={exportSettings}
              className="rounded-lg px-2 py-1.5 text-xs text-[#b4b4b4] hover:bg-[#2a2a2a] hover:text-white"
              title="Export settings JSON"
            >
              Export
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#b4b4b4] hover:bg-[#2a2a2a] hover:text-white"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* body */}
        <div className="flex flex-1 overflow-hidden">
          {/* profiles list */}
          <div className="flex w-[240px] shrink-0 flex-col border-r border-[#2f2f2f] bg-[#181818]">
            <div className="p-2">
              <button
                type="button"
                onClick={addProfile}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#3a3a3a] bg-transparent px-3 py-2 text-sm text-[#ececec] hover:bg-[#2a2a2a]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New profile
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {state.profiles.map((p) => {
                const isActive = p.id === state.activeId;
                const isEditing = p.id === editingId;
                const hasKey = p.apiKey.trim().length > 0;
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setEditingId(p.id);
                      setTest({ state: "idle" });
                    }}
                    className={`mb-1 cursor-pointer rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      isEditing
                        ? "bg-[#2a2a2a] text-[#ececec]"
                        : "text-[#b4b4b4] hover:bg-[#222]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate font-medium">{p.name}</div>
                      {isActive && (
                        <span className="shrink-0 rounded-full bg-[#10a37f] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#8e8ea0]">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          hasKey ? "bg-[#10a37f]" : "bg-[#5a5a5a]"
                        }`}
                      />
                      <span className="truncate">{hasKey ? "key set" : "no key (uses server)"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* editor */}
          <div className="flex flex-1 flex-col overflow-y-auto">
            {!editing ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[#8e8ea0]">
                Select or create a profile
              </div>
            ) : (
              <div className="space-y-4 p-5">
                {/* header row */}
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[#ececec]">Editing profile</div>
                  <div className="flex items-center gap-2">
                    {state.activeId === editing.id ? (
                      <span className="rounded-md bg-[#10a37f]/20 px-2.5 py-1 text-xs font-medium text-[#10a37f]">
                        Currently active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActive(editing.id)}
                        className="rounded-md bg-[#10a37f] px-3 py-1 text-xs font-medium text-white hover:bg-[#0d8a6b]"
                      >
                        Set as active
                      </button>
                    )}
                  </div>
                </div>

                {/* name */}
                <Field label="Display name">
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => updateEditing({ name: e.target.value })}
                    className="w-full rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                    placeholder="e.g. My OpenAI key"
                  />
                </Field>

                {/* preset */}
                <Field label="Preset (autofills base URL + models)">
                  <select
                    value=""
                    aria-label="Select preset"
                    onChange={(e) => applyPreset(e.target.value)}
                    className="w-full cursor-pointer rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                  >
                    <option value="">— pick a preset —</option>
                    {PRESETS.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* baseURL */}
                <Field label="Base URL" hint="Must be OpenAI-compatible (ends with /v1)">
                  <input
                    type="text"
                    value={editing.baseURL}
                    onChange={(e) => updateEditing({ baseURL: e.target.value })}
                    className="w-full rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 font-mono text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                    placeholder="https://lb.jatevo.ai/v1"
                  />
                </Field>

                {/* apiKey */}
                <Field
                  label="API key"
                  hint="Stored in your browser only. Sent on each request to /api/chat."
                >
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={editing.apiKey}
                      onChange={(e) => updateEditing({ apiKey: e.target.value })}
                      className="w-full rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 pr-20 font-mono text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-[#b4b4b4] hover:bg-[#3a3a3a] hover:text-white"
                    >
                      {showKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </Field>

                {/* models */}
                <Field label="Models" hint="One per line. The first becomes the default if none picked.">
                  <textarea
                    value={modelsText}
                    onChange={(e) => {
                      const list = e.target.value
                        .split(/\r?\n/)
                        .map((x) => x.trim())
                        .filter(Boolean);
                      updateEditing({ models: list });
                    }}
                    rows={5}
                    className="w-full resize-y rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 font-mono text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                    placeholder={"gpt-5.5\ngpt-5.4\ngpt-5.3-codex"}
                  />
                </Field>

                {/* default model */}
                {editing.models.length > 0 && (
                  <Field label="Default model">
                    <select
                      value={editing.defaultModel}
                      aria-label="Default model"
                      onChange={(e) => updateEditing({ defaultModel: e.target.value })}
                      className="w-full cursor-pointer rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] px-3 py-2 text-sm text-[#ececec] outline-none focus:border-[#5a5a5a]"
                    >
                      {editing.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {/* actions */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={test.state === "loading"}
                    className="rounded-lg bg-[#2a2a2a] px-4 py-2 text-sm font-medium text-[#ececec] hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {test.state === "loading" ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    type="button"
                    onClick={revokeKey}
                    disabled={!editing.apiKey}
                    className="rounded-lg border border-[#5c2222] bg-transparent px-4 py-2 text-sm font-medium text-[#ff6b6b] hover:bg-[#3a1a1a] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Revoke key
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProfile(editing.id)}
                    className="ml-auto rounded-lg px-3 py-2 text-sm text-[#8e8ea0] hover:bg-[#2a2a2a] hover:text-[#ff6b6b]"
                  >
                    Delete profile
                  </button>
                </div>

                {/* test result */}
                {test.state === "ok" && (
                  <div className="rounded-lg border border-[#10a37f]/30 bg-[#10a37f]/10 px-3 py-2 text-sm text-[#10a37f]">
                    ✓ Connection OK
                    {typeof test.modelCount === "number" && (
                      <span className="ml-1 text-[#8aceb9]">({test.modelCount} models available)</span>
                    )}
                  </div>
                )}
                {test.state === "fail" && (
                  <div className="rounded-lg border border-[#5c2222] bg-[#3a1a1a]/40 px-3 py-2 text-sm text-[#ff6b6b]">
                    ✗ {test.error}
                  </div>
                )}

                <div className="rounded-lg border border-[#3a3a3a] bg-[#1a1a1a] p-3 text-xs leading-relaxed text-[#8e8ea0]">
                  <div className="mb-1 font-semibold text-[#b4b4b4]">Security note</div>
                  API keys live in your browser&apos;s localStorage and are sent on each chat
                  request to <code className="rounded bg-[#2a2a2a] px-1 py-0.5">/api/chat</code>,
                  which proxies to the base URL. Clearing the key falls back to the server&apos;s
                  <code className="rounded bg-[#2a2a2a] px-1 py-0.5"> OPENAI_API_KEY</code> env if
                  set. Avoid using this on shared devices.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-[#8e8ea0]">
          {label}
        </label>
        {hint && <span className="text-[11px] text-[#6f6f7a]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
