"use client";

import { useMemo } from "react";

/**
 * Lightweight markdown renderer (no external deps).
 * Supports: fenced code blocks, inline code, **bold**, *italic*,
 * # headings, -/1. lists, [text](url) links, ![alt](url) images,
 * horizontal rules, and paragraphs.
 */

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_URL = /^(https?:\/\/|mailto:|data:image\/(png|jpeg|gif|webp|svg\+xml);base64,)/i;

function safeUrl(url: string): string {
  return SAFE_URL.test(url.trim()) ? url.trim() : "#";
}

function renderInline(s: string): string {
  let out = escapeHtml(s);

  // inline code (processed first so its contents aren't mangled)
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

  // images ![alt](url) — render before links
  out = out.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)/g,
    (_, alt, url) =>
      `<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}" loading="lazy" class="my-2 max-w-full rounded-xl border border-[var(--color-border)] max-h-[480px] object-contain" />`
  );

  // links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_, text, url) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" ` +
      `class="underline decoration-dotted underline-offset-2 text-[var(--color-accent)] hover:opacity-80">${text}</a>`
  );

  // ~~strikethrough~~
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // **bold**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");

  // *italic* (not preceded by another *)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return out;
}

interface Block {
  type: "code" | "p" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol" | "hr" | "img";
  lang?: string;
  text?: string;
  items?: string[];
  src?: string;
  alt?: string;
}

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      i++;
      continue;
    }

    // horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // standalone image line  ![alt](url)
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)$/);
    if (imgMatch) {
      blocks.push({ type: "img", alt: imgMatch[1], src: imgMatch[2] });
      i++;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: (`h${level}` as "h1" | "h2" | "h3" | "h4"), text: h[2] });
      i++;
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph (collect contiguous non-blank, non-structural lines)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^```/) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^[-*_]{3,}\s*$/.test(lines[i]) &&
      !lines[i].trim().match(/^!\[[^\]]*\]\((https?:\/\/|data:image)[^\s)]+\)$/)
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length > 0) blocks.push({ type: "p", text: buf.join("\n") });
  }
  return blocks;
}

function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "code": {
          const lang = b.lang
            ? `<div class="mb-1 flex items-center justify-between"><span class="text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">${escapeHtml(b.lang)}</span></div>`
            : "";
          return `<div class="my-3">${lang}<pre><code>${escapeHtml(b.text ?? "")}</code></pre></div>`;
        }
        case "h1":
          return `<h1 class="mb-2 mt-5 text-xl font-bold leading-snug">${renderInline(b.text ?? "")}</h1>`;
        case "h2":
          return `<h2 class="mb-2 mt-4 text-lg font-semibold leading-snug">${renderInline(b.text ?? "")}</h2>`;
        case "h3":
          return `<h3 class="mb-1.5 mt-3 text-base font-semibold">${renderInline(b.text ?? "")}</h3>`;
        case "h4":
          return `<h4 class="mb-1 mt-2 text-[14px] font-semibold">${renderInline(b.text ?? "")}</h4>`;
        case "ul":
          return `<ul class="my-2 ml-5 list-disc space-y-1">${(b.items ?? [])
            .map((it) => `<li class="leading-relaxed">${renderInline(it)}</li>`)
            .join("")}</ul>`;
        case "ol":
          return `<ol class="my-2 ml-5 list-decimal space-y-1">${(b.items ?? [])
            .map((it) => `<li class="leading-relaxed">${renderInline(it)}</li>`)
            .join("")}</ol>`;
        case "hr":
          return `<hr class="my-4 border-[var(--color-border)]" />`;
        case "img":
          return `<div class="my-3"><img src="${safeUrl(b.src ?? "")}" alt="${escapeHtml(b.alt ?? "")}" loading="lazy" class="max-w-full rounded-xl border border-[var(--color-border)] max-h-[512px] object-contain" /></div>`;
        case "p":
          return `<p class="my-2 leading-relaxed whitespace-pre-wrap">${renderInline(b.text ?? "")}</p>`;
        default:
          return "";
      }
    })
    .join("");
}

export default function Markdown({ text }: { text: string }) {
  const html = useMemo(() => blocksToHtml(parseBlocks(text)), [text]);
  return (
    <div
      className="prose-sm max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
