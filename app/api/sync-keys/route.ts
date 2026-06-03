/**
 * Bot → nngpt Dashboard key sync endpoint.
 *
 * Accepts TWO auth methods (no Vercel env vars required for either):
 *
 * Method A — Admin session token (RECOMMENDED, zero Vercel config):
 *   Authorization: Bearer <sessionId>   (from /api/auth login)
 *   Body: { gpt?, qwen?, claude?, telegram?, jatevo? }
 *
 * Method B — Shared secret (optional, requires NNGPT_SYNC_SECRET in Vercel):
 *   x-sync-token: <NNGPT_SYNC_SECRET>
 *   Body: { gpt?, qwen?, claude?, telegram?, jatevo? }
 *
 * Keys are stored in Neon DB under admin account settings.
 * Dashboard reads them as fallback when env vars are not set.
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { hasDb, ensureTables, dbGetSession, dbGetSettings, dbSaveSettings } from "@/lib/db";
import { checkRateLimit, getIpKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_USERNAME = "nayrbryanGaming";

function getAdminAccountId(): string {
  return createHash("sha256")
    .update("nngpt:account-id-v1:nayrbryangaming")
    .digest("hex")
    .slice(0, 32);
}

interface SyncBody {
  gpt?: string;
  qwen?: string;
  jatevo?: string;
  claude?: string;
  telegram?: string;
}

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const auth      = req.headers.get("authorization") ?? "";
  const sessionId = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const syncToken = req.headers.get("x-sync-token") ?? "";

  // Method A: admin session token
  if (sessionId) {
    try {
      await ensureTables();
      const session = await dbGetSession(sessionId);
      return session !== null && session.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
    } catch { /* fall through */ }
  }

  // Method B: shared secret from Vercel env var (optional)
  const secret = process.env.NNGPT_SYNC_SECRET ?? "";
  if (secret && syncToken && syncToken === secret) return true;

  return false;
}

export async function POST(req: NextRequest) {
  // Rate limit: 60 syncs per hour per IP (covers bot restarts)
  const rl = checkRateLimit(getIpKey(req, "sync"), 60, 60 * 60_000);
  if (!rl.ok) {
    return Response.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  if (!hasDb()) {
    return Response.json({ error: "Database not configured." }, { status: 503 });
  }

  const ok = await verifyAuth(req);
  if (!ok) {
    return Response.json({ error: "Invalid session or sync token. Bot must use NNGPT_ADMIN_PASSWORD to log in first." }, { status: 401 });
  }

  let body: SyncBody;
  try { body = (await req.json()) as SyncBody; } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const allowed = ["gpt", "qwen", "jatevo", "claude", "telegram"] as const;
  const toSync: Record<string, string> = {};
  for (const k of allowed) {
    if (body[k] && typeof body[k] === "string" && body[k]!.trim().length > 0) {
      toSync[k] = body[k]!.trim();
    }
  }

  if (Object.keys(toSync).length === 0) {
    return Response.json({ error: "No keys to sync." }, { status: 400 });
  }

  try {
    await ensureTables();
    const adminId = getAdminAccountId();
    const existing = ((await dbGetSettings(adminId)) as Record<string, unknown>) ?? {};
    const existingSynced = (existing._syncedKeys as Record<string, string>) ?? {};
    const merged = { ...existing, _syncedKeys: { ...existingSynced, ...toSync } };
    await dbSaveSettings(adminId, merged);

    return Response.json({
      ok: true,
      synced: Object.keys(toSync),
      message: `Synced ${Object.keys(toSync).join(", ")} to dashboard.`,
    });
  } catch (err) {
    console.error("[sync-keys] error:", err);
    return Response.json({ error: "Database error." }, { status: 500 });
  }
}
