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
}

const ACCOUNTS_KEY = "nngpt:accounts:v1";
const SESSION_KEY = "nngpt:session:v1";

// ── Crypto ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  // deterministic salt so same password → same hash for this app
  const data = encoder.encode(`nngpt::${password}::auth`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ── Accounts persistence ─────────────────────────────────────────────────────

export function loadAccounts(): Account[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Account[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: Account[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore quota
  }
}

// ── Session persistence ──────────────────────────────────────────────────────

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

// ── Default account ──────────────────────────────────────────────────────────

export async function ensureDefaultAccount(): Promise<void> {
  const accounts = loadAccounts();
  const exists = accounts.some(
    (a) => a.username.toLowerCase() === "nayrbryangaming"
  );
  if (exists) return;

  const hash = await hashPassword("@Nataliamaria12345");
  const account: Account = {
    id: uid(),
    username: "nayrbryanGaming",
    email: "nayrbryangaming3@gmail.com",
    passwordHash: hash,
    createdAt: Date.now(),
  };
  saveAccounts([account, ...accounts]);
}

// ── Auth operations ──────────────────────────────────────────────────────────

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{ session: Session } | { error: string }> {
  const accounts = loadAccounts();
  const account = accounts.find(
    (a) => a.username.toLowerCase() === username.trim().toLowerCase()
  );
  if (!account) return { error: "Username not found." };

  const hash = await hashPassword(password);
  if (hash !== account.passwordHash) return { error: "Wrong password." };

  const session: Session = {
    accountId: account.id,
    username: account.username,
    email: account.email,
    loginAt: Date.now(),
  };
  saveSession(session);
  return { session };
}

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
    return {
      error: {
        field: "username",
        message: "Username must be 3-30 characters, letters/numbers/underscore only.",
      },
    };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: { field: "email", message: "Enter a valid email address." } };

  if (password.length < 8)
    return { error: { field: "password", message: "Password must be at least 8 characters." } };

  if (password !== confirmPassword)
    return { error: { field: "confirm", message: "Passwords do not match." } };

  const accounts = loadAccounts();
  if (accounts.some((a) => a.username.toLowerCase() === username.toLowerCase()))
    return { error: { field: "username", message: "Username already taken." } };

  if (accounts.some((a) => a.email === email))
    return { error: { field: "email", message: "Email already registered." } };

  const passwordHash = await hashPassword(password);
  const account: Account = {
    id: uid(),
    username,
    email,
    passwordHash,
    createdAt: Date.now(),
  };
  saveAccounts([account, ...accounts]);

  const session: Session = {
    accountId: account.id,
    username: account.username,
    email: account.email,
    loginAt: Date.now(),
  };
  saveSession(session);
  return { session };
}
