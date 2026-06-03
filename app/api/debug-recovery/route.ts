/**
 * GET /api/debug-recovery
 * Requires: Authorization: Bearer <sessionId>
 *
 * Returns a summary of all conversations stored in the DB for all accounts,
 * plus the count of conversations in the authenticated account's bucket.
 * Used to diagnose missing history after account-ID drift.
 */
import { NextRequest } from "next/server";
import {
  hasDb,
  ensureTables,
  dbGetSession,
  dbGetConversations,
  dbGetConversationsByUsername,
  dbCountAllConversations,
  dbSaveConversations,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasDb()) {
    return Response.json({ error: "no_db" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await ensureTables();
    const session = await dbGetSession(token);
    if (!session) {
      return Response.json({ error: "session_expired" }, { status: 401 });
    }

    const { account_id: accountId, username } = session;

    // Conversations under current accountId
    const byAccountId = await dbGetConversations(accountId);

    // Conversations under username (may differ if accountId drifted)
    const byUsername = await dbGetConversationsByUsername(username);

    // All rows in nngpt_conversations (for diagnosis)
    const allRows = await dbCountAllConversations();

    // If byUsername has MORE than byAccountId, auto-migrate them
    let migrated = false;
    if (byUsername.length > byAccountId.length) {
      await dbSaveConversations(accountId, byUsername);
      migrated = true;
    }

    return Response.json({
      accountId,
      username,
      byAccountId: byAccountId.length,
      byUsername: byUsername.length,
      allRows,
      migrated,
      message: migrated
        ? `Migrated ${byUsername.length} conversations to current accountId. Reload the page.`
        : "No migration needed.",
    });
  } catch (err) {
    console.error("[debug-recovery] error:", err);
    return Response.json({ error: "db_error", detail: String(err) }, { status: 500 });
  }
}
