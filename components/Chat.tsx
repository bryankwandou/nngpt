"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveProfile,
  loadSettings,
  saveSettings,
  type SettingsState,
  type Profile,
  syncSettingsToServer,
  fetchAndMergeSettings,
} from "@/lib/settings";
import {
  type Session,
  ensureDefaultAccount,
  loadSession,
  clearSession,
  verifySession,
  silentBootstrapLogin,
  logoutFromServer,
} from "@/lib/auth";
import { migrateToAccountStorage } from "@/lib/migrate";
import {
  detectKind,
  processFileClientSide,
  parseOnServer,
  buildMessageContent,
  sizeLabel,
  kindIcon,
  type Attachment,
} from "@/lib/attachments";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";
import AuthPage from "@/components/AuthPage";

/* ─── Types ─────────────────────────────────────────────────────── */

type ChatMode = "chat" | "image" | "music" | "video";

interface StoredAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: string;
  content: string | null;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: StoredAttachment[];
  mode?: ChatMode;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

/* ─── Storage ────────────────────────────────────────────────────── */

function convKey(accountId: string) { return `nngpt:conversations:${accountId}`; }

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
    if (convs.length === 0) localStorage.removeItem(convKey(accountId));
    else localStorage.setItem(convKey(accountId), JSON.stringify(convs));
  } catch { /* quota */ }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/* ─── Theme ──────────────────────────────────────────────────────── */

type Theme = "dark" | "light";

function loadTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("nngpt:theme") as Theme) || "dark";
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("nngpt:theme", t);
}

/* ─── Mode config ────────────────────────────────────────────────── */

const MODES: { id: ChatMode; emoji: string; label: string; placeholder: string }[] = [
  { id: "chat",  emoji: "💬", label: "Chat",  placeholder: "Message nngpt…" },
  { id: "image", emoji: "🎨", label: "Image", placeholder: "Describe the image you want to generate…" },
  { id: "music", emoji: "🎵", label: "Music", placeholder: "Describe the music or audio you want…" },
  { id: "video", emoji: "🎬", label: "Video", placeholder: "Describe the video you want to generate…" },
];

/* ─── Main Component ─────────────────────────────────────────────── */

