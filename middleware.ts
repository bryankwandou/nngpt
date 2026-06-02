import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://nngpt.vercel.app",
  "http://localhost:3000",
  "http://localhost:3010",
  // Vercel preview deployments
  "https://nngpt-",
];

const BLOCKED_UA_PATTERNS = [
  /^python-requests/i,
  /^curl\//i,
  /^wget\//i,
  /^httpie/i,
  /^go-http/i,
  /^java\//i,
  /^libwww/i,
];

// ── Simple in-memory rate limiter: 30 req/min per IP on /api/chat ──
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(ip: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Prune stale entries every 5 minutes to avoid unbounded growth
let lastPrune = Date.now();
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune < 300_000) return;
  lastPrune = now;
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true; // same-origin requests have no Origin header
  return ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (!path.startsWith("/api/")) return NextResponse.next();

  maybePrune();

  const origin = req.headers.get("origin") ?? "";
  const ua = req.headers.get("user-agent") ?? "";

  // ── Method guard for /api/chat ────────────────────────────────
  if (path === "/api/chat" && !["POST", "OPTIONS"].includes(req.method)) {
    return new NextResponse(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── CORS — only allow our own frontends ───────────────────────
  if (origin && !isOriginAllowed(origin)) {
    return new NextResponse(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Rate limits ───────────────────────────────────────────────
  const ip = getClientIp(req);
  if (path === "/api/chat" && req.method === "POST") {
    if (!checkRateLimit(ip, 30, 60_000)) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests. Please wait a moment." }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }
  }
  // Auth: 20 req/min (prevent brute force)
  if (path === "/api/auth" && req.method === "POST") {
    if (!checkRateLimit(`auth:${ip}`, 20, 60_000)) {
      return new NextResponse(
        JSON.stringify({ error: "Too many auth attempts. Wait a minute." }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
      );
    }
  }

  // ── Block obvious bot user-agents on /api/chat ────────────────
  const allowCli = req.headers.get("x-allow-cli") === "true";
  if (!allowCli && path === "/api/chat" && req.method === "POST") {
    const isSuspicious = !ua || BLOCKED_UA_PATTERNS.some((p) => p.test(ua));
    if (isSuspicious) {
      return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── CORS preflight ────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    const allowOrigin = isOriginAllowed(origin) && origin ? origin : ALLOWED_ORIGINS[0];
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const res = NextResponse.next();

  // ── Security headers on ALL API responses ─────────────────────
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-XSS-Protection", "1; mode=block");
  res.headers.set("Permissions-Policy", "camera=self, microphone=self");
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https://lb.jatevo.ai https://jatevo.id https://api.openai.com https://dashscope.aliyuncs.com https://dashscope-intl.aliyuncs.com https://api.groq.com https://openrouter.ai https://api.deepseek.com https://api.mistral.ai https://api.together.xyz",
      "worker-src 'self' blob:",
    ].join("; ")
  );

  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
