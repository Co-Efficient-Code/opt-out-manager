import type { Env } from './types';

/**
 * Human-assigned project -> (PAC, Destination) mapping overrides.
 *
 * Stored in Cloudflare KV (OPTOUT_MAPPING) so assignments survive across
 * sessions and runs. This is the ONLY thing persisted here. Scrubbing and
 * opt-out reads always come from S3 (read-only) — KV never holds opt-out data.
 *
 * Key   = exact (tab-trimmed) project name.
 * Value = { pac, destination } (either may be present; both required to map).
 *
 * The parser stays the default source of truth. A KV override only wins for
 * projects a human explicitly assigned (e.g. PA 01, which has no PAC token).
 */

const KEY = 'project_overrides';

export interface ProjectOverride {
  pac?: string | null;
  destination?: string | null;
}
export type OverrideMap = Record<string, ProjectOverride>;

// Canonical values the UI offers. Kept here so route + UI agree.
export const PAC_SLUGS = ['sag-pac', 'no-going-back-pac', 'maga-inc', 'strategic-majority-pac'];
export const DESTINATIONS = ['Big Dog', 'Creative Direct'];

export function cleanName(name: string): string {
  // Keep the whole name INCLUDING the leading project number; the number is
  // tab-separated from the description upstream, so just normalize the tab.
  return (name || '').replace(/\t/g, ' ').trim();
}

// --- Ignore list ------------------------------------------------------------
// Exact phone numbers that must NEVER map to a bucket and must NOT trip the
// "needs mapping" flag. Frozen, deliberate allowlist (seeded once). Stored as
// a JSON array of normalized 10-digit strings under IGNORE_KEY in the same KV.
// Matching is by exact number, so any NEW blank/unknown opt-out still flags.
const IGNORE_KEY = 'ignore_phones';

/** Normalize a phone to 10 digits (drop leading US 1). Null if not 10/11-digit. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return null;
}

/** Load the frozen ignore set (normalized 10-digit phones). Best-effort. */
export async function loadIgnorePhones(env: Env): Promise<Set<string>> {
  const set = new Set<string>();
  if (!env.OPTOUT_MAPPING) return set;
  const raw = await env.OPTOUT_MAPPING.get(IGNORE_KEY);
  if (!raw) return set;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      for (const v of arr) {
        const n = normalizePhone(typeof v === 'string' ? v : String(v));
        if (n) set.add(n);
      }
    }
  } catch {
    /* ignore parse errors; treat as empty */
  }
  return set;
}

export async function loadOverrides(env: Env): Promise<OverrideMap> {
  if (!env.OPTOUT_MAPPING) return {};
  const raw = await env.OPTOUT_MAPPING.get(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as OverrideMap;
  } catch {
    return {};
  }
}

async function saveOverrides(env: Env, map: OverrideMap): Promise<void> {
  if (!env.OPTOUT_MAPPING) throw new Error('OPTOUT_MAPPING KV namespace is not bound');
  await env.OPTOUT_MAPPING.put(KEY, JSON.stringify(map));
}

/** Set (or clear) a single project's override. Validates against canonical lists. */
export async function setOverride(
  env: Env,
  project: string,
  pac: string | null,
  destination: string | null,
): Promise<OverrideMap> {
  const name = cleanName(project);
  if (!name) throw new Error('missing project name');
  if (pac && !PAC_SLUGS.includes(pac)) throw new Error(`unknown pac: ${pac}`);
  if (destination && !DESTINATIONS.includes(destination)) {
    throw new Error(`unknown destination: ${destination}`);
  }
  const map = await loadOverrides(env);
  if (!pac && !destination) {
    delete map[name]; // clearing the override
  } else {
    map[name] = { pac: pac || null, destination: destination || null };
  }
  await saveOverrides(env, map);
  return map;
}
