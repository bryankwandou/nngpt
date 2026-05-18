import { NextRequest } from "next/server";
import { Buffer } from "node:buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TEXT = 100_000; // chars

interface ParseBody {
  file: string;   // base64
  mimeType: string;
  name: string;
}

export async function POST(req: NextRequest) {
  let body: ParseBody;
  try {
    body = (await req.json()) as ParseBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { file, mimeType, name } = body;
  if (!file) return Response.json({ error: "Missing file" }, { status: 400 });

  const buf = Buffer.from(file, "base64");
  const ext = (name.split(".").pop() ?? "").toLowerCase();

  try {
    // PDF
    if (mimeType === "application/pdf" || ext === "pdf") {
      const pdfMod = await import("pdf-parse");
      const pdfParse = (pdfMod as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfMod;
      const result = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buf);
      return Response.json({ text: result.text.slice(0, MAX_TEXT) });
    }

    // DOCX / DOC
    if (
      mimeType.includes("wordprocessingml") ||
      mimeType === "application/msword" ||
      ext === "docx" ||
      ext === "doc"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      return Response.json({ text: result.value.slice(0, MAX_TEXT) });
    }

    // XLSX / XLS / ODS
    if (
      mimeType.includes("spreadsheetml") ||
      mimeType === "application/vnd.ms-excel" ||
      ["xlsx", "xls", "ods"].includes(ext)
    ) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheets: string[] = [];
      for (const sn of wb.SheetNames) {
        const ws = wb.Sheets[sn];
        sheets.push(`[Sheet: ${sn}]\n` + XLSX.utils.sheet_to_csv(ws));
      }
      const text = sheets.join("\n\n");
      return Response.json({ text: text.slice(0, MAX_TEXT) });
    }

    // Fallback: try UTF-8 text
    const text = buf.toString("utf-8");
    return Response.json({ text: text.slice(0, MAX_TEXT) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: `Parse failed: ${msg}` }, { status: 500 });
  }
}
