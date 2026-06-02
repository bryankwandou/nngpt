/**
 * Server-side authentication API backed by Neon PostgreSQL.
 *
 * POST /api/auth
 * Body: { action: "login" | "register" | "bootstrap" | "verify" | "logout", ...fields }
 *
 * Passwords are hashed with scrypt (new) with SHA-256 legacy fallback.
 * On login with a legacy SHA-256 hash, the hash is auto-upgraded to scrypt.
 */
import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import {
  hasDb,
  ensureTables,
  dbGetAccountByUsername,
  dbGetAccountById,
  dbUpsertAccount,
  dbUpdatePasswordHash,
  dbCreateSession,
  dbGetSession,
  dbDeleteSession,
  hashPasswordScrypt,
  verifyPassword,
  isLegacyHash,
} from "@/lib/db";
import { checkRateLimit, getIpKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SHA-256 for the bootstrap account only (cross-compatible with client lib/auth.ts)
function hashSha256(password: string): string {
  return createHash("sha256")
    .update(`nngpt::${password}::auth`)
    .digest("hex");
}

function deterministicId(username: string): string {
  return createHash("sha256")
    .update(`nngpt:account-id-v1:${username.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

function genSessionId(): string {
  return randomBytes(32).toString("hex");
}

// ── Input validation ─────────────────────────────────────────────
function validateUsername(u: string): string | null {
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(u))
    return "Username must be 3-30 chars, letters/numbers/underscore only.";
  return null;
}

function validateEmail(e: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Invalid email address.";
  return null;
}

// ── Main handler ─────────────────────────────────────────────────

interface AuthBody {
  action?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  sessionId?: string;
}

export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return Response.json(
      { ok: false, error: "Database not configured. Contact admin." },
      { status: 503 }
    );
  }

  let body: AuthBody;
  try {
    body = (await req.json()) as AuthBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await ensureTables();
  } catch (err) {
    console.error("[auth] ensureTables error:", err);
    return Response.json({ ok: false, error: "DB init failed" }, { status: 500 });
  }

  const { action } = body;

  // ── LOGIN ────────────────────────────────────────────────────
  if (action === "login") {
    // Rate limit: 10 attempts per 15 min per IP
    const rl = checkRateLimit(getIpKey(req, "login"), 10, 15 * 60_000);
    if (!rl.ok) {
      return Response.json(
        { ok: false, error: `Too many login attempts. Try again in ${rl.retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const username = (body.username ?? "").trim();
    const password = body.password ?? "";

    if (!username || !password) {
      return Response.json({ ok: false, error: "Username and password required." }, { status: 400 });
    }

    const account = await dbGetAccountByUsername(username);
    if (!account) {
      return Response.json({ ok: false, error: "Username not found." }, { status: 401 });
    }

    if (!verifyPassword(password, account.password_hash)) {
      return Response.json({ ok: false, error: "Wrong password." }, { status: 401 });
    }

    // Auto-upgrade legacy SHA-256 hash to scrypt on successful login
    if (isLegacyHash(account.password_hash)) {
      try {
        const newHash = hashPasswordScrypt(password);
        await dbUpdatePasswordHash(account.id, newHash);
      } catch { /* non-critical */ }
    }

    const sessionId = genSessionId();
    await dbCreateSession(sessionId, account.id, account.username, account.email ?? "");

    return Response.json({
      ok: true,
      sessionId,
      account: {
        id: account.id,
        username: account.username,
        email: account.email,
      },
    });
  }

  // ── REGISTER ─────────────────────────────────────────────────
  if (action === "register") {
    // Rate limit: 5 registrations per hour per IP
    const rl = checkRateLimit(getIpKey(req, "register"), 5, 60 * 60_000);
    if (!rl.ok) {
      return Response.json(
        { ok: false, error: `Too many registrations. Try again in ${rl.retryAfter}s.` },
        { status: 429 }
      );
    }

    const username = (body.username ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const confirm = body.confirmPassword ?? "";

    const uErr = validateUsername(username);
    if (uErr) return Response.json({ ok: false, field: "username", error: uErr }, { status: 400 });

    const eErr = validateEmail(email);
    if (eErr) return Response.json({ ok: false, field: "email", error: eErr }, { status: 400 });

    if (password.length < 8)
      return Response.json({ ok: false, field: "password", error: "Password must be at least 8 characters." }, { status: 400 });

    if (password !== confirm)
      return Response.json({ ok: false, field: "confirm", error: "Passwords do not match." }, { status: 400 });

    const existing = await dbGetAccountByUsername(username);
    if (existing) {
      return Response.json({ ok: false, field: "username", error: "Username already taken." }, { status: 409 });
    }

    const id = deterministicId(username);
    const passwordHash = hashPasswordScrypt(password);
    await dbUpsertAccount(id, username, email, passwordHash);

    const sessionId = genSessionId();
    await dbCreateSession(sessionId, id, username, email);

    return Response.json({
      ok: true,
      sessionId,
      account: { id, username, email },
    });
  }

  // ── BOOTSTRAP (create default nayrbryanGaming account if missing) ──
  if (action === "bootstrap") {
    const id = deterministicId("nayrbryanGaming");
    const existing = await dbGetAccountById(id);
    if (!existing) {
      // Store SHA-256 initially; will be auto-upgraded to scrypt on first login
      const passwordHash = hashSha256("@Nataliamaria12345");
      await dbUpsertAccount(id, "nayrbryanGaming", "nayrbryangaming3@gmail.com", passwordHash);
    }
    // Return only the id — no session (login requires explicit password)
    return Response.json({ ok: true, id });
  }

  // ── VERIFY SESSION ───────────────────────────────────────────
  if (action === "verify") {
    const sessionId = body.sessionId ?? "";
    if (!sessionId) return Response.json({ ok: false, error: "No sessionId" }, { status: 400 });

    const session = await dbGetSession(sessionId);
    if (!session) return Response.json({ ok: false, error: "Session expired or invalid." }, { status: 401 });

    return Response.json({
      ok: true,
      account: {
        id: session.account_id,
        username: session.username,
        email: session.email,
      },
    });
  }

  // ── LOGOUT ───────────────────────────────────────────────────
  if (action === "logout") {
    const sessionId = body.sessionId ?? "";
    if (sessionId) await dbDeleteSession(sessionId);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
