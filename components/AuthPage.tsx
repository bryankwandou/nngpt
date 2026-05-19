"use client";

import { useEffect, useState } from "react";
import {
  ensureDefaultAccount,
  loginWithPassword,
  registerAccount,
  type Session,
  type RegisterError,
} from "@/lib/auth";

interface Props {
  onLogin: (session: Session) => void;
}

export default function AuthPage({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | RegisterError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ensureDefaultAccount();
  }, []);

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const result = await loginWithPassword(username, password);
        if ("error" in result) setError(result.error);
        else onLogin(result.session);
      } else {
        const result = await registerAccount(username, email, password, confirm);
        if ("error" in result) setError(result.error);
        else onLogin(result.session);
      }
    } finally {
      setLoading(false);
    }
  }

  function fieldErr(field: RegisterError["field"]): string | null {
    if (!error || typeof error === "string") return null;
    return error.field === field ? error.message : null;
  }
  const globalErr = typeof error === "string" ? error : null;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="w-full max-w-sm rounded-2xl border border-[#2f2f2f] bg-[#1a1a1a] p-8 shadow-2xl">
        {/* Logo */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[#3a3a3a]">
            <SparkleIcon />
          </div>
          <h1 className="text-xl font-semibold">nngpt</h1>
          <p className="mt-1 text-sm text-[var(--color-text-dim)]">
            {mode === "login" ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex rounded-lg bg-[#2a2a2a] p-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === "login"
                ? "bg-[#3a3a3a] text-[var(--color-text)]"
                : "text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              mode === "register"
                ? "bg-[#3a3a3a] text-[var(--color-text)]"
                : "text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Username */}
          <div>
            <label
              htmlFor="auth-username"
              className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]"
            >
              Username
            </label>
            <input
              id="auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              spellCheck={false}
              placeholder="nayrbryanGaming"
              className={`w-full rounded-lg border px-3 py-2.5 bg-[#2a2a2a] text-sm outline-none transition-colors placeholder:text-[#555] focus:border-[#5a5a5a] ${
                fieldErr("username") ? "border-red-500" : "border-[#3a3a3a]"
              }`}
            />
            {fieldErr("username") && (
              <p className="mt-1 text-xs text-red-400">{fieldErr("username")}</p>
            )}
          </div>

          {/* Email (register only) */}
          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-email"
                className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]"
              >
                Email
              </label>
              <input
                id="auth-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className={`w-full rounded-lg border px-3 py-2.5 bg-[#2a2a2a] text-sm outline-none transition-colors placeholder:text-[#555] focus:border-[#5a5a5a] ${
                  fieldErr("email") ? "border-red-500" : "border-[#3a3a3a]"
                }`}
              />
              {fieldErr("email") && (
                <p className="mt-1 text-xs text-red-400">{fieldErr("email")}</p>
              )}
            </div>
          )}

          {/* Password */}
          <div>
            <label
              htmlFor="auth-password"
              className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]"
            >
              Password
            </label>
            <input
              id="auth-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              className={`w-full rounded-lg border px-3 py-2.5 bg-[#2a2a2a] text-sm outline-none transition-colors placeholder:text-[#555] focus:border-[#5a5a5a] ${
                fieldErr("password") ? "border-red-500" : "border-[#3a3a3a]"
              }`}
            />
            {fieldErr("password") && (
              <p className="mt-1 text-xs text-red-400">{fieldErr("password")}</p>
            )}
          </div>

          {/* Confirm password (register only) */}
          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-confirm"
                className="mb-1.5 block text-sm font-medium text-[var(--color-text-secondary)]"
              >
                Confirm password
              </label>
              <input
                id="auth-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                required
                autoComplete="new-password"
                placeholder="••••••••"
                className={`w-full rounded-lg border px-3 py-2.5 bg-[#2a2a2a] text-sm outline-none transition-colors placeholder:text-[#555] focus:border-[#5a5a5a] ${
                  fieldErr("confirm") ? "border-red-500" : "border-[#3a3a3a]"
                }`}
              />
              {fieldErr("confirm") && (
                <p className="mt-1 text-xs text-red-400">{fieldErr("confirm")}</p>
              )}
            </div>
          )}

          {globalErr && (
            <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
              {globalErr}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:opacity-50"
          >
            {loading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
              ? "Sign in"
              : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--color-text-dim)]">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("register")}
                className="text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.5L19 9l-5.2 1.5L12 16l-1.8-5.5L5 9l5.2-1.5L12 2zm6 13l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
    </svg>
  );
}
