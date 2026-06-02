/**
 * Best-effort in-memory rate limiting per serverless instance.
 * For multi-instance production: swap store for Upstash Redis / Vercel KV.
 */

interface Entry { count: number; resetAt: number }

const store = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const e = store.get(key);
  if (!e || now >= e.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (e.count >= max) return { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  e.count++;
  return { ok: true };
}

export function getIpKey(req: { headers: { get(k: string): string | null } }, prefix: string): string {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${prefix}:${ip}`;
}

// Periodic cleanup to prevent unbounded memory growth
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of store) if (now >= e.resetAt) store.delete(k);
  }, 5 * 60_000);
}
