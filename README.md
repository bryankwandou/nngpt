# nngpt

A self-hosted, ChatGPT-style chat interface built with **Next.js 15 (App Router)** + **React 19** + **Tailwind v4**, powered by the **Jatevo Balancer** API (OpenAI-compatible).

> Live deploy: https://nngpt.vercel.app

## Features

- ChatGPT-like dark UI (sidebar, conversations, composer, model picker)
- Streaming responses (Edge runtime → SSE → ReadableStream)
- Multiple models: `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5.2`
- LocalStorage conversation history (per-browser, no DB needed)
- Lightweight zero-dependency markdown rendering (code blocks, lists, bold/italic, links)
- Stop / abort streaming mid-response
- Edge runtime → low cold-start on Vercel

## Local development

```bash
npm install
cp .env.example .env.local
# edit .env.local and put your Jatevo Balancer key in OPENAI_API_KEY
npm run dev
# open http://localhost:3000
```

## Environment variables

| Name              | Required | Default                       |
|-------------------|----------|-------------------------------|
| `OPENAI_API_KEY`  | ✓        | —                             |
| `OPENAI_BASE_URL` |          | `https://lb.jatevo.ai/v1`     |

The Jatevo Balancer key looks like `sk-clb-…`. Never commit it.

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
