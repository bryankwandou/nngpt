/**
 * Server-side settings sync (cross-device profile config, WITHOUT api keys).
 * API keys are NEVER stored on the server — they stay in localStorage only.
 *
 * GET  /api/settings?accountId=xxx  — fetch settings (no apiKey fields)
 * POST /api/settings { accountId, settings } — save settings (strips apiKey)
 *
 * Both require: Authorization: Bearer <sessionId>
 */
import { NextRequest } from "next/server";
import {
  hasDb,
  ensureTables,
  dbGetSettings,
  dbSaveSettings,
  dbGetSession,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidAccountId(id: string) {
  return typeof id === "string" && id.length >= 8 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function authSession(req: NextRequest, accountId: string): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    await ensureTables();
    const session = await dbGetSession(token);
    if (!session) return false;
    return session.account_id === accountId;
  } catch {
    return false;
  }
}

type ProfileServer = {
  id: string;
  name: string;
  baseURL: string;
  models: string[];
  defaultModel: string;
  // apiKey intentionally excluded
};

type SettingsServer = {
  profiles: ProfileServer[];
  activeId: string | null;
};

function stripApiKeys(raw: unknown): SettingsServer | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { profiles?: unknown[]; activeId?: unknown };
  if (!Array.isArray(s.profiles)) return null;
  return {
    profiles: s.profiles.map((p: unknown) => {
      const pobj = (p ?? {}) as Record<string, unknown>;
      return {
        id: String(pobj.id ?? ""),
        name: String(pobj.name ?? ""),
        baseURL: String(pobj.baseURL ?? ""),
        models: Array.isArray(pobj.models) ? pobj.models.map(String) : [],
        defaultModel: String(pobj.defaultModel ?? ""),
        // apiKey deliberately NOT included
      };
    }),
    activeId: typeof s.activeId === "string" ? s.activeId : null,
  };
}

// GET /api/settings?accountId=xxx
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? "";

  if (!isValidAccountId(accountId)) {
    return Response.json({ settings: null, error: "invalid accountId" }, { status: 400 });
  }

  if (!hasDb()) {
    return Response.json({ settings: null, reason: "no_db" });
  }

  const ok = await authSession(req, accountId);
  if (!ok) {
    return Response.json({ settings: null, error: "unauthorized" }, { status: 401 });
  }

  try {
    const raw = await dbGetSettings(accountId);
    return Response.json({ settings: raw ? stripApiKeys(raw) : null });
  } catch (err) {
    console.error("[settings GET] db error:", err);
    return Response.json({ settings: null, error: "db_error" }, { status: 500 });
  }
}

// POST /api/settings { accountId, settings }
export async function POST(req: NextRequest) {
  let body: { accountId?: string; settings?: unknown };
  try {
    body = (await req.json()) as { accountId?: string; settings?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { accountId = "", settings } = body;

  if (!isValidAccountId(accountId)) {
    return Response.json({ error: "invalid accountId" }, { status: 400 });
  }

  if (!hasDb()) {
    return Response.json({ ok: true, storage: "local_only" });
  }

  const ok = await authSession(req, accountId);
  if (!ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const stripped = stripApiKeys(settings);
  if (!stripped) {
    return Response.json({ error: "invalid settings format" }, { status: 400 });
  }

  try {
    await dbSaveSettings(accountId, stripped);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[settings POST] db error:", err);
    return Response.json({ ok: false, error: "db_error" }, { status: 500 });
  }
}
