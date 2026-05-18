import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface TestRequestBody {
  apiKey?: string;
  baseURL?: string;
}

export async function POST(req: NextRequest) {
  let body: TestRequestBody;
  try {
    body = (await req.json()) as TestRequestBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey = (body.apiKey || "").trim() || process.env.OPENAI_API_KEY || "";
  const baseURL = (
    (body.baseURL || "").trim() ||
    process.env.OPENAI_BASE_URL ||
    "https://lb.jatevo.ai/v1"
  ).replace(/\/+$/, "");

  if (!apiKey) return Response.json({ ok: false, error: "Missing API key" }, { status: 400 });
  if (!/^https?:\/\//.test(baseURL))
    return Response.json({ ok: false, error: "Invalid base URL" }, { status: 400 });

  try {
    const res = await fetch(`${baseURL}/models`, {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    if (!res.ok) {
      return Response.json(
        { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` },
        { status: 200 }
      );
    }
    let modelCount: number | undefined;
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json?.data)) modelCount = json.data.length;
    } catch {
      // ok, just no parseable model list
    }
    return Response.json({ ok: true, status: res.status, modelCount });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Network error" },
      { status: 200 }
    );
  }
}