export default function Chat() {
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
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
  const [theme, setTheme] = useState<Theme>("dark");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [isRecording, setIsRecording] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const loadedAccountId = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const serverSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeProfile: Profile | null = useMemo(() => getActiveProfile(settings), [settings]);
  const accountId = session?.accountId ?? "";
  const availableModels = activeProfile?.models ?? [];
  const currentMode = MODES.find(m => m.id === mode) ?? MODES[0];

  /* ── Theme init ──────────────────────────────────────────────── */
  useEffect(() => {
    const t = loadTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(t => {
      const next: Theme = t === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  /* ── Initial mount: check auth + full recovery ──────────────── */
  useEffect(() => {
    ensureDefaultAccount().then(async () => {
      let sess = loadSession();

      // ── 1. Verify / silently renew session ────────────────────
      if (sess) {
        const verified = await verifySession(sess).catch(() => sess);
        if (!verified) {
          // Session expired — try silent re-login before forcing login page
          clearSession();
          sess = await silentBootstrapLogin().catch(() => null);
        }
      } else {
        // No session at all — try silent bootstrap login
        sess = await silentBootstrapLogin().catch(() => null);
      }

      if (sess) {
        migrateToAccountStorage(sess.accountId);
        loadedAccountId.current = sess.accountId;
        let s = loadSettings(sess.accountId);
        // Fetch server settings and merge (preserving local API keys)
        if (sess.sessionId) {
          s = await fetchAndMergeSettings(sess.accountId, sess.sessionId, s).catch(() => s);
          saveSettings(sess.accountId, s);
        }
        setSettings(s);
        const ap = getActiveProfile(s);
        setModel(ap?.defaultModel || ap?.models[0] || "");

        // ── 2. Load from localStorage (current accountId) ────────
        const localConvs = loadConversations(sess.accountId);
        let convs = localConvs;

        // ── 3. Fetch from server with Bearer token ───────────────
        const bearer = sess.sessionId ? `Bearer ${sess.sessionId}` : "";
        if (bearer) {
          try {
            const r = await fetch(
              `/api/conversations?accountId=${sess.accountId}`,
              { headers: { Authorization: bearer } }
            );
            if (r.ok) {
              const data = await r.json() as { conversations?: Conversation[] };
              const serverConvs = Array.isArray(data.conversations) ? data.conversations : [];
              if (serverConvs.length > 0) {
                const byId = new Map<string, Conversation>();
                for (const c of serverConvs) byId.set(c.id, c);
                for (const c of localConvs) byId.set(c.id, c); // local wins on conflict
                convs = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
                saveConversations(sess.accountId, convs);
              }
            }
          } catch { /* offline */ }
        }

        // ── 4. Recovery: scan ALL orphaned localStorage keys ─────
        // Always runs (merge, not skip) to catch any leftover from prior accountIds
        if (typeof window !== "undefined") {
          const currentKey = convKey(sess.accountId);
          const orphaned: Conversation[] = [];
          const orphanedKeys: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("nngpt:conversations:") && k !== currentKey) {
              try {
                const raw = localStorage.getItem(k);
                if (raw) {
                  const parsed = JSON.parse(raw) as Conversation[];
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    orphaned.push(...parsed);
                    orphanedKeys.push(k);
                  }
                }
              } catch { /* skip invalid */ }
            }
          }
          if (orphaned.length > 0) {
            const byId = new Map<string, Conversation>();
            for (const c of convs) byId.set(c.id, c);
            for (const c of orphaned) if (!byId.has(c.id)) byId.set(c.id, c);
            convs = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
            saveConversations(sess.accountId, convs);
            for (const k of orphanedKeys) localStorage.removeItem(k);
          }
        }

        setConversations(convs);
        if (convs.length > 0) setActiveConvId(convs[0].id);
      }
      setSession(sess);
      setAuthChecked(true);
    });
  }, []);

  /* ── Reload on session change ────────────────────────────────── */
  const prevSessionId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevSessionId.current === undefined) {
      prevSessionId.current = session?.accountId ?? null;
      return;
    }
    const newId = session?.accountId ?? null;
    if (prevSessionId.current === newId) return;
    prevSessionId.current = newId;

    abortRef.current?.abort();
    setInput("");
    setAttachments([]);
    setIsStreaming(false);

    if (!session) {
      loadedAccountId.current = null;
      setSettings({ profiles: [], activeId: null });
      setConversations([]);
      setActiveConvId(null);
      return;
    }

    loadedAccountId.current = session.accountId;
    const s = loadSettings(session.accountId);
    setSettings(s);
    const ap = getActiveProfile(s);
    setModel(ap?.defaultModel || ap?.models[0] || "");
    const convs = loadConversations(session.accountId);
    setConversations(convs);
    setActiveConvId(convs[0]?.id ?? null);
  }, [session]);

  /* ── Sync model to profile ───────────────────────────────────── */
  useEffect(() => {
    if (!activeProfile) return;
    if (!availableModels.includes(model)) {
      setModel(activeProfile.defaultModel || availableModels[0] || "");
    }
  }, [activeProfile, model, availableModels]);

  /* ── Persist conversations to localStorage ───────────────────── */
  useEffect(() => {
    if (!loadedAccountId.current) return;
    saveConversations(loadedAccountId.current, conversations);
  }, [conversations]);

  /* ── Auto-save conversations to server DB (debounced 2s) ────── */
  useEffect(() => {
    const id = loadedAccountId.current;
    if (!id || conversations.length === 0) return;
    if (serverSyncTimer.current) clearTimeout(serverSyncTimer.current);
    serverSyncTimer.current = setTimeout(async () => {
      const sess = loadSession();
      const bearer = sess?.sessionId ? `Bearer ${sess.sessionId}` : "";
      if (!bearer) return; // no valid session — skip server sync
      try {
        await fetch("/api/conversations", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: bearer,
          },
          body: JSON.stringify({ accountId: id, conversations }),
        });
      } catch { /* offline */ }
    }, 2000);
    return () => { if (serverSyncTimer.current) clearTimeout(serverSyncTimer.current); };
  }, [conversations]);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  /* ── Scroll tracking ─────────────────────────────────────────── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [activeConv?.messages, isStreaming]);

  /* ── Textarea auto-grow ──────────────────────────────────────── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  /* ── Close model menu on outside click ──────────────────────── */
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* ── Sidebar: auto-close on mobile when nav happens ─────────── */
  useEffect(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    if (isMobile) setSidebarOpen(false);
  }, []);

  /* ── Camera: set video src after DOM update ──────────────────── */
  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraOpen]);

  /* ── Cleanup on unmount ──────────────────────────────────────── */
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ── Auth handlers ───────────────────────────────────────────── */
  const handleLogin = useCallback((sess: Session) => {
    migrateToAccountStorage(sess.accountId);
    setSession(sess);
  }, []);

  const logout = useCallback(() => {
    const sess = session;
    clearSession();
    setSession(null);
    if (sess) logoutFromServer(sess).catch(() => {});
  }, [session]);

  /* ── Conversations ───────────────────────────────────────────── */
  const newConversation = useCallback(() => {
    const c: Conversation = { id: uid(), title: "New chat", messages: [], model, createdAt: Date.now() };
    setConversations(p => [c, ...p]);
    setActiveConvId(c.id);
    setInput("");
    setAttachments([]);
    setSidebarOpen(s => { if (typeof window !== "undefined" && window.innerWidth < 768) return false; return s; });
    textareaRef.current?.focus();
  }, [model]);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (id === activeConvId) setActiveConvId(next[0]?.id ?? null);
      return next;
    });
  }, [activeConvId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  /* ── File handling ───────────────────────────────────────────── */
  const addFiles = useCallback(async (files: File[]) => {
    const filtered = files.filter(f => f.size < 25 * 1024 * 1024);
    if (filtered.length < files.length) {
      alert(`Files >25 MB are skipped. ${files.length - filtered.length} file(s) skipped.`);
    }
    const pending: Attachment[] = filtered.map(f => ({
      id: uid(), name: f.name, size: f.size,
      mimeType: f.type || "application/octet-stream",
      kind: detectKind(f.type, f.name),
      content: null, processing: true,
    }));
    setAttachments(p => [...p, ...pending]);

    await Promise.all(filtered.map(async (file, i) => {
      const id = pending[i].id;
      const partial = await processFileClientSide(file, id);
      let finalContent = partial.content;
      let finalError = partial.error;
      if (partial.processing) {
        const { text, error } = await parseOnServer(file, partial.kind);
        finalContent = text;
        finalError = error;
      }
      setAttachments(prev => prev.map(a =>
        a.id === id ? { ...a, ...partial, content: finalContent, processing: false, error: finalError } : a
      ));
    }));
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(p => p.filter(a => a.id !== id));
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) { e.preventDefault(); addFiles(files); }
  }, [addFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }, [addFiles]);

  /* ── Audio recording ─────────────────────────────────────────── */
  const startRecording = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition not supported. Please use Chrome or Edge.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = new SR();
    r.lang = navigator.language || "id-ID";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: { results: { isFinal: boolean; [index: number]: { transcript: string } }[] }) => {
      let finalText = "";
      for (const result of Array.from(e.results)) {
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText) setInput(prev => prev + finalText);
    };
    r.onerror = () => setIsRecording(false);
    r.onend = () => { setIsRecording(false); recognitionRef.current = null; };
    recognitionRef.current = r;
    r.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  /* ── Camera ──────────────────────────────────────────────────── */
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch {
      alert("Camera access denied. Please allow camera permission in your browser settings.");
    }
  }, []);

  const closeCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      addFiles([file]);
      closeCamera();
    }, "image/jpeg", 0.85);
  }, [addFiles, closeCamera]);

  /* ── Send — chat mode ────────────────────────────────────────── */
  const sendChat = useCallback(async () => {
    const text = input.trim();
    const readyAttachments = attachments.filter(a => !a.processing);
    if ((!text && readyAttachments.length === 0) || isStreaming) return;

    let convId = activeConvId;
    let baseConvs = conversations;
    if (!convId) {
      const c: Conversation = {
        id: uid(), model, createdAt: Date.now(),
        title: text.slice(0, 40) || readyAttachments[0]?.name || "Chat",
        messages: [],
      };
      baseConvs = [c, ...conversations];
      convId = c.id;
      setActiveConvId(c.id);
    }

    const storedAttachments: StoredAttachment[] = readyAttachments.map(a => ({
      id: a.id, name: a.name, size: a.size, mimeType: a.mimeType, kind: a.kind, content: a.content,
    }));

    const userMsg: Message = { id: uid(), role: "user", content: text, attachments: storedAttachments.length > 0 ? storedAttachments : undefined };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "" };

    const updated = baseConvs.map(c =>
      c.id === convId
        ? { ...c, title: c.messages.length === 0 ? (text.slice(0, 40) || readyAttachments[0]?.name || "Chat") : c.title, model, messages: [...c.messages, userMsg, assistantMsg] }
        : c
    );
    setConversations(updated);
    setInput("");
    setAttachments([]);
    setIsStreaming(true);
    atBottomRef.current = true;

    const conv = updated.find(c => c.id === convId)!;
    const apiMessages = conv.messages
      .filter(m => m.id !== assistantMsg.id)
      .map(m => ({ role: m.role, content: buildMessageContent(m.content, (m.attachments ?? []) as Attachment[]) }));

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
        try { const j = JSON.parse(errText); if (j?.error) parsed = j.error; } catch {}
        setConversations(prev => prev.map(c => c.id === convId
          ? { ...c, messages: c.messages.map(m => m.id === assistantMsg.id ? { ...m, content: `⚠️ ${parsed}` } : m) }
          : c
        ));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setConversations(prev => prev.map(c => c.id === convId
          ? { ...c, messages: c.messages.map(m => m.id === assistantMsg.id ? { ...m, content: acc } : m) }
          : c
        ));
      }
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Network error";
        setConversations(prev => prev.map(c => c.id === convId
          ? { ...c, messages: c.messages.map(m => m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m) }
          : c
        ));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, attachments, isStreaming, activeConvId, conversations, model, activeProfile]);

  /* ── Send — image generation mode ───────────────────────────── */
  const sendImageGen = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;

    let convId = activeConvId;
    let baseConvs = conversations;
    if (!convId) {
      const c: Conversation = {
        id: uid(), model, createdAt: Date.now(),
        title: `🎨 ${prompt.slice(0, 35)}`,
        messages: [],
      };
      baseConvs = [c, ...conversations];
      convId = c.id;
      setActiveConvId(c.id);
    }

    const userMsg: Message = { id: uid(), role: "user", content: `🎨 **Image prompt:** ${prompt}`, mode: "image" };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: "⏳ Generating image, please wait…", mode: "image" };

    const updated = baseConvs.map(c =>
      c.id === convId
        ? { ...c, title: c.messages.length === 0 ? `🎨 ${prompt.slice(0, 35)}` : c.title, messages: [...c.messages, userMsg, assistantMsg] }
        : c
    );
    setConversations(updated);
    setInput("");
    setIsStreaming(true);
    atBottomRef.current = true;

    try {
      const res = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, apiKey: activeProfile?.apiKey ?? "", baseURL: activeProfile?.baseURL ?? "" }),
      });
      const data = await res.json() as { url?: string; b64_json?: string; revised_prompt?: string; error?: string };
      if (data.error) throw new Error(data.error);

      let imageContent = "";
      if (data.url) {
        imageContent = `![Generated image](${data.url})`;
      } else if (data.b64_json) {
        imageContent = `![Generated image](data:image/png;base64,${data.b64_json})`;
      } else {
        throw new Error("No image returned");
      }
      if (data.revised_prompt) {
        imageContent += `\n\n*Revised prompt: ${data.revised_prompt}*`;
      }

      setConversations(prev => prev.map(c => c.id === convId
        ? { ...c, messages: c.messages.map(m => m.id === assistantMsg.id ? { ...m, content: imageContent } : m) }
        : c
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Image generation failed";
      setConversations(prev => prev.map(c => c.id === convId
        ? { ...c, messages: c.messages.map(m => m.id === assistantMsg.id ? { ...m, content: `⚠️ ${msg}` } : m) }
        : c
      ));
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, activeConvId, conversations, model, activeProfile]);

  /* ── Send — music/video (coming soon) ────────────────────────── */
  const sendComingSoon = useCallback(() => {
    const prompt = input.trim();
    if (!prompt) return;

    let convId = activeConvId;
    let baseConvs = conversations;
    if (!convId) {
      const c: Conversation = {
        id: uid(), model, createdAt: Date.now(),
        title: `${currentMode.emoji} ${prompt.slice(0, 35)}`,
        messages: [],
      };
      baseConvs = [c, ...conversations];
      convId = c.id;
      setActiveConvId(c.id);
    }

    const comingSoonMsg = mode === "music"
      ? "🎵 **Music generation** is coming soon!\n\nFor now, try:\n- [Suno AI](https://suno.ai) — AI music generation\n- [Udio](https://udio.com) — AI music creation\n- [Stable Audio](https://stability.ai/stable-audio) — Stability AI music"
      : "🎬 **Video generation** is coming soon!\n\nFor now, try:\n- [RunwayML](https://runwayml.com) — AI video generation\n- [Pika](https://pika.art) — AI video creation\n- [Sora](https://openai.com/sora) — OpenAI video model";

    const userMsg: Message = { id: uid(), role: "user", content: `${currentMode.emoji} ${prompt}`, mode };
    const assistantMsg: Message = { id: uid(), role: "assistant", content: comingSoonMsg, mode };

    setConversations(baseConvs.map(c =>
      c.id === convId
        ? { ...c, messages: [...c.messages, userMsg, assistantMsg] }
        : c
    ));
    setInput("");
  }, [input, mode, currentMode, activeConvId, conversations, model]);

  /* ── Unified send dispatcher ─────────────────────────────────── */
  const send = useCallback(() => {
    if (mode === "chat") return sendChat();
    if (mode === "image") return sendImageGen();
    return sendComingSoon();
  }, [mode, sendChat, sendImageGen, sendComingSoon]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  const copyMessage = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  }, []);

  const displayModelLabel = availableModels.length === 0 ? "no model" : (model.length > 28 ? model.slice(0, 26) + "…" : model);
  const processingCount = attachments.filter(a => a.processing).length;
  const canSend = !isStreaming && (input.trim().length > 0 || (mode === "chat" && attachments.filter(a => !a.processing).length > 0));

  /* ── Auth gates ──────────────────────────────────────────────── */
  if (!authChecked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)]">
        <div className="text-sm text-[var(--color-text-dim)]">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <AuthPage onLogin={handleLogin} />;
  }

  /* ── Main UI ─────────────────────────────────────────────────── */
  return (
    <div
      className="flex h-[100dvh] w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]"
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={onDrop}
    >
      {/* Camera modal */}
      {cameraOpen && (
        <div className="camera-modal" onClick={closeCamera}>
          <div
            className="flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-[var(--color-bg-elev)] p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--color-text)]">Take a photo</span>
              <button type="button" onClick={closeCamera} className="rounded-lg p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)]">✕</button>
            </div>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full rounded-xl bg-black"
              style={{ maxHeight: "60vh" }}
            />
            <button
              type="button"
              onClick={capturePhoto}
              className="w-full rounded-xl bg-[var(--color-accent)] py-3 font-semibold text-white hover:opacity-90"
            >
              📸 Capture
            </button>
          </div>
        </div>
      )}

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

      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Hidden file input */}
      <label aria-label="Attach files" className="hidden">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          title="Attach files"
          onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) addFiles(files); e.target.value = ""; }}
        />
      </label>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside
        className={`
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          fixed inset-y-0 left-0 z-50 w-[260px] shrink-0 overflow-hidden
          bg-[var(--color-bg-sidebar)] transition-transform duration-200 ease-out
          md:relative md:z-auto md:translate-x-0
          ${sidebarOpen ? "md:w-[260px]" : "md:w-0"}
        `}
        style={{ transition: "transform 200ms ease-out, width 200ms ease-out" }}
      >
        <div className="flex h-full w-[260px] flex-col">
          <div className="flex items-center justify-between px-3 pt-3">
            <button type="button" onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              aria-label="Close sidebar">
              <SidebarIcon />
            </button>
            <button type="button" onClick={newConversation}
              className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              aria-label="New chat">
              <PencilIcon />
            </button>
          </div>
          <div className="mt-2 px-2">
            <button type="button" onClick={newConversation}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-hover)]">
              <ChatBubbleIcon /><span>New chat</span>
            </button>
          </div>
          <div className="mt-3 flex-1 overflow-y-auto px-2 pb-4">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
              {session.username}&apos;s chats
            </div>
            {conversations.length === 0 && (
              <div className="px-2 py-2 text-xs text-[var(--color-text-dim)]">No chats yet</div>
            )}
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => {
                  setActiveConvId(c.id);
                  atBottomRef.current = true;
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={`group relative mb-0.5 flex cursor-pointer items-center rounded-lg px-2 py-2 text-sm transition-colors ${
                  c.id === activeConvId
                    ? "bg-[var(--color-bg-hover)] text-[var(--color-text)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]"
                }`}
              >
                <span className="truncate pr-6">{c.title || "Untitled"}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-dim)] opacity-0 transition-opacity hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-danger)] group-hover:opacity-100"
                  aria-label="Delete">
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--color-border)] p-2">
            <button type="button" onClick={() => setSettingsOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)]">
              <GearIcon /><span>Settings</span>
            </button>
            <div className="mt-1 flex items-center gap-2 px-2 py-1">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#10a37f] to-[#0c7561] text-[11px] font-bold text-white">
                {session.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-[var(--color-text)]">{session.username}</div>
                <div className="truncate text-[10px] text-[var(--color-text-dim)]">{session.email}</div>
              </div>
              <button type="button" onClick={logout}
                className="rounded p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-danger)]"
                title="Sign out" aria-label="Sign out">
                <LogoutIcon />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Header */}
        <header className="flex items-center gap-1.5 px-2 py-2 shrink-0 border-b border-[var(--color-border)]">
          {(!sidebarOpen) && (
            <>
              <button type="button" onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                aria-label="Open sidebar">
                <SidebarIcon />
              </button>
              <button type="button" onClick={newConversation}
                className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                aria-label="New chat">
                <PencilIcon />
              </button>
            </>
          )}

          {/* Model picker */}
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setModelOpen(v => !v)}
              disabled={availableModels.length === 0}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[14px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
            >
              <span className="max-w-[180px] truncate">nngpt · {displayModelLabel}</span>
              <ChevronDownIcon />
            </button>
            {modelOpen && availableModels.length > 0 && (
              <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-elev)] p-1.5 shadow-2xl">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
                  {activeProfile?.name}
                </div>
                {availableModels.map(m => (
                  <button key={m} type="button" onClick={() => { setModel(m); setModelOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-hover)] ${m === model ? "bg-[var(--color-bg-hover)]" : ""}`}>
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center">{m === model ? <CheckIcon /> : null}</div>
                    <span className="truncate font-mono text-[13px] text-[var(--color-text)]">{m}</span>
                  </button>
                ))}
                <div className="mt-1 border-t border-[var(--color-border)] pt-1">
                  <button type="button" onClick={() => { setModelOpen(false); setSettingsOpen(true); }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
                    <GearIcon /><span>Manage profiles</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Theme toggle */}
          <button type="button" onClick={toggleTheme}
            className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Settings */}
          <button type="button" onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            aria-label="Settings">
            <GearIcon />
          </button>
        </header>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!activeConv || activeConv.messages.length === 0 ? (
            <Welcome
              onPick={p => { setInput(p); textareaRef.current?.focus(); }}
              onOpenSettings={() => setSettingsOpen(true)}
              onAttach={() => fileInputRef.current?.click()}
              hasKey={(activeProfile?.apiKey ?? "").length > 0}
            />
          ) : (
            <div className="mx-auto max-w-3xl px-3 py-6 md:px-4">
              {activeConv.messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  attachments={m.attachments}
                  streaming={isStreaming && i === activeConv.messages.length - 1 && m.role === "assistant"}
                  onCopy={() => copyMessage(m.content)}
                />
              ))}
              {isStreaming && activeConv.messages[activeConv.messages.length - 1]?.role === "user" && (
                <MessageBubble role="assistant" content="" streaming onCopy={() => {}} />
              )}
            </div>
          )}
        </div>

        {/* ── Composer area ─────────────────────────────────────── */}
        <div className="shrink-0 px-2 pb-safe md:px-4 md:pb-3">
          <div className="mx-auto max-w-3xl">
            {/* Mode selector toolbar */}
            <div className="mb-2 flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
              {MODES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`mode-btn${mode === m.id ? " active" : ""}`}
                >
                  <span>{m.emoji}</span>
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              ))}
            </div>

            {/* Input box */}
            <div className={`rounded-2xl border bg-[var(--color-bg-elev)] transition-colors ${
              dragOver ? "border-[var(--color-accent)]" : "border-[var(--color-border)] focus-within:border-[var(--color-border-strong)]"
            }`}>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                  {attachments.map(a => (
                    <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5 px-2 py-2">
                {/* Attach / Camera / Mic buttons */}
                {mode === "chat" && (
                  <div className="flex shrink-0 items-center gap-0.5 mb-1">
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="rounded-full p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                      title="Attach files">
                      <PlusIcon />
                    </button>
                    <button type="button" onClick={openCamera}
                      className="rounded-full p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                      title="Open camera">
                      <CameraIcon />
                    </button>
                  </div>
                )}

                {/* Textarea */}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={onKey}
                  onPaste={handlePaste}
                  rows={1}
                  placeholder={attachments.length > 0 ? "Add a message (optional)…" : currentMode.placeholder}
                  className="flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-6 outline-none placeholder:text-[var(--color-text-dim)]"
                  disabled={isStreaming}
                  style={{ minWidth: 0 }}
                />

                {/* Mic + Send buttons */}
                <div className="flex shrink-0 items-center gap-0.5 mb-1">
                  {mode === "chat" && (
                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`rounded-full p-1.5 transition-colors ${
                        isRecording
                          ? "bg-[var(--color-recording)] text-white recording-pulse"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                      }`}
                      title={isRecording ? "Stop recording" : "Voice input"}
                    >
                      <MicIcon active={isRecording} />
                    </button>
                  )}

                  {isStreaming ? (
                    <button type="button" onClick={stop}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-text)] text-[var(--color-bg)] hover:opacity-80"
                      aria-label="Stop">
                      <StopIcon />
                    </button>
                  ) : (
                    <button type="button" onClick={send}
                      disabled={!canSend || processingCount > 0}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-text)] text-[var(--color-bg)] hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Send"
                      title={processingCount > 0 ? `Processing ${processingCount} file(s)…` : "Send"}>
                      {processingCount > 0
                        ? <span className="text-[9px] font-bold">{processingCount}</span>
                        : <ArrowUpIcon />
                      }
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-1.5 text-center text-[11px] text-[var(--color-text-dim)]">
              nngpt can make mistakes. Verify important information.
            </div>
          </div>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChange={s => {
          setSettings(s);
          // Sync non-sensitive settings to server for cross-device profile config
          const sid = session?.sessionId;
          const aid = loadedAccountId.current;
          if (sid && aid) {
            syncSettingsToServer(aid, sid, s).catch(() => {});
          }
        }}
        accountId={accountId}
      />
    </div>
  );
}

/* ─── AttachmentChip ─────────────────────────────────────────────── */

function AttachmentChip({ attachment: a, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const isImage = a.kind === "image" && a.content;
  return (
    <div className="attachment-chip group relative flex items-center gap-1.5 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-hover)] pr-6">
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
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-text-dim)] hover:text-[var(--color-danger)]"
        aria-label="Remove">×</button>
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
        <div className="max-w-[min(680px,calc(100vw-80px))]">
          {hasAttachments && (
            <div className="mb-2 flex flex-wrap justify-end gap-1.5">
              {attachments!.map(a => <AttachmentDisplay key={a.id} attachment={a} />)}
            </div>
          )}
          {content && (
            <div className="rounded-2xl bg-[var(--color-user-bubble)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap border border-[var(--color-border)]">
              {content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in mb-6 flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] mt-0.5">
        <SparkleIcon />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-relaxed text-[var(--color-text)]">
          <Markdown text={content} />
          {streaming && <span className="typing-cursor" />}
        </div>
        {!streaming && content.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
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
        className="max-h-64 max-w-xs rounded-2xl border border-[var(--color-border)] object-contain" />
    );
  }
  const hasContent = Boolean(a.content);
  return (
    <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-xs">
      <button type="button" onClick={() => hasContent && setExpanded(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <span className="text-base">{kindIcon(a.kind as import("@/lib/attachments").AttachmentKind)}</span>
        <span className="font-medium text-[var(--color-text)]">{a.name}</span>
        <span className="text-[var(--color-text-dim)]">· {sizeLabel(a.size)}</span>
        {hasContent && <span className="ml-auto text-[var(--color-text-dim)]">{expanded ? "▲" : "▼"}</span>}
      </button>
      {expanded && a.content && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-text-secondary)]">
            {a.content.slice(0, 5000)}{a.content.length > 5000 ? "\n… (truncated)" : ""}
          </pre>
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
    { title: "Explain quantum computing", body: "in simple terms" },
    { title: "Write a Python function", body: "to find prime numbers" },
    { title: "Plan a 7-day workout", body: "for beginners" },
    { title: "Analyze this document", body: "📎 drop a file to start" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <SparkleIcon large />
      </div>
      <div className="mb-2 text-2xl font-semibold text-[var(--color-text)]">How can I help?</div>
      {!hasKey && (
        <button type="button" onClick={onOpenSettings}
          className="mb-5 text-xs text-amber-500 underline decoration-dotted underline-offset-2 hover:text-amber-400">
          ⚠ No API key configured — click to add in Settings
        </button>
      )}
      {hasKey && <div className="mb-5 h-3" />}
      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {prompts.map((p, i) => (
          <button key={p.title} type="button"
            onClick={i === 3 ? onAttach : () => onPick(`${p.title} ${p.body}`)}
            className="rounded-2xl border border-[var(--color-border)] bg-transparent p-3 text-left transition-colors hover:bg-[var(--color-bg-hover)]">
            <div className="text-sm font-medium text-[var(--color-text)]">{p.title}</div>
            <div className="text-sm text-[var(--color-text-dim)]">{p.body}</div>
          </button>
        ))}
      </div>
      <button type="button" onClick={onAttach}
        className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-dim)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)]">
        <PlusIcon /><span>Attach — image, PDF, DOCX, XLSX, code, CSV…</span>
      </button>
    </div>
  );
}

/* ─── Icons ──────────────────────────────────────────────────────── */
function SidebarIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>; }
function PencilIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>; }
function ChatBubbleIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>; }
function ChevronDownIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>; }
function CheckIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function PlusIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function ArrowUpIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>; }
function StopIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>; }
function CopyIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>; }
function GearIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>; }
function LogoutIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>; }
function SparkleIcon({ large }: { large?: boolean } = {}) { const s = large ? 22 : 15; return <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.5L19 9l-5.2 1.5L12 16l-1.8-5.5L5 9l5.2-1.5L12 2zm6 13l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" /></svg>; }
function SunIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>; }
function MoonIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>; }
function CameraIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>; }
function MicIcon({ active }: { active?: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>; }
