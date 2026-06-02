"use client";

import { useState, useCallback, useMemo } from "react";

/* ─── HTML helpers ──────────────────────────────────────────────── */

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

/* ─── Syntax highlighting ───────────────────────────────────────── */

type LangFamily = "js" | "py" | "css" | "html" | "sql" | "sh" | "rust" | "go" | "other";

function getLang(lang: string): LangFamily {
  const l = lang.toLowerCase();
  if (["js","ts","jsx","tsx","javascript","typescript","mjs","cjs","json","jsonc"].includes(l)) return "js";
  if (["py","python"].includes(l)) return "py";
  if (["css","scss","sass","less"].includes(l)) return "css";
  if (["html","htm","xml","svg"].includes(l)) return "html";
  if (["sql","mysql","pgsql","postgresql","sqlite"].includes(l)) return "sql";
  if (["sh","bash","zsh","shell","fish","powershell","ps1","bat","cmd"].includes(l)) return "sh";
  if (["rs","rust"].includes(l)) return "rust";
  if (["go","golang"].includes(l)) return "go";
  return "other";
}

const KW_JS = new Set(["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","class","new","import","export","from","as","default","async","await","try","catch","finally","throw","typeof","instanceof","in","of","delete","void","null","undefined","true","false","this","super","extends","static","get","set","yield","type","interface","enum","namespace","declare","abstract","readonly","private","public","protected","override"]);
const KW_PY = new Set(["def","class","return","if","elif","else","for","while","break","continue","import","from","as","try","except","finally","raise","with","yield","lambda","pass","del","global","nonlocal","assert","in","is","not","and","or","True","False","None"]);
const KW_SQL = new Set(["SELECT","FROM","WHERE","JOIN","LEFT","RIGHT","INNER","OUTER","FULL","CROSS","ON","GROUP","ORDER","BY","HAVING","LIMIT","OFFSET","INSERT","INTO","VALUES","UPDATE","SET","DELETE","CREATE","TABLE","VIEW","INDEX","DROP","ALTER","ADD","COLUMN","PRIMARY","KEY","FOREIGN","REFERENCES","UNIQUE","NOT","NULL","DEFAULT","AND","OR","IN","LIKE","BETWEEN","IS","AS","DISTINCT","COUNT","SUM","AVG","MAX","MIN","CASE","WHEN","THEN","ELSE","END","UNION","ALL","WITH","EXISTS","RETURNING"]);
const KW_CSS = new Set(["auto","none","inherit","initial","unset","block","inline","flex","grid","absolute","relative","fixed","sticky","static","hidden","visible","scroll","overflow","important","normal","bold","italic"]);
const KW_SH  = new Set(["if","then","else","elif","fi","for","while","do","done","case","esac","in","function","return","echo","exit","export","source","alias","unset","local","readonly","declare","true","false"]);
const KW_RUST = new Set(["fn","let","mut","const","pub","use","mod","struct","enum","impl","trait","type","where","if","else","match","for","while","loop","return","true","false","self","super","crate","move","ref","unsafe","async","await"]);
const KW_GO  = new Set(["func","var","const","type","struct","interface","map","chan","go","defer","return","if","else","for","range","switch","case","break","continue","import","package","true","false","nil","make","new","len","cap","append","copy","delete","close","panic","recover"]);

function getKeywords(family: LangFamily): Set<string> | null {
  switch (family) {
    case "js": return KW_JS;
    case "py": return KW_PY;
    case "sql": return KW_SQL;
    case "css": return KW_CSS;
    case "sh": return KW_SH;
    case "rust": return KW_RUST;
    case "go": return KW_GO;
    default: return null;
  }
}

