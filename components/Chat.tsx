"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveProfile,
  loadSettings,
  type SettingsState,
  type Profile,
} from "@/lib/settings";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

const STORAGE_KEY = "nngpt:conversations:v1";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
  } catch {
    // ignore quota errors
  }
}

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsState>({ profiles: [], activeId: null });
  const [model, setModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const activeProfile: Profile | null = useMemo(() => getActiveProfile(settings), [settings]);
  const availableModels = activeProfile?.models ?? [];

  // hydrate
  useEffect(() => {
    const loaded = loadConversations();
    setConversations(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
    const s = loadSettings();
    setSettings(s);
    const ap = getActiveProfile(s);
    setModel(ap?.defaultModel || ap?.models[0] || "");
  }, []);

  // persist conversations
  useEffect(() => {
    if (conversations.length > 0) saveConversations(conversations);
  }, [conversations]);

  // when settings change, ensure model is valid for active profile
  useEffect(() => {
    if (!activeProfile) return;
    if (!activeProfile.models.includes(model)) {
      setModel(activeProfile.defaultModel || activeProfile.models[0] || "");
    }
  }, [activeProfile, model]);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  // auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages, isStreaming]);

  // textarea auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // close model dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const newConversation = useCallback(() => {
    const c: Conversation = {
      id: uid(),
      title: "New chat",
      messages: [],
      model,
      createdAt: Date.now(),
    };
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setInput("");
    textareaRef.current?.focus();
  }, [model]);

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (id === activeId) setActiveId(next[0]?.id ?? null);
        if (next.length === 0) saveConversations([]);
        return next;
      });
    },
    [activeId]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    let convId = activeId;
    let baseConvs = conversations;
    if (!convId) {
      const c: Conversation = {
        id: uid(),
        title: text.slice(0, 40),
        messages: [],
        model,
        createdAt: Date.now(),
      };
      baseConvs = [c, ...conversations];
      convId = c.id;
      setActiveId(c.id);
    }

    const userMsg: Message = { id: uid(), role: "user", content: text };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "" };

    const updated = baseConvs.map((c) =>
      c.id === convId
        ? {
            ...c,
            title: c.messages.length === 0 ? text.slice(0, 40) : c.title,
            model,
            messages: [...c.messages, userMsg, assistantMsg],
          }
        : c
    );
    setConversations(updated);
    setInput("");
    setIsStreaming(true);

    const conv = updated.find((c) => c.id === convId)!;
    const apiMessages = conv.messages
      .filter((m) => m.id !== assistantMsg.id)
      .map((m) => ({ role: m.role, content: m.content }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model,
          apiKey: activeProfile?.apiKey ?? "",
          baseURL: activeProfile?.baseURL ?? "",
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Unknown error");
        let parsed = errText;
        try {
          const j = JSON.parse(errText);
          if (j?.error) parsed = j.error;
        } catch {
          // not json
        }
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id
                      ? { ...m, content: `Error: ${parsed.toString().slice(0, 500)}` }
                      : m
                  ),
                }
              : c
          )
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: acc } : m
                  ),
                }
              : c
          )
        );
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Network error";
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: `Error: ${msg}` } : m
                  ),
                }
              : c
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, activeId, conversations, model, activeProfile]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const copyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }, []);

  const displayModelLabel = useMemo(() => {
    if (!model) return "select model";
    // strip 'gpt-' prefix for compactness
    return model.length > 28 ? model.slice(0, 26) + "…" : model;
  }, [model]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-[260px]" : "w-0"
        } shrink-0 overflow-hidden bg-[var(--color-bg-sidebar)] transition-[width] duration-200 ease-out`}
      >
        <div className="flex h-full w-[260px] flex-col">
          <div className="flex items-center justify-between px-3 pt-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <SidebarIcon />
            </button>
            <button
              type="button"
              onClick={newConversation}
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              title="New chat"
              aria-label="New chat"
            >
              <PencilIcon />
            </button>
          </div>

          <div className="mt-2 px-2">
            <button
              type="button"
              onClick={newConversation}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-hover)]"
            >
              <ChatBubbleIcon />
              <span>New chat</span>
            </button>
          </div>

          <div className="mt-4 flex-1 overflow-y-auto px-2 pb-4">
            <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
              Chats
            </div>
            {conversations.length === 0 && (
              <div className="px-2 py-2 text-xs text-[var(--color-text-dim)]">No chats yet</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`group relative mb-0.5 flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm transition-colors ${
                  c.id === activeId
                    ? "bg-[var(--color-bg-hover)] text-[var(--color-text)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
                }`}
              >
                <span className="truncate pr-6">{c.title || "Untitled"}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-dim)] opacity-0 transition-opacity hover:bg-[#3a3a3a] hover:text-[var(--color-text)] group-hover:opacity-100"
                  title="Delete"
                  aria-label="Delete chat"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>

          {/* footer */}
          <div className="border-t border-[#2a2a2a] p-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
              title="Settings"
            >
              <GearIcon />
              <span>Settings</span>
            </button>
            <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#10a37f] to-[#0c7561] text-[11px] font-semibold text-white">
                N
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-[var(--color-text)]">nngpt</div>
                <div className="truncate text-[10px] text-[var(--color-text-dim)]">
                  {activeProfile?.name ?? "no profile"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 px-3 py-2.5">
          {!sidebarOpen && (
            <>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                title="Open sidebar"
                aria-label="Open sidebar"
              >
                <SidebarIcon />
              </button>
              <button
                type="button"
                onClick={newConversation}
                className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                title="New chat"
                aria-label="New chat"
              >
                <PencilIcon />
              </button>
            </>
          )}
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              disabled={availableModels.length === 0}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>nngpt · {displayModelLabel}</span>
              <ChevronDownIcon />
            </button>
            {modelOpen && availableModels.length > 0 && (
              <div className="absolute left-0 top-full z-40 mt-1 max-h-[400px] w-[320px] overflow-y-auto rounded-xl border border-[#3a3a3a] bg-[#2f2f2f] p-1.5 shadow-2xl">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
                  {activeProfile?.name}
                </div>
                {availableModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setModel(m);
                      setModelOpen(false);
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#3a3a3a] ${
                      m === model ? "bg-[#3a3a3a]" : ""
                    }`}
                  >
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                      {m === model ? <CheckIcon /> : null}
                    </div>
                    <div className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--color-text)]">
                      {m}
                    </div>
                  </button>
                ))}
                <div className="mt-1 border-t border-[#3a3a3a] pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setModelOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[#3a3a3a]"
                  >
                    <GearIcon />
                    <span>Manage profiles</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              title="Settings"
              aria-label="Settings"
            >
              <GearIcon />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!active || active.messages.length === 0 ? (
            <Welcome
              onPick={(p) => {
                setInput(p);
                textareaRef.current?.focus();
              }}
              onOpenSettings={() => setSettingsOpen(true)}
              hasKey={(activeProfile?.apiKey ?? "").length > 0}
            />
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6">
              {active.messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  streaming={
                    isStreaming && i === active.messages.length - 1 && m.role === "assistant"
                  }
                  onCopy={() => copyMessage(m.content)}
                />
              ))}
              {isStreaming &&
                active.messages[active.messages.length - 1]?.role === "user" && (
                  <MessageBubble role="assistant" content="" streaming onCopy={() => {}} />
                )}
            </div>
          )}
        </div>

        <div className="px-4 pb-3">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2 rounded-3xl border border-[#3a3a3a] bg-[var(--color-bg-elev)] px-3 py-2.5 focus-within:border-[#5a5a5a]">
              <button
                type="button"
                className="mb-1 rounded-full p-1.5 text-[var(--color-text-secondary)] hover:bg-[#3a3a3a]"
                title="Attach (coming soon)"
                aria-label="Attach"
              >
                <PlusIcon />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder="Message nngpt…"
                className="flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-[var(--color-text-dim)]"
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-[#e5e5e5]"
                  title="Stop"
                  aria-label="Stop"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  disabled={!input.trim() || availableModels.length === 0}
                  className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-opacity hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:bg-[#4a4a4a] disabled:text-[#8e8e8e]"
                  title="Send"
                  aria-label="Send"
                >
                  <ArrowUpIcon />
                </button>
              )}
            </div>
            <div className="mt-2 text-center text-[12px] text-[var(--color-text-dim)]">
              nngpt can make mistakes. Check important info.
            </div>
          </div>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChange={(s) => setSettings(s)}
      />
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
  onCopy,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="fade-in mb-6 flex justify-end">
        <div className="max-w-[min(720px,calc(100vw-160px))] rounded-3xl bg-[var(--color-user-bubble)] px-5 py-2.5 text-[15px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in mb-6 flex gap-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#3a3a3a] bg-[var(--color-bg)]">
        <SparkleIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-relaxed text-[var(--color-text)]">
          <Markdown text={content} />
          {streaming && <span className="typing-cursor" />}
        </div>
        {!streaming && content.length > 0 && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
              title={copied ? "Copied!" : "Copy"}
              aria-label="Copy"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome({
  onPick,
  onOpenSettings,
  hasKey,
}: {
  onPick: (p: string) => void;
  onOpenSettings: () => void;
  hasKey: boolean;
}) {
  const prompts = [
    { title: "Explain SSE streaming", body: "in 5 sentences" },
    { title: "Write a Python function", body: "that finds primes up to N" },
    { title: "Draft a 30-day workout", body: "plan for beginners" },
    { title: "Refactor this code", body: "for readability" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-full border border-[#3a3a3a]">
        <SparkleIcon large />
      </div>
      <div className="mb-2 text-2xl font-medium text-[var(--color-text)]">How can I help?</div>
      {!hasKey && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="mb-8 text-xs text-[var(--color-text-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text-secondary)]"
        >
          Using server&apos;s default key — click to set your own
        </button>
      )}
      {hasKey && <div className="mb-8 h-4" />}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <button
            key={p.title}
            type="button"
            onClick={() => onPick(`${p.title} ${p.body}`)}
            className="rounded-2xl border border-[#3a3a3a] bg-transparent p-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
          >
            <div className="text-sm font-medium text-[var(--color-text)]">{p.title}</div>
            <div className="text-sm text-[var(--color-text-dim)]">{p.body}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- icons ---------- */

function SidebarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SparkleIcon({ large }: { large?: boolean } = {}) {
  const s = large ? 24 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.5L19 9l-5.2 1.5L12 16l-1.8-5.5L5 9l5.2-1.5L12 2zm6 13l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
    </svg>
  );
}
