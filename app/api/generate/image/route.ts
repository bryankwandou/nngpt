import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ImageGenBody {
  prompt?: string;
  model?: string;
  size?: string;
  quality?: string;
  apiKey?: string;
  baseURL?: string;
}

export async function POST(req: NextRequest) {
  let body: ImageGenBody;
  try {
    body = (await req.json()) as ImageGenBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return Response.json({ error: "Prompt too long (max 4000 chars)" }, { status: 400 });
  }

  const apiKey = (body.apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json(
      { error: "No API key configured. Open Settings → add an OpenAI API key." },
      { status: 401 }
    );
  }

  const baseURL = (
    body.baseURL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  const model = body.model || "dall-e-3";
  const size = body.size || "1024x1024";
  const quality = body.quality || "standard";

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${baseURL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        quality,
        response_format: "url",
      }),
    });
  } catch (err) {
    return Response.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }

  if (!upstreamRes.ok) {
    const text = await upstreamRes.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      if (j?.error?.message) detail = j.error.message;
    } catch {}
    return Response.json(
      { error: `Image API error (${upstreamRes.status}): ${detail}` },
      { status: 502 }
    );
  }

  interface ImgGenResponse {
    data?: { url?: string; b64_json?: string; revised_prompt?: string }[];
  }

  const data = (await upstreamRes.json()) as ImgGenResponse;
  const item = data?.data?.[0];
  if (!item?.url && !item?.b64_json) {
    return Response.json({ error: "No image returned from provider" }, { status: 502 });
  }

  return Response.json({
    url: item.url ?? null,
    b64_json: item.b64_json ?? null,
    revised_prompt: item.revised_prompt ?? null,
  });
}
