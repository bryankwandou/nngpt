/**
 * Image generation endpoint.
 *
 * Strategy (tried in order):
 * 1. If client key is a real OpenAI key (sk-... not sk-clb-), use OpenAI DALL-E directly
 * 2. Try client baseURL + /images/generations (in case the LB supports it)
 * 3. Try Jatevo LB OPENAI_BASE_URL + /images/generations
 * 4. Try direct OpenAI api.openai.com (if OPENAI_API_KEY looks like real OpenAI)
 * 5. Fall back to Pollinations.AI (free, no key required) for demonstration
 */
import { NextRequest } from "next/server";
import { hasDb, dbGetSession } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface ImageGenBody {
  prompt?: string;
  model?: string;
  size?: string;
  quality?: string;
  apiKey?: string;
  baseURL?: string;
}

/** Returns true if the key looks like a real OpenAI key (not Jatevo LB) */
function isRealOpenAIKey(key: string): boolean {
  if (!key) return false;
  // Jatevo LB keys start with sk-clb-
  if (key.startsWith("sk-clb-") || key.startsWith("sk-jt-")) return false;
  // Real OpenAI keys start with sk- but not sk-clb-
  return key.startsWith("sk-");
}

function isJatevoPlatformURL(url: string): boolean {
  return url.includes("jatevo") || url.includes("lb.jatevo") || url.includes("inference.jatevo");
}

async function tryImageGen(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response | null> {
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) return r;
    if (r.status === 401 || r.status === 403) return null; // wrong key
    // 400/422 = key works but model/params issue — still return the error
    if (r.status === 400 || r.status === 422) return r;
    return null;
  } catch {
    return null;
  }
}

/** Pollinations.AI — free, no API key, returns direct image URL */
function pollinationsUrl(prompt: string): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true`;
}

/** Verify session for server-key fallback */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  if (!hasDb()) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    const { ensureTables } = await import("@/lib/db");
    await ensureTables();
    const session = await dbGetSession(token);
    return session !== null;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  let body: ImageGenBody;
  try {
    body = (await req.json()) as ImageGenBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  if (prompt.length > 4000) return Response.json({ error: "Prompt too long (max 4000 chars)" }, { status: 400 });

  const clientKey = (body.apiKey || "").trim();
  const clientBaseURL = (body.baseURL || "").trim().replace(/\/+$/, "");

  const serverKey = process.env.OPENAI_API_KEY ?? "";
  const serverBaseURL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");

  // For server key fallback, require session auth
  if (!clientKey && serverKey) {
    const sessionOk = await hasValidSession(req);
    if (!sessionOk) {
      return Response.json(
        { error: "Please log in to use server image generation, or configure your own OpenAI API key in Settings." },
        { status: 401 }
      );
    }
  }

  const imageBody = {
    model: body.model || "dall-e-3",
    prompt,
    n: 1,
    size: body.size || "1024x1024",
    quality: body.quality || "standard",
    response_format: "url",
  };

  // ── Strategy: build list of endpoints to try in order ──────────
  const attempts: { url: string; key: string; label: string }[] = [];

  // 1. Client key with real OpenAI endpoint (if key looks like real OpenAI)
  if (clientKey && isRealOpenAIKey(clientKey)) {
    // If the client also provided a baseURL, try that first
    if (clientBaseURL && !isJatevoPlatformURL(clientBaseURL)) {
      attempts.push({ url: `${clientBaseURL}/images/generations`, key: clientKey, label: "client-custom" });
    }
    attempts.push({ url: "https://api.openai.com/v1/images/generations", key: clientKey, label: "openai-direct" });
  }

  // 2. Client key with client baseURL (might be a platform that supports image gen)
  if (clientKey && clientBaseURL) {
    attempts.push({ url: `${clientBaseURL}/images/generations`, key: clientKey, label: "client-baseurl" });
  }

  // 3. Server key — if it's a real OpenAI key, use OpenAI directly
  if (serverKey && isRealOpenAIKey(serverKey)) {
    attempts.push({ url: "https://api.openai.com/v1/images/generations", key: serverKey, label: "server-openai" });
  }

  // 4. Server key with server baseURL (Jatevo LB — unlikely to support DALL-E but worth trying)
  if (serverKey && !attempts.some(a => a.label === "client-baseurl" && a.key === serverKey)) {
    attempts.push({ url: `${serverBaseURL}/images/generations`, key: serverKey, label: "server-baseurl" });
  }

  // Try all real API attempts
  let lastError = "";
  for (const attempt of attempts) {
    const res = await tryImageGen(attempt.url, attempt.key, imageBody);
    if (!res) continue;

    if (res.ok) {
      interface ImgResp { data?: { url?: string; b64_json?: string; revised_prompt?: string }[] }
      const data = (await res.json()) as ImgResp;
      const item = data?.data?.[0];
      if (item?.url || item?.b64_json) {
        return Response.json({
          url: item.url ?? null,
          b64_json: item.b64_json ?? null,
          revised_prompt: item.revised_prompt ?? null,
          provider: attempt.label,
        });
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let detail = text.slice(0, 200);
      try { const j = JSON.parse(text); if (j?.error?.message) detail = j.error.message; } catch {}
      lastError = `${attempt.label} (${res.status}): ${detail}`;
    }
  }

  // ── Fallback: Pollinations.AI (free, no key needed) ─────────────
  // Returns a direct image URL — no API call needed
  const pollinUrl = pollinationsUrl(prompt);

  // Verify it's reachable (HEAD request)
  try {
    const check = await fetch(pollinUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (check.ok || check.status === 200 || check.redirected) {
      return Response.json({
        url: pollinUrl,
        b64_json: null,
        revised_prompt: null,
        provider: "pollinations-free",
        notice: "Generated via Pollinations.AI (free). For higher quality, add an OpenAI API key in Settings → Image generation.",
      });
    }
  } catch { /* if pollinations fails, fall through */ }

  // Last resort: return the Pollinations URL anyway (images often load even if HEAD fails)
  return Response.json({
    url: pollinUrl,
    b64_json: null,
    revised_prompt: null,
    provider: "pollinations-free",
    notice: lastError
      ? `Note: paid providers failed (${lastError}). Using Pollinations.AI free fallback.`
      : "Using Pollinations.AI free generation. Add an OpenAI key in Settings for DALL-E quality.",
  });
}
