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
