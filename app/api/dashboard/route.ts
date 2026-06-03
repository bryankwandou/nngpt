/**
 * Admin dashboard data API.
 * Requires: Authorization: Bearer <sessionId> from nayrbryanGaming account.
 *
 * Returns:
 * - GPT (Jatevo LB) key + base URL (truncated for display)
 * - Qwen (Jatevo Direct / Alibaba) key + base URL
 * - Telegram bot token (truncated)
 * - Live usage from Jatevo LB API (tries multiple endpoint variants)
 * - Synced keys pushed by bot via /api/sync-keys
 */
import { NextRequest } from "next/server";
import { hasDb, ensureTables, dbGetSession, dbGetSettings } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ADMIN_USERNAME = "nayrbryanGaming";

async function verifyAdminSession(req: NextRequest): Promise<boolean> {
  if (!hasDb()) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    await ensureTables();
    const session = await dbGetSession(token);
    if (!session) return false;
    return session.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
  } catch {
    return false;
  }
}

/** Try multiple Jatevo LB usage endpoints and return first success */
async function fetchJatevoUsage(apiKey: string, baseUrl: string): Promise<{ usage: unknown; requests: unknown }> {
  // Jatevo LB API base (remove trailing /v1 or /chat/completions)
  const root = baseUrl
    .replace(/\/chat\/completions\/?$/, "")
    .replace(/\/v1\/?$/, "");

  const usageEndpoints = [
    `${root}/usage`,
    `${root}/v1/usage`,
    `${root}/api/usage`,
    `${root}/dashboard/usage`,
    `${root}/v1/dashboard/billing/usage`,
  ];

  const requestsEndpoints = [
    `${root}/requests?limit=50`,
    `${root}/v1/requests?limit=50`,
    `${root}/api/requests?limit=50`,
  ];

  const headers = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  let usage: unknown = null;
  let requests: unknown = null;

  for (const url of usageEndpoints) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) { usage = await r.json(); break; }
    } catch { /* try next */ }
  }

  for (const url of requestsEndpoints) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (r.ok) { requests = await r.json(); break; }
    } catch { /* try next */ }
  }

  return { usage, requests };
}

/** Truncate key for display: show first 12 + last 4 chars */
function truncateKey(key: string): string {
  if (!key) return "";
  if (key.length <= 20) return key.slice(0, 8) + "…";
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdminSession(req);
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Keys from Vercel environment variables
  const gptKey     = process.env.OPENAI_API_KEY ?? "";       // Jatevo LB key
  const gptBaseUrl = (process.env.OPENAI_BASE_URL ?? "https://lb.jatevo.ai/v1").replace(/\/chat\/completions\/?$/, "");

  // Qwen: check QWEN_API_KEY, then JATEVO_API_KEY, then fall back to OPENAI_API_KEY (Jatevo LB also routes Qwen3)
  const qwenKeyDedicated = process.env.QWEN_API_KEY ?? process.env.JATEVO_API_KEY ?? "";
  const qwenUsesLbFallback = !qwenKeyDedicated && Boolean(gptKey);
  const qwenKey    = qwenKeyDedicated || (qwenUsesLbFallback ? gptKey : "");
  const qwenBaseUrl = process.env.QWEN_BASE_URL
    ?? (process.env.JATEVO_BASE_URL
      ? process.env.JATEVO_BASE_URL.replace(/\/chat\/completions\/?$/, "")
      : (qwenUsesLbFallback ? (process.env.OPENAI_BASE_URL ?? "https://lb.jatevo.ai/v1").replace(/\/chat\/completions\/?$/, "") : "https://jatevo.id/api/open/v1/inference"));
  const qwenModel  = process.env.QWEN_MODEL ?? process.env.JATEVO_MODEL ?? "qwen3.5-plus";

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

  // Fetch synced keys from DB (pushed by bot via /api/sync-keys)
  let syncedKeys: Record<string, string> = {};
  try {
    await ensureTables();
    const adminIdBuf = await (await import("crypto")).default
      .createHash("sha256")
      .update(`nngpt:account-id-v1:nayrbryangaming`)
      .digest("hex")
      .slice(0, 32);

    const raw = await dbGetSettings(adminIdBuf);
    if (raw && typeof raw === "object") {
      const s = raw as Record<string, unknown>;
      if (s._syncedKeys && typeof s._syncedKeys === "object") {
        syncedKeys = s._syncedKeys as Record<string, string>;
      }
    }
  } catch { /* non-critical */ }

  // Merge: env vars > synced keys from bot
  const effectiveGptKey  = gptKey  || syncedKeys.gpt  || "";
  const effectiveQwenKey = qwenKey || syncedKeys.qwen || (effectiveGptKey ? effectiveGptKey : "");
  const effectiveTgToken = telegramToken || syncedKeys.telegram || "";

  // Fetch real usage from Jatevo LB API
  const { usage, requests } = effectiveGptKey
    ? await fetchJatevoUsage(effectiveGptKey, gptBaseUrl).catch(() => ({ usage: null, requests: null }))
    : { usage: null, requests: null };

  return Response.json({
    gpt_key:      truncateKey(effectiveGptKey),
    gpt_key_full: effectiveGptKey,
    gpt_base_url: gptBaseUrl,

    qwen_key:          truncateKey(effectiveQwenKey),
    qwen_key_full:     effectiveQwenKey,
    qwen_base_url:     qwenBaseUrl,
    qwen_model:        qwenModel,
    qwen_uses_lb:      qwenUsesLbFallback,  // true = using LB key as Qwen fallback

    telegram_token:      effectiveTgToken ? `${effectiveTgToken.split(":")[0]}:****` : "",
    telegram_token_full: effectiveTgToken,

    usage,
    requests,
    qwen_usage: null,
    synced_from_bot: Object.keys(syncedKeys).length > 0,
    missing_vars: [
      ...(!process.env.JATEVO_API_KEY && !process.env.QWEN_API_KEY ? ["JATEVO_API_KEY or QWEN_API_KEY"] : []),
      ...(!process.env.TELEGRAM_BOT_TOKEN && !syncedKeys.telegram ? ["TELEGRAM_BOT_TOKEN"] : []),
    ],
    fetched_at: new Date().toISOString(),
  });
}

export async function POST() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
