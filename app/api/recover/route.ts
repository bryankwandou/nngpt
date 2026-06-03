/**
 * Chat history recovery endpoint.
 *
 * POST /api/recover  { sessionId }
 *
 * Scans ALL possible accountId variants, username-keyed buckets, and DB
 * entries that could belong to the authenticated user, then merges them
 * into the correct accountId bucket.
 *
 * Returns the merged conversation list.
 */
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import {
  hasDb,
  ensureTables,
  dbGetSession,
  dbGetConversations,
  dbGetConversationsByUsername,
  dbSaveConversations,
} from "@/lib/db";
import { checkRateLimit, getIpKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All historical accountId generation methods for the same username */
function allAccountIdVariants(username: string): string[] {
  const lower = username.trim().toLowerCase();
  const variants = new Set<string>();

  // Current method: SHA-256("nngpt:account-id-v1:<lower>").slice(0,32)
  const v1 = createHash("sha256")
    .update(`nngpt:account-id-v1:${lower}`)
    .digest("hex")
    .slice(0, 32);
  variants.add(v1);

  // Legacy: SHA-256("nngpt:account-id-v1:<lower>") — full 64 chars (early bug)
  const v1full = createHash("sha256")
    .update(`nngpt:account-id-v1:${lower}`)
    .digest("hex");
  variants.add(v1full);

  // Even older: SHA-256 of username only
  const v0 = createHash("sha256").update(lower).digest("hex").slice(0, 32);
  variants.add(v0);

  // With original casing
  if (username !== lower) {
    const cased = createHash("sha256")
      .update(`nngpt:account-id-v1:${username.trim()}`)
      .digest("hex")
      .slice(0, 32);
    variants.add(cased);
  }

  return [...variants];
}

interface ConvLike { id?: string; createdAt?: number }

function mergeConvLists(lists: unknown[][]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const list of lists) {
    for (const item of list) {
      const conv = item as ConvLike;
      if (conv?.id && typeof conv.id === "string") {
        // Keep newer version if duplicate id
        const existing = byId.get(conv.id) as ConvLike | undefined;
        if (!existing || (conv.createdAt ?? 0) > (existing.createdAt ?? 0)) {
          byId.set(conv.id, item);
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ta = ((a as ConvLike).createdAt ?? 0);
    const tb = ((b as ConvLike).createdAt ?? 0);
    return tb - ta;
  });
}

export async function POST(req: NextRequest) {
  // Rate limit: 5 recovery attempts per 10 minutes per IP
  const rl = checkRateLimit(getIpKey(req, "recover"), 5, 10 * 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `Too many recovery attempts. Try again in ${rl.retryAfter}s.` },
      { status: 429 }
    );
  }

  if (!hasDb()) {
    return Response.json({ error: "Database not configured." }, { status: 503 });
  }

  // Auth: require valid session
  let body: { sessionId?: string } = {};
  try { body = (await req.json()) as { sessionId?: string }; } catch {}

  const sessionId = body.sessionId ?? "";
  if (!sessionId) {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    await ensureTables();
    const session = await dbGetSession(sessionId);
    if (!session) {
      return Response.json({ error: "Session invalid or expired." }, { status: 401 });
    }

    const { account_id: canonicalId, username } = session;
    const allVariants = allAccountIdVariants(username);
    // Always include the canonical session accountId even if not in variants
    if (!allVariants.includes(canonicalId)) allVariants.unshift(canonicalId);

    // Fetch conversations from all accountId variants + username lookup
    const fetchResults = await Promise.allSettled([
      ...allVariants.map(id => dbGetConversations(id)),
      dbGetConversationsByUsername(username),
    ]);

    const allLists = fetchResults
      .filter(r => r.status === "fulfilled")
      .map(r => (r as PromiseFulfilledResult<unknown[]>).value)
      .filter(list => list.length > 0);

    if (allLists.length === 0) {
      return Response.json({
        recovered: 0,
        conversations: [],
        message: "No conversations found in any storage location.",
      });
    }

    const merged = mergeConvLists(allLists);

    // Save merged result under canonical accountId (and migrate old buckets)
    await dbSaveConversations(canonicalId, merged.slice(0, 200));

    // Log which sources had data (for debugging without exposing sensitive data)
    const sources = fetchResults
      .map((r, i) => ({
        source: i < allVariants.length ? `accountId[${i}]` : "username",
        count: r.status === "fulfilled" ? r.value.length : 0,
      }))
      .filter(s => s.count > 0);

    return Response.json({
      recovered: merged.length,
      conversations: merged,
      sources,
      message: `Recovered ${merged.length} conversation(s) from ${sources.length} source(s).`,
    });
  } catch (err) {
    console.error("[recover] error:", err);
    return Response.json({ error: "Recovery failed. Please try again." }, { status: 500 });
  }
}
