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
  const [showList, setShowList] = useState(true); // mobile: toggle list vs editor

  useEffect(() => {
    if (!open) return;
    const loaded = loadSettings(accountId);
    setState(loaded);
    setEditingId(loaded.activeId ?? loaded.profiles[0]?.id ?? null);
    setShowKey(false);
    setTest({ state: "idle" });
    setShowList(true);
  }, [open, accountId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const commit = useCallback((next: SettingsState) => {
    setState(next);
    saveSettings(accountId, next);
    onChange(next);
  }, [onChange, accountId]);

  const editing = useMemo(
    () => state.profiles.find(p => p.id === editingId) ?? null,
    [state, editingId]
  );

  const updateEditing = useCallback((patch: Partial<Profile>) => {
    if (!editing) return;
    const updated = { ...editing, ...patch };
    if (patch.models && !updated.models.includes(updated.defaultModel)) {
      updated.defaultModel = updated.models[0] ?? "";
    }
    commit({ ...state, profiles: state.profiles.map(p => p.id === editing.id ? updated : p) });
    setTest({ state: "idle" });
  }, [editing, state, commit]);

  const setActive = useCallback((id: string) => commit({ ...state, activeId: id }), [state, commit]);

  const addProfile = useCallback(() => {
    const preset = PRESETS[0];
    const np: Profile = {
      id: uid(), name: `Profile ${state.profiles.length + 1}`,
      baseURL: preset.baseURL, apiKey: "",
      models: [...preset.models], defaultModel: preset.defaultModel,
    };
    commit({ profiles: [...state.profiles, np], activeId: state.activeId ?? np.id });
    setEditingId(np.id);
    setShowList(false);
    setTest({ state: "idle" });
  }, [state, commit]);

  const deleteProfile = useCallback((id: string) => {
    if (state.profiles.length <= 1) {
      alert("Keep at least one profile. Use 'Revoke key' to clear the key instead.");
      return;
    }
    if (!confirm("Delete this profile permanently?")) return;
    const profiles = state.profiles.filter(p => p.id !== id);
    const activeId = state.activeId === id ? profiles[0]?.id ?? null : state.activeId;
    commit({ profiles, activeId });
    if (editingId === id) { setEditingId(profiles[0]?.id ?? null); setShowList(true); }
  }, [state, commit, editingId]);

  const revokeKey = useCallback(() => {
    if (!editing) return;
    if (!confirm("Clear the API key for this profile?")) return;
    updateEditing({ apiKey: "" });
  }, [editing, updateEditing]);

  const applyPreset = useCallback((presetName: string) => {
    if (!editing) return;
    const preset = PRESETS.find(p => p.name === presetName);
    if (!preset) return;
    updateEditing({
      baseURL: preset.baseURL,
      models: [...preset.models],
      defaultModel: preset.defaultModel,
      name: editing.name.startsWith("Profile") ? preset.name : editing.name,
    });
  }, [editing, updateEditing]);

  const runTest = useCallback(async () => {
    if (!editing) return;
    setTest({ state: "loading" });
    try {
      const res = await fetch("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: editing.apiKey, baseURL: editing.baseURL }),
      });
      const json = await res.json() as { ok: boolean; modelCount?: number; error?: string };
      if (json.ok) setTest({ state: "ok", modelCount: json.modelCount });
      else setTest({ state: "fail", error: json.error || `HTTP ${res.status}` });
    } catch (err) {
      setTest({ state: "fail", error: err instanceof Error ? err.message : "Network error" });
    }
  }, [editing]);

  const exportSettings = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `nngpt-settings-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const importSettings = useCallback(() => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const parsed = JSON.parse(await f.text()) as SettingsState;
        if (!parsed.profiles || !Array.isArray(parsed.profiles)) throw new Error("Invalid file");
        commit({ profiles: parsed.profiles, activeId: parsed.activeId ?? parsed.profiles[0]?.id ?? null });
        setEditingId(parsed.activeId ?? parsed.profiles[0]?.id ?? null);
        alert("Settings imported.");
      } catch (e) { alert("Failed to import: " + (e instanceof Error ? e.message : "bad file")); }
    };
    input.click();
  }, [commit]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="modal-body flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl sm:h-[640px] sm:max-h-[90vh] sm:max-w-4xl sm:rounded-2xl sm:border"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Mobile back button (editor → list) */}
            {!showList && (
              <button type="button" onClick={() => setShowList(true)}
                className="mr-1 rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] sm:hidden"
                aria-label="Back to profiles">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            )}
            <h2 className="text-[15px] font-semibold text-[var(--color-text)]">Settings</h2>
            <span className="text-xs text-[var(--color-text-dim)]">API profiles & keys</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={importSettings}
              className="rounded-lg px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
              Import
            </button>
            <button type="button" onClick={exportSettings}
              className="rounded-lg px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
              Export
            </button>
            <button type="button" onClick={onClose}
              className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Profile list — hidden on mobile when editing ── */}
          <div className={`${showList ? "flex" : "hidden"} sm:flex w-full sm:w-[220px] shrink-0 flex-col border-b border-[var(--color-border)] sm:border-b-0 sm:border-r`}>
            <div className="p-2">
              <button type="button" onClick={addProfile}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New profile
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {state.profiles.map(p => {
                const isActive = p.id === state.activeId;
                const isEditing = p.id === editingId;
                const hasKey = p.apiKey.trim().length > 0;
                return (
                  <div key={p.id}
                    onClick={() => { setEditingId(p.id); setTest({ state: "idle" }); setShowList(false); }}
                    className={`mb-1 cursor-pointer rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      isEditing ? "bg-[var(--color-bg-hover)] text-[var(--color-text)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
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
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)]">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${hasKey ? "bg-[#10a37f]" : "bg-[var(--color-border-strong)]"}`} />
                      <span className="truncate">{hasKey ? "key set" : "no key (uses server)"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Editor — hidden on mobile when showing list ── */}
          <div className={`${!showList ? "flex" : "hidden"} sm:flex flex-1 flex-col overflow-y-auto`}>
            {!editing ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-dim)]">
                Select or create a profile
              </div>
            ) : (
              <div className="space-y-4 p-4 sm:p-5">
                {/* Active status row */}
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[var(--color-text)]">Editing profile</div>
                  {state.activeId === editing.id ? (
                    <span className="rounded-md bg-[#10a37f]/20 px-2.5 py-1 text-xs font-medium text-[#10a37f]">
                      Currently active
                    </span>
                  ) : (
                    <button type="button" onClick={() => setActive(editing.id)}
                      className="rounded-md bg-[#10a37f] px-3 py-1 text-xs font-medium text-white hover:bg-[#0d8a6b]">
                      Set as active
                    </button>
                  )}
                </div>

                {/* Name */}
                <Field label="Display name">
                  <input type="text" value={editing.name}
                    onChange={e => updateEditing({ name: e.target.value })}
                    className="input-field" placeholder="e.g. My OpenAI key" />
                </Field>

                {/* Preset */}
                <Field label="Preset" hint="Autofills base URL + models">
                  <select value="" aria-label="Select preset"
                    onChange={e => applyPreset(e.target.value)}
                    className="input-field cursor-pointer">
                    <option value="">— pick a preset —</option>
                    {PRESETS.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </Field>

                {/* Base URL */}
                <Field label="Base URL" hint="OpenAI-compatible endpoint">
                  <input type="text" value={editing.baseURL}
                    onChange={e => updateEditing({ baseURL: e.target.value })}
                    className="input-field font-mono" placeholder="https://lb.jatevo.ai/v1" />
                </Field>

                {/* API key */}
                <Field label="API key" hint="Stored in browser localStorage only">
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={editing.apiKey}
                      onChange={e => updateEditing({ apiKey: e.target.value })}
                      className="input-field w-full pr-16 font-mono"
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" onClick={() => setShowKey(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                      {showKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </Field>

                {/* Models */}
                <Field label="Models" hint="One per line">
                  <textarea
                    value={editing.models.join("\n")}
                    onChange={e => {
                      const list = e.target.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
                      updateEditing({ models: list });
                    }}
                    rows={4}
                    className="input-field resize-y"
                    placeholder={"gpt-5.5\ngpt-5.4\nqwen-plus"}
                  />
                </Field>

                {/* Default model */}
                {editing.models.length > 0 && (
                  <Field label="Default model">
                    <select value={editing.defaultModel} aria-label="Default model"
                      onChange={e => updateEditing({ defaultModel: e.target.value })}
                      className="input-field cursor-pointer">
                      {editing.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Field>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button type="button" onClick={runTest} disabled={test.state === "loading"}
                    className="rounded-lg bg-[var(--color-bg-hover)] px-4 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:opacity-50">
                    {test.state === "loading" ? "Testing…" : "Test connection"}
                  </button>
                  <button type="button" onClick={revokeKey} disabled={!editing.apiKey}
                    className="rounded-lg border border-red-800/50 bg-transparent px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/20 disabled:cursor-not-allowed disabled:opacity-40">
                    Revoke key
                  </button>
                  <button type="button" onClick={() => deleteProfile(editing.id)}
                    className="ml-auto rounded-lg px-3 py-2 text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-red-400">
                    Delete profile
                  </button>
                </div>

                {/* Test result */}
                {test.state === "ok" && (
                  <div className="rounded-lg border border-[#10a37f]/30 bg-[#10a37f]/10 px-3 py-2 text-sm text-[#10a37f]">
                    ✓ Connection OK
                    {typeof test.modelCount === "number" && (
                      <span className="ml-1 opacity-70">({test.modelCount} models)</span>
                    )}
                  </div>
                )}
                {test.state === "fail" && (
                  <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-sm text-red-400">
                    ✗ {test.error}
                  </div>
                )}

                {/* Security note */}
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 text-xs leading-relaxed text-[var(--color-text-dim)]">
                  <div className="mb-1 font-semibold text-[var(--color-text-secondary)]">Security note</div>
                  API keys are stored in your browser&apos;s localStorage and are sent on each chat request
                  to <code className="rounded bg-[var(--color-bg-hover)] px-1">/api/chat</code> which proxies to your base URL.
                  The server never stores your keys. Avoid using on shared devices.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
          {label}
        </label>
        {hint && <span className="text-[11px] text-[var(--color-text-dim)] opacity-70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
