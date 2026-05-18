export type AttachmentKind =
  | "image"   // png jpg gif webp svg bmp
  | "text"    // txt md csv json xml yaml js ts py etc
  | "pdf"
  | "docx"    // doc docx
  | "xlsx"    // xls xlsx ods
  | "unknown";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: AttachmentKind;
  content: string | null;  // data-url for image, text for others
  processing?: boolean;
  error?: string;
}

const TEXT_EXTS = new Set([
  "txt","md","markdown","csv","tsv","json","jsonl","xml","yaml","yml",
  "html","htm","css","scss","sass","less","js","mjs","cjs","ts","tsx","jsx",
  "py","rb","php","java","c","cpp","cc","cxx","h","hpp","cs","go","rs",
  "sh","bash","zsh","fish","ps1","bat","cmd","sql","graphql","proto",
  "toml","ini","cfg","conf","env","log","diff","patch","gitignore",
  "dockerfile","makefile","cmake","gradle","xml","svg","vue","svelte",
]);

export function detectKind(mimeType: string, name: string): AttachmentKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (
    m.includes("wordprocessingml") ||
    m === "application/msword" ||
    m === "application/vnd.ms-word"
  )
    return "docx";
  if (
    m.includes("spreadsheetml") ||
    m === "application/vnd.ms-excel" ||
    m === "text/csv"
  )
    return "xlsx";
  if (m.startsWith("text/")) return "text";

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png","jpg","jpeg","gif","webp","svg","bmp","ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["doc","docx"].includes(ext)) return "docx";
  if (["xls","xlsx","ods"].includes(ext)) return "xlsx";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unknown";
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function kindIcon(kind: AttachmentKind): string {
  const m: Record<AttachmentKind, string> = {
    image: "🖼",
    text: "📄",
    pdf: "📕",
    docx: "📝",
    xlsx: "📊",
    unknown: "📎",
  };
  return m[kind];
}

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function readAsText(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsText(file, "utf-8");
  });
}

export function readAsBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      // strip "data:...;base64," prefix
      res(dataUrl.split(",")[1] ?? "");
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export async function processFileClientSide(
  file: File,
  id: string
): Promise<Omit<Attachment, "id">> {
  const kind = detectKind(file.type, file.name);
  const base = { name: file.name, size: file.size, mimeType: file.type, kind };

  if (kind === "image") {
    const content = await readAsDataURL(file);
    return { ...base, content };
  }

  if (kind === "text") {
    try {
      const content = await readAsText(file);
      return { ...base, content };
    } catch {
      return { ...base, content: null, error: "Could not read file as text" };
    }
  }

  if (kind === "unknown") {
    // best-effort text
    try {
      const content = await readAsText(file);
      return { ...base, kind: "text", content };
    } catch {
      return { ...base, content: null, error: "Unsupported file type" };
    }
  }

  // pdf / docx / xlsx → needs server parse
  return { ...base, content: null, processing: true };
}

export async function parseOnServer(
  file: File,
  kind: AttachmentKind
): Promise<{ text: string | null; error?: string }> {
  const b64 = await readAsBase64(file);
  const res = await fetch("/api/parse-file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: b64, mimeType: file.type, name: file.name }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { text: null, error: `Parse error: ${t.slice(0, 200)}` };
  }
  const json = await res.json();
  return { text: json.text ?? null, error: json.error };
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function buildMessageContent(
  userText: string,
  attachments: Attachment[]
): string | ContentPart[] {
  const images = attachments.filter((a) => a.kind === "image" && a.content);
  const nonImages = attachments.filter((a) => a.kind !== "image" && a.content);

  let text = "";
  for (const a of nonImages) {
    const ext = a.name.split(".").pop() ?? "";
    text += `[File: ${a.name}]\n\`\`\`${ext}\n${a.content}\n\`\`\`\n\n`;
  }
  text += userText;

  if (images.length === 0) return text;

  const parts: ContentPart[] = [{ type: "text", text }];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img.content! } });
  }
  return parts;
}
