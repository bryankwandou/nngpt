/**
 * Client-side auth library.
 * Primary: Neon PostgreSQL via /api/auth (server-side, cross-device)
 * Cache: localStorage (works offline, instant load)
 *
 * SECURITY: No plaintext passwords or secrets stored in this module.
 * The server is the source of truth for all password verification.
 */

export interface Account {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface Session {
  accountId: string;
  username: string;
  email: string;
  loginAt: number;
  sessionId?: string; // server session token (required for cross-device sync)
}

const ACCOUNTS_KEY = "nngpt:accounts:v1";
const SESSION_KEY = "nngpt:session:v1";

// ── Client-side password hash (for offline localStorage fallback only) ──
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`nngpt::${password}::auth`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function deterministicId(username: string): Promise<string> {
  const data = new TextEncoder().encode(
    `nngpt:account-id-v1:${username.trim().toLowerCase()}`
  );
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 16)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── localStorage persistence ─────────────────────────────────────

export function loadAccounts(): Account[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Account[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveAccounts(accounts: Account[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch {}
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch { return null; }
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

// ── Server API helpers ───────────────────────────────────────────

interface AuthResponse {
  ok: boolean;
  error?: string;
  field?: string;
  sessionId?: string;
  account?: { id: string; username: string; email: string | null };
}

async function callAuth(body: Record<string, unknown>): Promise<AuthResponse> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as AuthResponse;
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// ── Default account bootstrap ─────────────────────────────────────
// Ensures the owner account exists server-side. No session returned.

export async function ensureDefaultAccount(): Promise<void> {
  try {
    await callAuth({ action: "bootstrap" });
  } catch { /* offline */ }
}

// ── Silent auto-login placeholder ────────────────────────────────
// Kept for Chat.tsx compatibility — always returns null so the login
// page is shown when the session is expired. Users must login explicitly.

export async function silentBootstrapLogin(): Promise<Session | null> {
  return null;
}

// ── localStorage key migration ────────────────────────────────────

export function migrateConvKey(oldId: string, newId: string): void {
  const oldKey = `nngpt:conversations:${oldId}`;
  const newKey = `nngpt:conversations:${newId}`;
  try {
    const existing = localStorage.getItem(newKey);
    if (existing) return;
    const data = localStorage.getItem(oldKey);
    if (data) { localStorage.setItem(newKey, data); localStorage.removeItem(oldKey); }
    const oldSettings = localStorage.getItem(`nngpt:settings:${oldId}:v1`);
    if (oldSettings && !localStorage.getItem(`nngpt:settings:${newId}:v1`)) {
      localStorage.setItem(`nngpt:settings:${newId}:v1`, oldSettings);
    }
  } catch {}
}

// ── Login ────────────────────────────────────────────────────────

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{ session: Session } | { error: string }> {

  // 1. Server auth (primary path)
  const result = await callAuth({ action: "login", username, password });
  if (result.ok && result.account && result.sessionId) {
    const session: Session = {
      accountId: result.account.id,
      username: result.account.username,
      email: result.account.email ?? "",
      loginAt: Date.now(),
      sessionId: result.sessionId,
    };
    saveSession(session);
    const accounts = loadAccounts();
    if (!accounts.some(a => a.id === result.account!.id)) {
      const hash = await hashPassword(password);
      saveAccounts([{
        id: result.account.id,
        username: result.account.username,
        email: result.account.email ?? "",
        passwordHash: hash,
        createdAt: Date.now(),
      }, ...accounts]);
    }
    return { session };
  }

  // 2. Explicit server error (wrong password, rate limit, etc.)
  if (result.error && result.error !== "Network error" && result.error !== "Database not configured. Contact admin.") {
    return { error: result.error };
  }

  // 3. Offline fallback — verify against localStorage cache
  const accounts = loadAccounts();
  const account = accounts.find(a => a.username.toLowerCase() === username.trim().toLowerCase());
  if (!account) return { error: "Username not found. Check your connection and try again." };
  const hash = await hashPassword(password);
  if (hash !== account.passwordHash) return { error: "Wrong password." };

  const session: Session = {
    accountId: account.id,
    username: account.username,
    email: account.email,
    loginAt: Date.now(),
    // No sessionId in offline mode — cross-device sync requires internet
  };
  saveSession(session);
  return { session };
}

// ── Register ─────────────────────────────────────────────────────

export type RegisterError = {
  field: "username" | "email" | "password" | "confirm";
  message: string;
};

export async function registerAccount(
  username: string,
  email: string,
  password: string,
  confirmPassword: string
): Promise<{ session: Session } | { error: RegisterError }> {
  username = username.trim();
  email = email.trim().toLowerCase();

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
    return { error: { field: "username", message: "Username must be 3-30 chars, letters/numbers/underscore only." } };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: { field: "email", message: "Enter a valid email address." } };
  if (password.length < 8)
    return { error: { field: "password", message: "Password must be at least 8 characters." } };
  if (password !== confirmPassword)
    return { error: { field: "confirm", message: "Passwords do not match." } };

  // 1. Server registration (primary)
  const result = await callAuth({ action: "register", username, email, password, confirmPassword });
  if (result.ok && result.account && result.sessionId) {
    const session: Session = {
      accountId: result.account.id,
      username: result.account.username,
      email: result.account.email ?? email,
      loginAt: Date.now(),
      sessionId: result.sessionId,
    };
    saveSession(session);
    const hash = await hashPassword(password);
    const accounts = loadAccounts();
    saveAccounts([{
      id: result.account.id,
      username: result.account.username,
      email: result.account.email ?? email,
      passwordHash: hash,
      createdAt: Date.now(),
    }, ...accounts.filter(a => a.id !== result.account!.id)]);
    return { session };
  }

  if (result.error && result.error !== "Network error") {
    const field = (result.field ?? "username") as RegisterError["field"];
    return { error: { field, message: result.error } };
  }

  // 2. Offline fallback
  const accounts = loadAccounts();
  if (accounts.some(a => a.username.toLowerCase() === username.toLowerCase()))
    return { error: { field: "username", message: "Username already taken." } };
  if (accounts.some(a => a.email === email))
    return { error: { field: "email", message: "Email already registered." } };

  const id = await deterministicId(username);
  const passwordHash = await hashPassword(password);
  const account: Account = { id, username, email, passwordHash, createdAt: Date.now() };
  saveAccounts([account, ...accounts]);

  const session: Session = { accountId: id, username, email, loginAt: Date.now() };
  saveSession(session);
  return { session };
}

// ── Session verification against server ──────────────────────────

export async function verifySession(session: Session): Promise<Session | null> {
  if (!session.sessionId) {
    // Old session without server token — force re-login for security
    return null;
  }
  const result = await callAuth({ action: "verify", sessionId: session.sessionId });
  if (!result.ok) return null;
  return session;
}

// ── Logout ────────────────────────────────────────────────────────

export async function logoutFromServer(session: Session): Promise<void> {
  if (!session.sessionId) return;
  try {
    await callAuth({ action: "logout", sessionId: session.sessionId });
  } catch { /* offline — session expires in 30d */ }
}
