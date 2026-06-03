/**
 * Bot → Vercel API key sync endpoint.
 *
 * POST /api/sync-keys
 * Headers: x-sync-token: <SYNC_SECRET>
 * Body: { gpt?, qwen?, claude?, telegram? }
 *
 * Stores keys under admin account's settings in Neon DB.
 * Dashboard reads from here if env vars are not set.
 *
 * SYNC_SECRET must be set as a Vercel env var.
 * Set the same secret in .env: NNGPT_SYNC_SECRET=<random>
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { hasDb, ensureTables, dbGetSettings, dbSaveSettings } from "@/lib/db";
import { checkRateLimit, getIpKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminAccountId(): string {
  return createHash("sha256")
    .update("nngpt:account-id-v1:nayrbryangaming")
    .digest("hex")
    .slice(0, 32);
}

interface SyncBody {
  gpt?: string;
  qwen?: string;
  claude?: string;
  telegram?: string;
}

export async function POST(req: NextRequest) {
  // Rate limit: 20 syncs per hour per IP (bot restarts, /setapi calls, etc.)
  const rl = checkRateLimit(getIpKey(req, "sync"), 20, 60 * 60_000);
  if (!rl.ok) {
    return Response.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  // Auth: require SYNC_SECRET in x-sync-token header
  const syncSecret = process.env.NNGPT_SYNC_SECRET ?? "";
  if (!syncSecret) {
    return Response.json({ error: "Sync not configured on server (NNGPT_SYNC_SECRET not set)." }, { status: 503 });
  }

  const providedToken = req.headers.get("x-sync-token") ?? "";
  if (!providedToken || providedToken !== syncSecret) {
    return Response.json({ error: "Invalid sync token." }, { status: 401 });
  }

  if (!hasDb()) {
    return Response.json({ error: "Database not configured." }, { status: 503 });
  }

  let body: SyncBody;
  try { body = (await req.json()) as SyncBody; } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Validate: all values must be non-empty strings if provided
  const allowed = ["gpt", "qwen", "claude", "telegram"] as const;
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

    // Merge with existing settings
    const existing = (await dbGetSettings(adminId)) as Record<string, unknown> | null ?? {};
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
