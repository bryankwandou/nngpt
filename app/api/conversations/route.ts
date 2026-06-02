import { NextRequest } from "next/server";
import {
  hasDb,
  ensureTables,
  dbGetConversations,
  dbSaveConversations,
  dbGetSession,
  dbGetConversationsByUsername,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidAccountId(id: string) {
  return (
    typeof id === "string" &&
    id.length >= 8 &&
    id.length <= 64 &&
    /^[a-zA-Z0-9_-]+$/.test(id)
  );
}

/** Verify Bearer session token belongs to accountId */
async function authSession(req: NextRequest, accountId: string): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  try {
    await ensureTables();
    const session = await dbGetSession(token);
    if (!session) return false;
    return session.account_id === accountId;
  } catch {
    return false;
  }
}

// GET /api/conversations?accountId=xxx
// Requires: Authorization: Bearer <sessionId>
// Recovery: if accountId returns empty, falls back to username-keyed lookup
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? "";

  if (!isValidAccountId(accountId)) {
    return Response.json(
      { conversations: null, error: "invalid accountId" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!hasDb()) {
    return Response.json(
      { conversations: null, reason: "no_db" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Extract token for both auth check and recovery lookup
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  const ok = await authSession(req, accountId);
  if (!ok) {
    return Response.json(
      { conversations: null, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    await ensureTables();
    let conversations = await dbGetConversations(accountId);

    // Recovery: if accountId bucket is empty, try by username (handles accountId drift)
    if (conversations.length === 0 && token) {
      const session = await dbGetSession(token).catch(() => null);
      if (session) {
        const byUsername = await dbGetConversationsByUsername(session.username);
        if (byUsername.length > 0) {
          // Migrate to current accountId so future fetches work normally
          await dbSaveConversations(accountId, byUsername);
          conversations = byUsername;
        }
      }
    }

    return Response.json(
      { conversations },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[conversations GET] db error:", err);
    return Response.json(
      { conversations: null, error: "db_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// POST /api/conversations  { accountId, conversations }
// Requires: Authorization: Bearer <sessionId>
export async function POST(req: NextRequest) {
  let body: { accountId?: string; conversations?: unknown };
  try {
    body = (await req.json()) as { accountId?: string; conversations?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { accountId = "", conversations = [] } = body;

  if (!isValidAccountId(accountId)) {
    return Response.json({ error: "invalid accountId" }, { status: 400 });
  }

  if (!Array.isArray(conversations)) {
    return Response.json({ error: "conversations must be an array" }, { status: 400 });
  }

  if (!hasDb()) {
    return Response.json({ ok: true, storage: "local_only" });
  }

  const ok = await authSession(req, accountId);
  if (!ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await dbSaveConversations(accountId, conversations);
    return Response.json({ ok: true, count: Math.min(conversations.length, 200) });
  } catch (err) {
    console.error("[conversations POST] db error:", err);
    return Response.json({ ok: false, reason: "db_error" }, { status: 500 });
  }
}
