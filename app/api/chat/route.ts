import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ChatRequestBody {
  messages: ChatMessage[];
  model: string;
  apiKey?: string;
  baseURL?: string;
}

const SYSTEM_PROMPT =
  "You are nngpt, a helpful and concise assistant. " +
  "Format code in markdown fenced blocks with the language name. " +
  "When given file attachments, analyze them fully. Be direct and accurate.";

function pickCreds(body: ChatRequestBody) {
  const apiKey = (body.apiKey || "").trim() || process.env.OPENAI_API_KEY || "";
  const baseURL = (
    (body.baseURL || "").trim() ||
    process.env.OPENAI_BASE_URL ||
    "https://lb.jatevo.ai/v1"
  ).replace(/\/+$/, "");
  return { apiKey, baseURL };
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { messages, model } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages array is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { apiKey, baseURL } = pickCreds(body);
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error:
          "No API key configured. Open ⚙ Settings → set your API key → Test → Save.",
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  const upstream = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-5.4",
      stream: true,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: `Upstream ${upstream.status}: ${text.slice(0, 500)}` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || !line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") { controller.close(); return; }
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                controller.enqueue(encoder.encode(delta));
              }
            } catch { /* ignore malformed chunks */ }
          }
        }
      } catch (err) { controller.error(err); return; }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
