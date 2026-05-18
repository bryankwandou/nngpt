"use client";

import { useMemo } from "react";

/**
 * Lightweight markdown renderer (no external deps).
 * Supports: fenced code blocks ```lang, inline `code`, **bold**, *italic*,
 * #/##/### headings, - / 1. lists, [text](url), and paragraphs.
 * Escapes HTML on the way in.
 */

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(s: string): string {
  let out = escapeHtml(s);

  // inline code first (so its contents aren't mangled by bold/italic)
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);

  // links [text](url) — only http/https/mailto to avoid xss vectors
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_, text, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="underline decoration-dotted underline-offset-2 hover:text-white text-[var(--color-accent)]">${text}</a>`
  );

  // bold then italic
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return out;
}

interface Block {
  type: "code" | "p" | "h1" | "h2" | "h3" | "ul" | "ol";
  lang?: string;
  text?: string;
  items?: string[];
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
      i++; // skip closing fence (or eof)
      continue;
    }

    // headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push({
        type: (`h${level}` as "h1" | "h2" | "h3"),
        text: h[2],
      });
      i++;
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
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

    // paragraph (collect contiguous non-blank lines until a structural marker)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^```/) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
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
          const lang = b.lang ? `<div class="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-text-dim)]">${escapeHtml(b.lang)}</div>` : "";
          return `<div class="my-3">${lang}<pre><code>${escapeHtml(b.text ?? "")}</code></pre></div>`;
        }
        case "h1":
          return `<h1 class="mb-2 mt-4 text-xl font-semibold">${renderInline(b.text ?? "")}</h1>`;
        case "h2":
          return `<h2 class="mb-2 mt-4 text-lg font-semibold">${renderInline(b.text ?? "")}</h2>`;
        case "h3":
          return `<h3 class="mb-2 mt-3 text-base font-semibold">${renderInline(b.text ?? "")}</h3>`;
        case "ul":
          return `<ul class="my-2 ml-5 list-disc space-y-1">${(b.items ?? [])
            .map((it) => `<li>${renderInline(it)}</li>`)
            .join("")}</ul>`;
        case "ol":
          return `<ol class="my-2 ml-5 list-decimal space-y-1">${(b.items ?? [])
            .map((it) => `<li>${renderInline(it)}</li>`)
            .join("")}</ol>`;
        case "p":
          return `<p class="my-2 whitespace-pre-wrap">${renderInline(b.text ?? "")}</p>`;
        default:
          return "";
      }
    })
    .join("");
}

export default function Markdown({ text }: { text: string }) {
  const html = useMemo(() => blocksToHtml(parseBlocks(text)), [text]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
