/**
 * Admin dashboard data endpoint.
 * Requires: Authorization: Bearer <sessionId> from nayrbryanGaming account.
 * Returns real Jatevo usage data (keys served from server env, not stored in DB).
 */
import { NextRequest } from "next/server";
import { hasDb, ensureTables, dbGetSession } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdminSession(req);
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gptKey = process.env.OPENAI_API_KEY ?? "";
  const gptBaseUrl = process.env.OPENAI_BASE_URL ?? "https://lb.jatevo.ai/v1";
  const qwenKey = process.env.QWEN_API_KEY ?? process.env.JATEVO_API_KEY ?? "";
  const qwenBaseUrl = process.env.QWEN_BASE_URL ?? "https://jatevo.id/api/open/v1/inference";
  const qwenModel = process.env.QWEN_MODEL ?? "qwen3.5-plus";
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN ?? "";

  // Attempt to fetch live usage from Jatevo API
  let usage = null;
  let requests = null;
  if (gptKey && gptBaseUrl) {
    try {
      const [usageRes, reqsRes] = await Promise.allSettled([
        fetch(`${gptBaseUrl.replace(/\/v1\/?$/, "")}/usage`, {
          headers: { authorization: `Bearer ${gptKey}` },
        }),
        fetch(`${gptBaseUrl.replace(/\/v1\/?$/, "")}/requests?limit=50`, {
          headers: { authorization: `Bearer ${gptKey}` },
        }),
      ]);
      if (usageRes.status === "fulfilled" && usageRes.value.ok) {
        usage = await usageRes.value.json();
      }
      if (reqsRes.status === "fulfilled" && reqsRes.value.ok) {
        requests = await reqsRes.value.json();
      }
    } catch { /* non-fatal */ }
  }

  return Response.json({
    gpt_key: gptKey ? `${gptKey.slice(0, 8)}…${gptKey.slice(-4)}` : "",
    gpt_base_url: gptBaseUrl,
    qwen_key: qwenKey ? `${qwenKey.slice(0, 8)}…${qwenKey.slice(-4)}` : "",
    qwen_base_url: qwenBaseUrl,
    qwen_model: qwenModel,
    telegram_token: telegramToken ? `${telegramToken.split(":")[0]}:****` : "",
    usage,
    requests,
    qwen_usage: null,
    fetched_at: new Date().toISOString(),
  });
}

export async function POST() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