function highlightCode(raw: string, family: LangFamily): string {
  const kws = getKeywords(family);
  let result = "";
  let i = 0;
  const code = raw;
  const len = code.length;

  const emit = (text: string, cls?: string) => {
    const e = escapeHtml(text);
    result += cls ? `<span class="${cls}">${e}</span>` : e;
  };

  while (i < len) {
    const ch = code[i];
    const rest = code.slice(i);

    /* ── Comments ─────────────────────────────── */
    // Single-line: // (js/css/rust/go) or # (py/sh) or -- (sql)
    const isSingleLineComment =
      ((family === "js" || family === "css" || family === "rust" || family === "go") && rest.startsWith("//")) ||
      ((family === "py" || family === "sh") && ch === "#" && (i === 0 || /\s/.test(code[i-1]))) ||
      (family === "sql" && rest.startsWith("--"));
    if (isSingleLineComment) {
      const nl = code.indexOf("\n", i);
      const line = nl === -1 ? code.slice(i) : code.slice(i, nl);
      emit(line, "hl-comment");
      i += line.length;
      continue;
    }
    // Block comment: /* */
    if (["js","css","rust","go","other"].includes(family) && rest.startsWith("/*")) {
      const end = code.indexOf("*/", i + 2);
      const block = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      emit(block, "hl-comment");
      i += block.length;
      continue;
    }
    // HTML comment
    if (family === "html" && rest.startsWith("<!--")) {
      const end = code.indexOf("-->", i + 4);
      const block = end === -1 ? code.slice(i) : code.slice(i, end + 3);
      emit(block, "hl-comment");
      i += block.length;
      continue;
    }

    /* ── String literals ──────────────────────── */
    if (ch === '"' || ch === "'" || (ch === "`" && family === "js")) {
      const q = ch;
      let j = i + 1;
      while (j < len) {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === q) { j++; break; }
        if (q !== "`" && code[j] === "\n") break;
        j++;
      }
      emit(code.slice(i, j), "hl-string");
      i = j;
      continue;
    }

    /* ── Numbers ──────────────────────────────── */
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(code[i+1] ?? ""))) {
      let j = i;
      if (code.slice(i, i+2).toLowerCase() === "0x") {
        j = i + 2;
        while (j < len && /[0-9a-fA-F_]/.test(code[j])) j++;
      } else {
        while (j < len && /[0-9._]/.test(code[j])) j++;
        if (j < len && /[eE]/.test(code[j])) {
          j++;
          if (j < len && /[+-]/.test(code[j])) j++;
          while (j < len && /[0-9]/.test(code[j])) j++;
        }
      }
      emit(code.slice(i, j), "hl-number");
      i = j;
      continue;
    }

    /* ── Identifiers & keywords ───────────────── */
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      let cls: string | undefined;
      if (kws && (kws.has(word) || (family === "sql" && kws.has(word.toUpperCase())))) {
        cls = "hl-keyword";
      } else if (j < len && code[j] === "(") {
        cls = "hl-function";
      }
      emit(word, cls);
      i = j;
      continue;
    }

    /* ── Default ──────────────────────────────── */
    result += escapeHtml(ch);
    i++;
  }

  return result;
}

/* ─── CodeBlock component ───────────────────────────────────────── */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const family = getLang(lang);
  const highlighted = useMemo(() => highlightCode(code, family), [code, family]);
  const displayLang = lang || "code";

  return (
    <div className="code-block my-3 overflow-hidden rounded-xl border border-[var(--color-code-border)] bg-[var(--color-code-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--color-code-border)] px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)]">
          {displayLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text)] transition-colors"
        >
          {copied ? (
            <><CheckSmIcon /><span>Copied!</span></>
          ) : (
            <><CopySmIcon /><span>Copy</span></>
          )}
        </button>
      </div>
      <pre
        className="code-pre overflow-x-auto p-4 text-[13px] leading-6"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
}

function CheckSmIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}
function CopySmIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

/* ─── Text-only markdown (no code blocks) ───────────────────────── */

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)/g,
    (_, alt, url) =>
      `<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}" loading="lazy" class="my-2 max-w-full rounded-xl border border-[var(--color-border)] max-h-[480px] object-contain" />`
  );
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_, text, url) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer" ` +
      `class="underline decoration-dotted underline-offset-2 text-[var(--color-accent)] hover:opacity-80">${text}</a>`
  );
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

