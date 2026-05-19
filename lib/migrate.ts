/**
 * One-time migration: move conversations + settings from the old API-key-based
 * storage format to the new per-account format.
 *
 * Old conversation keys:  nngpt:conversations:acct_<suffix>
 *                         nngpt:conversations:server-default
 * Old settings key:       nngpt:settings:v1  (global, not per-account)
 *
 * New conversation key:   nngpt:conversations:<accountId>
 * New settings key:       nngpt:settings:<accountId>:v1
 *
 * After migration, old keys are removed so this only ever runs once.
 */

const MIGRATED_FLAG = "nngpt:migrated:v1";

export function migrateToAccountStorage(accountId: string): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATED_FLAG)) return; // already done

  // ── Migrate conversations ────────────────────────────────────────────────
  const newConvKey = `nngpt:conversations:${accountId}`;

  // Collect all old conversation keys
  const oldConvKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith("nngpt:conversations:acct_") ||
      k === "nngpt:conversations:server-default"
    ) {
      oldConvKeys.push(k);
    }
  }

  if (oldConvKeys.length > 0) {
    // Start from whatever is already in the new key (could be empty)
    let merged: unknown[] = [];
    const existingRaw = localStorage.getItem(newConvKey);
    if (existingRaw) {
      try { merged = JSON.parse(existingRaw) as unknown[]; } catch { /**/ }
    }

    for (const oldKey of oldConvKeys) {
      const raw = localStorage.getItem(oldKey);
      if (!raw) continue;
      try {
        const convs = JSON.parse(raw) as unknown[];
        if (Array.isArray(convs)) merged = [...merged, ...convs];
      } catch { /**/ }
      localStorage.removeItem(oldKey);
    }

    // Deduplicate by id, sort newest-first
    const seen = new Set<string>();
    const deduped = merged.filter((c) => {
      const id = (c as { id?: string }).id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    deduped.sort((a, b) => {
      const ta = (a as { createdAt?: number }).createdAt ?? 0;
      const tb = (b as { createdAt?: number }).createdAt ?? 0;
      return tb - ta;
    });

    if (deduped.length > 0) {
      localStorage.setItem(newConvKey, JSON.stringify(deduped));
    }
  }

  // ── Migrate settings ─────────────────────────────────────────────────────
  const oldSettingsKey = "nngpt:settings:v1";
  const newSettingsKey = `nngpt:settings:${accountId}:v1`;
  const oldSettings = localStorage.getItem(oldSettingsKey);
  if (oldSettings && !localStorage.getItem(newSettingsKey)) {
    localStorage.setItem(newSettingsKey, oldSettings);
    localStorage.removeItem(oldSettingsKey);
  }

  // Mark as done
  localStorage.setItem(MIGRATED_FLAG, "1");
}
