/**
 * Neon PostgreSQL client — single connection per serverless instance.
 * Tables are created automatically on first use (idempotent).
 *
 * Tables:
 *   nngpt_accounts      — user accounts (cross-device auth)
 *   nngpt_conversations — chat history per account
 *   nngpt_sessions      — server-side sessions (30d expiry)
 *   nngpt_settings      — profile settings WITHOUT api keys (cross-device sync)
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

// ── Singleton SQL client ─────────────────────────────────────────
let _sql: NeonQueryFunction<false, false> | null = null;
let _tablesReady = false;

export function getSql(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon integration in Vercel → Storage → Neon."
    );
  }
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// ── Auto-migrate: create tables if missing ───────────────────────
export async function ensureTables(): Promise<void> {
  if (_tablesReady) return;
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS nngpt_accounts (
      id            TEXT PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nngpt_conversations (
      account_id  TEXT PRIMARY KEY,
      data        JSONB    NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nngpt_sessions (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      username    TEXT NOT NULL,
      email       TEXT,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_nngpt_sessions_account
    ON nngpt_sessions (account_id)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nngpt_settings (
      account_id  TEXT PRIMARY KEY,
      data        JSONB    NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  _tablesReady = true;
}

// ── Password helpers (scrypt + SHA-256 legacy fallback) ──────────

/**
 * Hash a new password with scrypt (Silicon Valley standard).
 * Format: "scrypt:<salt_hex>:<hash_hex>"
 */
export function hashPasswordScrypt(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(`nngpt::${password}::auth`, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash.
 * Supports scrypt (new) and SHA-256 (legacy).
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith("scrypt:")) {
      const parts = stored.split(":");
      if (parts.length !== 3) return false;
      const [, salt, hash] = parts;
      const derived = scryptSync(`nngpt::${password}::auth`, salt, 32);
      const storedBuf = Buffer.from(hash, "hex");
      if (derived.length !== storedBuf.length) return false;
      return timingSafeEqual(derived, storedBuf);
    }
    // Legacy SHA-256 fallback
    const sha = createHash("sha256")
      .update(`nngpt::${password}::auth`)
      .digest("hex");
    const shaA = Buffer.from(sha, "hex");
    const shaB = Buffer.from(stored, "hex");
    if (shaA.length !== shaB.length) return false;
    return timingSafeEqual(shaA, shaB);
  } catch {
    return false;
  }
}

export function isLegacyHash(stored: string): boolean {
  return !stored.startsWith("scrypt:");
}

// ── Account helpers ──────────────────────────────────────────────

export interface DbAccount {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  created_at: Date;
}

export async function dbGetAccountByUsername(username: string): Promise<DbAccount | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, username, email, password_hash, created_at
    FROM nngpt_accounts
    WHERE lower(username) = lower(${username})
    LIMIT 1
  `;
  return (rows[0] as DbAccount) ?? null;
}

export async function dbGetAccountById(id: string): Promise<DbAccount | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, username, email, password_hash, created_at
    FROM nngpt_accounts WHERE id = ${id} LIMIT 1
  `;
  return (rows[0] as DbAccount) ?? null;
}

export async function dbUpsertAccount(
  id: string,
  username: string,
  email: string,
  passwordHash: string
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO nngpt_accounts (id, username, email, password_hash)
    VALUES (${id}, ${username}, ${email}, ${passwordHash})
    ON CONFLICT (id) DO UPDATE
      SET username      = EXCLUDED.username,
          email         = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash
  `;
}

export async function dbUpdatePasswordHash(id: string, passwordHash: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE nngpt_accounts SET password_hash = ${passwordHash} WHERE id = ${id}`;
}

// ── Session helpers ──────────────────────────────────────────────

export interface DbSession {
  id: string;
  account_id: string;
  username: string;
  email: string | null;
  expires_at: Date;
}

export async function dbCreateSession(
  sessionId: string,
  accountId: string,
  username: string,
  email: string
): Promise<void> {
  const sql = getSql();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await sql`
    INSERT INTO nngpt_sessions (id, account_id, username, email, expires_at)
    VALUES (${sessionId}, ${accountId}, ${username}, ${email}, ${expiresAt.toISOString()})
    ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at
  `;
}

export async function dbGetSession(sessionId: string): Promise<DbSession | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, account_id, username, email, expires_at
    FROM nngpt_sessions
    WHERE id = ${sessionId} AND expires_at > NOW()
    LIMIT 1
  `;
  return (rows[0] as DbSession) ?? null;
}

export async function dbDeleteSession(sessionId: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM nngpt_sessions WHERE id = ${sessionId}`;
}

// ── Conversation helpers ─────────────────────────────────────────

export async function dbGetConversations(accountId: string): Promise<unknown[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM nngpt_conversations WHERE account_id = ${accountId} LIMIT 1
  `;
  const data = rows[0]?.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [];
}

export async function dbSaveConversations(
  accountId: string,
  conversations: unknown[]
): Promise<void> {
  const sql = getSql();
  const data = JSON.stringify(conversations.slice(0, 200));
  await sql`
    INSERT INTO nngpt_conversations (account_id, data, updated_at)
    VALUES (${accountId}, ${data}::jsonb, NOW())
    ON CONFLICT (account_id) DO UPDATE
      SET data       = EXCLUDED.data,
          updated_at = NOW()
  `;
}

// Recovery: get conversations by username (JOIN with accounts table)
// Used when accountId in session doesn't match what's stored in DB
export async function dbGetConversationsByUsername(username: string): Promise<unknown[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT c.data
    FROM nngpt_conversations c
    JOIN nngpt_accounts a ON a.id = c.account_id
    WHERE lower(a.username) = lower(${username})
    LIMIT 1
  `;
  const data = rows[0]?.data;
  if (!data) return [];
  return Array.isArray(data) ? data : [];
}

// Recovery: migrate conversations from one accountId to another on the server
export async function dbMergeConversations(
  fromAccountId: string,
  toAccountId: string,
): Promise<void> {
  if (fromAccountId === toAccountId) return;
  const sql = getSql();
  await sql`
    INSERT INTO nngpt_conversations (account_id, data, updated_at)
    SELECT ${toAccountId}, data, NOW()
    FROM nngpt_conversations
    WHERE account_id = ${fromAccountId}
    ON CONFLICT (account_id) DO UPDATE
      SET data = (
        SELECT jsonb_agg(DISTINCT elem ORDER BY (elem->>'createdAt') DESC)
        FROM (
          SELECT jsonb_array_elements(nngpt_conversations.data) AS elem
          UNION ALL
          SELECT jsonb_array_elements(EXCLUDED.data) AS elem
        ) combined
      ),
      updated_at = NOW()
  `;
}

// ── Settings helpers (profile config WITHOUT api keys) ──────────

export async function dbGetSettings(accountId: string): Promise<unknown> {
  const sql = getSql();
  const rows = await sql`
    SELECT data FROM nngpt_settings WHERE account_id = ${accountId} LIMIT 1
  `;
  return rows[0]?.data ?? null;
}

export async function dbSaveSettings(accountId: string, data: unknown): Promise<void> {
  const sql = getSql();
  const j = JSON.stringify(data);
  await sql`
    INSERT INTO nngpt_settings (account_id, data, updated_at)
    VALUES (${accountId}, ${j}::jsonb, NOW())
    ON CONFLICT (account_id) DO UPDATE
      SET data       = EXCLUDED.data,
          updated_at = NOW()
  `;
}
