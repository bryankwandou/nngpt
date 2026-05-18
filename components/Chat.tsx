"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveProfile,
  getAccountId,
  loadSettings,
  type SettingsState,
  type Profile,
} from "@/lib/settings";
import {
  detectKind,
  processFileClientSide,
  parseOnServer,
  buildMessageContent,
  sizeLabel,
  kindIcon,
  type Attachment,
  type ContentPart,
} from "@/lib/attachments";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";

/* ─── Types ─────────────────────────────────────────────────────── */

interface StoredAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: string;
  content: string | null; // data-url for image, text for others
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: StoredAttachment[];
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

/* ─── Storage ────────────────────────────────────────────────────── */

function convKey(accountId: string) {
  return `nngpt:conversations:${accountId}`;
}

function loadConversations(accountId: string): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(convKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveConversations(accountId: string, convs: Conversation[]) {
  try {
    if (convs.length === 0) {
      localStorage.removeItem(convKey(accountId));
    } else {
      localStorage.setItem(convKey(accountId), JSON.stringify(convs));
    }
  } catch { /* quota exceeded — ignore */ }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ─── Main Component ─────────────────────────────────────────────── */

export default function Chat() {
  const [settings, setSettings] = useState<SettingsState>({ profiles: [], activeId: null });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const activeProfile: Profile | null = useMemo(() => getActiveProfile(settings), [settings]);
  const accountId = useMemo(() => getAccountId(activeProfile), [activeProfile]);
  const availableModels = activeProfile?.models ?? [];

  // Initial hydration
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    const ap = getActiveProfile(s);
    const aid = getAccountId(ap);
    const convs = loadConversations(aid);
    setConversations(convs);
    if (convs.length > 0) setActiveConvId(convs[0].id);
    setModel(ap?.defaultModel || ap?.models[0] || "");
  }, []);

  // Reload conversations when accountId changes (account switch)
  const prevAccountId = useRef<string | null>(null);
  useEffect(() => {
    if (prevAccountId.current === null) { prevAccountId.current = accountId; return; }
    if (prevAccountId.current === accountId) return;
    prevAccountId.current = accountId;
    // Account switched → load this account's conversations
    const convs = loadConversations(accountId);
    setConversations(convs);
    setActiveConvId(convs[0]?.id ?? null);
    setInput("");
    setAttachments([]);
    setIsStreaming(false);
    abortRef.current?.abort();
  }, [accountId]);

  // Sync model to profile default when profile changes
  useEffect(() => {
    if (!activeProfile) return;
    if (!availableModels.includes(model)) {
      setModel(activeProfile.defaultModel || availableModels[0] || "");
    }
  }, [activeProfile, model, availableModels]);

  // Persist conversations
  useEffect(() => {
    if (prevAccountId.current) saveConversations(accountId, conversations);
  }, [conversations, accountId]);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeConv?.messages, isStreaming]);

  // Textarea auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Close model menu on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const newConversation = useCallback(() => {
    const c: Conversation = { id: uid(), title: "New chat", messages: [], model, createdAt: Date.now() };
    setConversations((p) => [c, ...p]);
    setActiveConvId(c.id);
    setInput("");
    setAttachments([]);
    textareaRef.current?.focus();
  }, [model]);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeConvId) setActiveConvId(next[0]?.id ?? null);
      return next;
    });
  }, [activeConvId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  /* ── File handling ─────────────────────────────────────────────── */

  const addFiles = useCallback(async (files: File[]) => {
    const filtered = files.filter((f) => f.size < 25 * 1024 * 1024); // 25MB limit
    if (filtered.length < files.length) {
      alert(`Files >25 MB are skipped. ${files.length - filtered.length} file(s) not added.`);
    }
    // Create pending entries
    const pending: Attachment[] = filtered.map((f) => ({
      id: uid(),
      name: f.name,
      size: f.size,
      mimeType: f.type || "application/octet-stream",
      kind: detectKind(f.type, f.name),
      content: null,
      processing: true,
    }));
    setAttachments((p) => [...p, ...pending]);

    await Promise.all(
      filtered.map(async (file, i) => {
        const id = pending[i].id;
        const partial = await processFileClientSide(file, id);
        // If needs server parsing, do that next
        let finalContent = partial.content;
        let finalError = partial.error;
        if (partial.processing) {
          const { text, error } = await parseOnServer(file, partial.kind);
          finalContent = text;
          finalError = error;
        }
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...a, ...partial, content: finalContent, processing: false, error: finalError }
              : a
          )
        );
      })
    );
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((p) => p.filter((a) => a.id !== id));
  }, []);

  /* ── Drag & drop ───────────────────────────────────────────────── */

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }, [addFiles]);

  /* ── Send ──────────────────────────────────────────────────────── */

  const send = useCallback(async () => {
    const text = input.trim();
    const readyAttachments = attachments.filter((a) => !a.processing);
    if ((!text && readyAttachments.length === 0) || isStreaming) return;

    // Ensure active conversation
    let convId = activeConvId;
    let baseConvs = conversations;
    if (!convId) {
      const c: Conversation = { id: uid(), title: text.slice(0, 40) || readyAttachments[0]?.name || "Attachment", messages: [], model, createdAt: Date.now() };
      baseConvs = [c, ...conversations];
      convId = c.id;
      setActiveConvId(c.id);
    }

    const storedAttachments: StoredAttachment[] = readyAttachments.map((a) => ({
      id: a.id, name: a.name, size: a.size, mimeType: a.mimeType, kind: a.kind, content: a.content,
    }));

    const userMsg: Message = { id: uid(), role: "user", content: text, attachments: storedAttachments.length > 0 ? storedAttachments : undefined };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "" };

    const updated = baseConvs.map((c) =>
      c.id === convId
        ? { ...c, title: c.messages.length === 0 ? (text.slice(0, 40) || readyAttachments[0]?.name || "Attachment") : c.title, model, messages: [...c.messages, userMsg, assistantMsg] }
        : c
    );
    setConversations(updated);
    setInput("");
    setAttachments([]);
    setIsStreaming(true);

    const conv = updated.find((c) => c.id === convId)!;
    const apiMessages = conv.messages
      .filter((m) => m.id !== assistantMsg.id)
      .map((m) => {
        const content = buildMessageContent(m.content, (m.attachments ?? []) as Attachment[]);
        return { role: m.role, content };
      });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, model, apiKey: activeProfile?.apiKey ?? "", baseURL: activeProfile?.baseURL ?? "" }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "Unknown error");
        let parsed = errText;
        try { const j = JSON.parse(errText); if (j?.error) parsed = j.error; } catch { }
        setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, messages: c.messages.map((m) => m.id === assistantMsg.id ? { ...m, content: `⚠️ ${parsed}` } : m) } : c));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, messages: c.messages.map((m) => m.id === assistantMsg.id ? { ...m, content: acc } : m) } : c));
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Network error";
        setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, messages: c.messages.map((m) => m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m) } : c));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, attachments, isStreaming, activeConvId, conversations, model, activeProfile]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  const copyMessage = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { }
  }, []);

  const displayModelLabel = availableModels.length === 0 ? "no model" : (model.length > 30 ? model.slice(0, 28) + "…" : model);
  const processingCount = attachments.filter((a) => a.processing).length;
  const canSend = !isStreaming && (input.trim().length > 0 || attachments.filter((a) => !a.processing).length > 0);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-2xl border-2 border-dashed border-white/50 bg-black/40 px-10 py-8 text-center">
            <div className="mb-2 text-3xl">📎</div>
            <div className="text-lg font-medium text-white">Drop files to attach</div>
            <div className="mt-1 text-sm text-white/60">Images, PDFs, DOCX, XLSX, text, code…</div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <label aria-label="Attach files" className="hidden">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          title="Attach files"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) addFiles(files); e.target.value = ""; }}
        />
      </label>

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "w-[260px]" : "w-0"} shrink-0 overflow-hidden bg-[var(--color-bg-sidebar)] transition-[width] duration-200 ease-out`}>
        <div className="flex h-full w-[260px] flex-col">
          <div className="flex items-center justify-between px-3 pt-3">
            <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]" aria-label="Close sidebar"><SidebarIcon /></button>
            <button type="button" onClick={newConversation} className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]" aria-label="New chat"><PencilIcon /></button>
          </div>
          <div className="mt-2 px-2">
            <button type="button" onClick={newConversation} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]">
              <ChatBubbleIcon /><span>New chat</span>
            </button>
          </div>
          <div className="mt-3 flex-1 overflow-y-auto px-2 pb-4">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">Chats — {accountId === "server-default" ? "shared" : "private account"}</div>
            {conversations.length === 0 && <div className="px-2 py-2 text-xs text-[var(--color-text-dim)]">No chats yet</div>}
            {conversations.map((c) => (
              <div key={c.id} onClick={() => setActiveConvId(c.id)}
                className={`group relative mb-0.5 flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm transition-colors ${c.id === activeConvId ? "bg-[var(--color-bg-hover)] text-[var(--color-text)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"}`}>
                <span className="truncate pr-6">{c.title || "Untitled"}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-dim)] opacity-0 transition-opacity hover:bg-[#3a3a3a] hover:text-white group-hover:opacity-100" aria-label="Delete">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-[#2a2a2a] p-2">
            <button type="button" onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
              <GearIcon /><span>Settings</span>
            </button>
            <div className="mt-1 flex items-center gap-2 px-2 py-1">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#10a37f] to-[#0c7561] text-[11px] font-bold text-white">
                {accountId === "server-default" ? "?" : accountId.slice(-2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-[var(--color-text)]">{activeProfile?.name ?? "no profile"}</div>
                <div className="truncate text-[10px] text-[var(--color-text-dim)]">
                  {accountId === "server-default" ? "using server key" : "private account"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-2.5 shrink-0">
          {!sidebarOpen && (
            <>
              <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]" aria-label="Open sidebar"><SidebarIcon /></button>
              <button type="button" onClick={newConversation} className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]" aria-label="New chat"><PencilIcon /></button>
            </>
          )}
          <div ref={modelMenuRef} className="relative">
            <button type="button" onClick={() => setModelOpen((v) => !v)} disabled={availableModels.length === 0}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50">
              <span>nngpt · {displayModelLabel}</span><ChevronDownIcon />
            </button>
            {modelOpen && availableModels.length > 0 && (
              <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-[#3a3a3a] bg-[#2f2f2f] p-1.5 shadow-2xl">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">{activeProfile?.name}</div>
                {availableModels.map((m) => (
                  <button key={m} type="button" onClick={() => { setModel(m); setModelOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#3a3a3a] ${m === model ? "bg-[#3a3a3a]" : ""}`}>
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center">{m === model ? <CheckIcon /> : null}</div>
                    <span className="truncate font-mono text-[13px] text-[var(--color-text)]">{m}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-[#3a3a3a] pt-1">
                  <button type="button" onClick={() => { setModelOpen(false); setSettingsOpen(true); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[#3a3a3a]">
                    <GearIcon /><span>Manage profiles</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setSettingsOpen(true)} className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]" aria-label="Settings"><GearIcon /></button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!activeConv || activeConv.messages.length === 0 ? (
            <Welcome onPick={(p) => { setInput(p); textareaRef.current?.focus(); }}
              onOpenSettings={() => setSettingsOpen(true)}
              onAttach={() => fileInputRef.current?.click()}
              hasKey={(activeProfile?.apiKey ?? "").length > 0} />
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6">
              {activeConv.messages.map((m, i) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} attachments={m.attachments}
                  streaming={isStreaming && i === activeConv.messages.length - 1 && m.role === "assistant"}
                  onCopy={() => copyMessage(m.content)} />
              ))}
              {isStreaming && activeConv.messages[activeConv.messages.length - 1]?.role === "user" && (
                <MessageBubble role="assistant" content="" streaming onCopy={() => {}} />
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-4 pb-3">
          <div className="mx-auto max-w-3xl">
            <div className={`rounded-3xl border bg-[var(--color-bg-elev)] transition-colors ${dragOver ? "border-white/40" : "border-[#3a3a3a] focus-within:border-[#5a5a5a]"}`}>
              {/* Attachments row */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                  {attachments.map((a) => (
                    <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 px-3 py-2.5">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="mb-1 rounded-full p-1.5 text-[var(--color-text-secondary)] hover:bg-[#3a3a3a]" title="Attach files">
                  <PlusIcon />
                </button>
                <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
                  rows={1} placeholder={attachments.length > 0 ? "Add a message (optional)…" : "Message nngpt…"}
                  className="flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-[var(--color-text-dim)]"
                  disabled={isStreaming} />
                {isStreaming ? (
                  <button type="button" onClick={stop}
                    className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-[#e5e5e5]" aria-label="Stop">
                    <StopIcon />
                  </button>
                ) : (
                  <button type="button" onClick={send} disabled={!canSend || processingCount > 0}
                    className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:bg-[#4a4a4a] disabled:text-[#8e8e8e]"
                    aria-label="Send" title={processingCount > 0 ? `Processing ${processingCount} file(s)…` : "Send"}>
                    {processingCount > 0 ? <span className="text-[9px] font-bold">{processingCount}</span> : <ArrowUpIcon />}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 text-center text-[12px] text-[var(--color-text-dim)]">
              nngpt can make mistakes. Check important info.
            </div>
          </div>
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChange={(s) => setSettings(s)} />
    </div>
  );
}

/* ─── AttachmentChip ─────────────────────────────────────────────── */

function AttachmentChip({ attachment: a, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImage = a.kind === "image" && a.content;
  return (
    <div className="attachment-chip group relative flex items-center gap-1.5 overflow-hidden rounded-lg border border-[#3a3a3a] bg-[#2a2a2a] pr-6">
      {isImage ? (
        <img src={a.content!} alt={a.name} className="h-10 w-10 shrink-0 object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center text-lg">{kindIcon(a.kind)}</div>
      )}
      <div className="min-w-0 py-1 pr-1">
        <div className="truncate text-[11px] font-medium text-[var(--color-text)]">{a.name}</div>
        <div className="text-[10px] text-[var(--color-text-dim)]">
          {a.processing ? "Processing…" : a.error ? "Error" : sizeLabel(a.size)}
        </div>
      </div>
      <button type="button" onClick={onRemove}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-dim)] hover:text-white"
        aria-label="Remove">
        ×
      </button>
    </div>
  );
}

/* ─── MessageBubble ──────────────────────────────────────────────── */

function MessageBubble({ role, content, attachments, streaming, onCopy }: {
  role: "user" | "assistant"; content: string; attachments?: StoredAttachment[];
  streaming?: boolean; onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";
  const hasAttachments = (attachments?.length ?? 0) > 0;

  const handleCopy = () => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  if (isUser) {
    return (
      <div className="fade-in mb-6 flex justify-end">
        <div className="max-w-[min(720px,calc(100vw-160px))]">
          {hasAttachments && (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {attachments!.map((a) => <AttachmentDisplay key={a.id} attachment={a} />)}
            </div>
          )}
          {content && (
            <div className="rounded-3xl bg-[var(--color-user-bubble)] px-5 py-2.5 text-[15px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
              {content}
            </div>
          )}
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
            <button type="button" onClick={handleCopy}
              className="rounded-md p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
              title={copied ? "Copied!" : "Copy"} aria-label="Copy">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentDisplay({ attachment: a }: { attachment: StoredAttachment }) {
  const [expanded, setExpanded] = useState(false);
  if (a.kind === "image" && a.content) {
    return (
      <img src={a.content} alt={a.name}
        className="max-h-64 max-w-xs rounded-2xl border border-[#3a3a3a] object-contain" />
    );
  }
  const hasContent = Boolean(a.content);
  return (
    <div className="w-full rounded-xl border border-[#3a3a3a] bg-[#1a1a1a] text-xs">
      <button type="button" onClick={() => hasContent && setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-base">{kindIcon(a.kind as AttachmentKind)}</span>
        <span className="font-medium text-[var(--color-text)]">{a.name}</span>
        <span className="text-[var(--color-text-dim)]">·</span>
        <span className="text-[var(--color-text-dim)]">{sizeLabel(a.size)}</span>
        {hasContent && <span className="ml-auto text-[var(--color-text-dim)]">{expanded ? "▲" : "▼"}</span>}
      </button>
      {expanded && a.content && (
        <div className="border-t border-[#2a2a2a] px-3 py-2">
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-text-secondary)]">{a.content.slice(0, 5000)}{a.content.length > 5000 ? "\n… (truncated)" : ""}</pre>
        </div>
      )}
    </div>
  );
}

/* ─── Welcome ────────────────────────────────────────────────────── */

function Welcome({ onPick, onOpenSettings, onAttach, hasKey }: {
  onPick: (p: string) => void; onOpenSettings: () => void; onAttach: () => void; hasKey: boolean;
}) {
  const prompts = [
    { title: "Explain SSE streaming", body: "in 5 sentences" },
    { title: "Write a Python function", body: "that finds primes up to N" },
    { title: "Draft a 30-day workout", body: "plan for beginners" },
    { title: "Analyze this document", body: "📎 drop a file to start" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[#3a3a3a]"><SparkleIcon large /></div>
      <div className="mb-2 text-2xl font-medium text-[var(--color-text)]">How can I help?</div>
      {!hasKey && (
        <button type="button" onClick={onOpenSettings}
          className="mb-6 text-xs text-amber-400 underline decoration-dotted underline-offset-2 hover:text-amber-300">
          ⚠ No API key — click to add yours in Settings
        </button>
      )}
      {hasKey && <div className="mb-6 h-4" />}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p, i) => (
          <button key={p.title} type="button"
            onClick={i === 3 ? onAttach : () => onPick(`${p.title} ${p.body}`)}
            className="rounded-2xl border border-[#3a3a3a] bg-transparent p-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]">
            <div className="text-sm font-medium text-[var(--color-text)]">{p.title}</div>
            <div className="text-sm text-[var(--color-text-dim)]">{p.body}</div>
          </button>
        ))}
      </div>
      <button type="button" onClick={onAttach}
        className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-[#3a3a3a] px-4 py-2 text-sm text-[var(--color-text-dim)] transition-colors hover:border-[#5a5a5a] hover:text-[var(--color-text-secondary)]">
        <PlusIcon /><span>Attach file — image, PDF, DOCX, XLSX, code, CSV…</span>
      </button>
    </div>
  );
}

/* ─── Icons ──────────────────────────────────────────────────────── */
function SidebarIcon() { return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>); }
function PencilIcon() { return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>); }
function ChatBubbleIcon() { return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>); }
function ChevronDownIcon() { return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>); }
function CheckIcon() { return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>); }
function PlusIcon() { return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>); }
function ArrowUpIcon() { return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>); }
function StopIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>); }
function CopyIcon() { return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>); }
function TrashIcon() { return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>); }
function GearIcon() { return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>); }
function SparkleIcon({ large }: { large?: boolean } = {}) { const s = large ? 24 : 16; return (<svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.5L19 9l-5.2 1.5L12 16l-1.8-5.5L5 9l5.2-1.5L12 2zm6 13l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" /></svg>); }
type AttachmentKind = import("@/lib/attachments").AttachmentKind;