interface TextBlock {
  type: "code" | "p" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol" | "hr" | "img";
  lang?: string;
  text?: string;
  items?: string[];
  src?: string;
  alt?: string;
}

function parseTextBlocks(md: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^[-*_]{3,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)$/);
    if (imgMatch) { blocks.push({ type: "img", alt: imgMatch[1], src: imgMatch[2] }); i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const level = h[1].length as 1|2|3|4; blocks.push({ type: (`h${level}` as "h1"|"h2"|"h3"|"h4"), text: h[2] }); i++; continue; }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      blocks.push({ type: "ul", items }); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push({ type: "ol", items }); continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^```/) &&
      !/^#{1,4}\s+/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) && !/^[-*_]{3,}\s*$/.test(lines[i]) &&
      !lines[i].trim().match(/^!\[[^\]]*\]\((https?:\/\/|data:image)[^\s)]+\)$/)) {
      buf.push(lines[i]); i++;
    }
    if (buf.length > 0) blocks.push({ type: "p", text: buf.join("\n") });
  }
  return blocks;
}

function textBlocksToHtml(blocks: TextBlock[]): string {
  return blocks.map(b => {
    switch (b.type) {
      case "h1": return `<h1 class="mb-2 mt-5 text-xl font-bold leading-snug">${renderInline(b.text ?? "")}</h1>`;
      case "h2": return `<h2 class="mb-2 mt-4 text-lg font-semibold leading-snug">${renderInline(b.text ?? "")}</h2>`;
      case "h3": return `<h3 class="mb-1.5 mt-3 text-base font-semibold">${renderInline(b.text ?? "")}</h3>`;
      case "h4": return `<h4 class="mb-1 mt-2 text-[14px] font-semibold">${renderInline(b.text ?? "")}</h4>`;
      case "ul": return `<ul class="my-2 ml-5 list-disc space-y-1">${(b.items ?? []).map(it => `<li class="leading-relaxed">${renderInline(it)}</li>`).join("")}</ul>`;
      case "ol": return `<ol class="my-2 ml-5 list-decimal space-y-1">${(b.items ?? []).map(it => `<li class="leading-relaxed">${renderInline(it)}</li>`).join("")}</ol>`;
      case "hr": return `<hr class="my-4 border-[var(--color-border)]" />`;
      case "img": return `<div class="my-3"><img src="${safeUrl(b.src ?? "")}" alt="${escapeHtml(b.alt ?? "")}" loading="lazy" class="max-w-full rounded-xl border border-[var(--color-border)] max-h-[512px] object-contain" /></div>`;
      case "p": return `<p class="my-2 leading-relaxed whitespace-pre-wrap">${renderInline(b.text ?? "")}</p>`;
      default: return "";
    }
  }).join("");
}

/* ─── Split markdown into text & code segments ──────────────────── */

type Part =
  | { kind: "text"; content: string }
  | { kind: "code"; lang: string; code: string };

function splitParts(text: string): Part[] {
  const parts: Part[] = [];
  const regex = /^```(\w*)\s*\n([\s\S]*?)^```\s*$/gm;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ kind: "text", content: text.slice(lastIndex, match.index) });
    parts.push({ kind: "code", lang: match[1] || "", code: match[2].replace(/\n$/, "") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: "text", content: text.slice(lastIndex) });
  return parts;
}

/* ─── Main component ────────────────────────────────────────────── */

export default function Markdown({ text }: { text: string }) {
  const parts = useMemo(() => splitParts(text), [text]);
  return (
    <div className="prose-sm max-w-none">
      {parts.map((part, i) => {
        if (part.kind === "code") {
          return <CodeBlock key={i} lang={part.lang} code={part.code} />;
        }
        const html = textBlocksToHtml(parseTextBlocks(part.content));
        return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}
