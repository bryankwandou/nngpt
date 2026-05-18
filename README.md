# nngpt

A self-hosted, ChatGPT-style chat interface built with **Next.js 15 (App Router)** + **React 19** + **Tailwind v4**, powered by the **Jatevo Balancer** API (OpenAI-compatible).

> Live deploy: https://nngpt.vercel.app

## Features

- ChatGPT-like dark UI (sidebar, conversations, composer, model picker)
- Streaming responses (SSE → ReadableStream proxy)
- **Settings panel** — bring-your-own-key with multiple API profiles:
  Jatevo Balancer, OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Together AI, or any
  OpenAI-compatible base URL. Test connection, revoke key, import/export JSON.
- LocalStorage conversation history & profiles (per-browser, no DB needed)
- Lightweight zero-dependency markdown rendering (code blocks, lists, bold/italic, links)
- Stop / abort streaming mid-response
- Server env (`OPENAI_API_KEY` + `OPENAI_BASE_URL`) acts as fallback when no per-profile key is set

## Local development

```bash
npm install
cp .env.example .env.local
# edit .env.local and put your Jatevo Balancer key in OPENAI_API_KEY
npm run dev
# open http://localhost:3000
```

## Environment variables (server fallback)

| Name              | Required                                | Default                       |
|-------------------|-----------------------------------------|-------------------------------|
| `OPENAI_API_KEY`  | ✗ (only if no client-side key is set)   | —                             |
| `OPENAI_BASE_URL` |                                         | `https://lb.jatevo.ai/v1`     |

These act as a fallback when the user has not entered a key via the **Settings** panel.
The Jatevo Balancer key looks like `sk-clb-…`. Never commit it.

## Using the Settings panel

Click the gear icon in the sidebar (or top-right) to open Settings. Each **profile** holds:

- **Display name** — e.g. "My OpenAI", "Work Groq"
- **Preset** — pick a provider to autofill base URL + model list (Jatevo, OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Together AI, Custom)
- **Base URL** — must be OpenAI-compatible, e.g. `https://api.openai.com/v1`
- **API key** — stored in `localStorage`, sent on each `/api/chat` request
- **Models** — one per line, edit freely
- **Default model** — which one to pre-select

Buttons:

- **Test connection** — pings `/v1/models` on the base URL with the key, reports OK/fail
- **Revoke key** — clears the API key for that profile (falls back to server env)
- **Set as active** — make this profile the one used for new chats
- **Import / Export** — back up or restore all settings as JSON

## Deploy on Vercel

```bash
vercel link
vercel env add OPENAI_API_KEY production
vercel env add OPENAI_BASE_URL production   # optional
vercel --prod
```

Or import this repo from the Vercel dashboard and set the env vars in **Project → Settings → Environment Variables**.

## Project structure

```
app/
  api/chat/route.ts    Edge SSE proxy → Jatevo Balancer
  page.tsx             Renders <Chat />
  layout.tsx           Root layout
  globals.css          Tailwind + theme tokens
components/
  Chat.tsx             Conversation UI, sidebar, composer
  Markdown.tsx         Minimal MD renderer (no deps)
lib/
  models.ts            Supported model IDs
```

## License

MIT — built by [nayrbryanGaming](https://github.com/nayrbryanGaming).
