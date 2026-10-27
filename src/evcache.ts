import type { Env } from './types';
import { l2Config, pullEarlyVoters } from './l2';

/**
 * Early-vote cache.
 *
 * We pull each state's already-voted universe from L2 ONCE A DAY (a scheduled
 * job) and store it in R2. The scrub tool then reads the cached set instead of
 * hitting L2 live, so:
 *   - L2 is hit once/day, well under the rate limit (no mid-scrub lockouts);
 *   - scrubs are instant (no 450k-row export in the user's path);
 *   - an L2 outage never blocks a scrub (we use the last good file).
 *
 * Layout in R2 (binding EV_CACHE):
 *   ev/<STATE>/latest.txt    - the phone set: one normalized 10-digit cell/line
 *   ev/<STATE>/latest.json   - metadata: { state, count, block, castStatuses,
 *                              unmappedStatuses, pulledAt, universeCount }
 * A dated copy is also kept for audit: ev/<STATE>/<YYYY-MM-DD>.txt/.json
 */

export interface EvMeta {
  state: string;
  count: number; // phones stored
  universeCount: number; // L2's reported cast count (may exceed phones if some lack a cell)
  block: string; // L2 block code used (churn audit)
  castStatuses: string[];
  unmappedStatuses: string[];
  pulledAt: string; // ISO timestamp of the pull
}

export interface EvCacheRead {
  phones: Set<string>;
  meta: EvMeta;
  ageHours: number;
  stale: boolean; // older than STALE_HOURS
}

const STALE_HOURS = 36; // a daily job that missed ~1.5 cycles

function keyTxt(state: string, date?: string): string {
  return `ev/${state}/${date || 'latest'}.txt`;
}
function keyJson(state: string, date?: string): string {
  return `ev/${state}/${date || 'latest'}.json`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function evStates(env: Env): string[] {
  return (env.EV_STATES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
}

/**
 * Pull one state from L2 and write it to R2 (latest + a dated copy). Returns the
 * metadata. Throws if L2 is unavailable or the pull fails - the caller decides
 * whether to keep going with other states (we do).
 */
export async function refreshState(env: Env, state: string, onProgress?: (m: string) => void | Promise<void>): Promise<EvMeta> {
  const cfg = l2Config(env);
  if (!cfg) throw new Error('L2 not configured (no API key)');
  if (!env.EV_CACHE) throw new Error('EV_CACHE R2 bucket not bound');

  const r = await pullEarlyVoters(cfg, state, { onProgress });
  const phones = [...r.phones];
  const meta: EvMeta = {
    state,
    count: phones.length,
    universeCount: r.castCount,
    block: r.block,
    castStatuses: r.castStatuses,
    unmappedStatuses: r.unmappedStatuses,
    pulledAt: new Date().toISOString(),
  };

  const body = phones.join('\n') + (phones.length ? '\n' : '');
  const metaBody = JSON.stringify(meta);
  const d = today();
  // Write the dated copy first, then latest (so latest never points at a
  // half-written file).
  await env.EV_CACHE.put(keyTxt(state, d), body, { httpMetadata: { contentType: 'text/plain' } });
  await env.EV_CACHE.put(keyJson(state, d), metaBody, { httpMetadata: { contentType: 'application/json' } });
  await env.EV_CACHE.put(keyTxt(state), body, { httpMetadata: { contentType: 'text/plain' } });
  await env.EV_CACHE.put(keyJson(state), metaBody, { httpMetadata: { contentType: 'application/json' } });
  return meta;
}

/** Refresh every configured state. Non-fatal per state: collects results+errors. */
export async function refreshAll(
  env: Env,
  onProgress?: (m: string) => void | Promise<void>,
  only?: string[],
): Promise<{ ok: EvMeta[]; failed: { state: string; error: string }[] }> {
  const all = evStates(env);
  const states = only && only.length ? only.filter((s) => all.includes(s)) : all;
  const ok: EvMeta[] = [];
  const failed: { state: string; error: string }[] = [];
  for (const st of states) {
    try {
      if (onProgress) await onProgress(`Refreshing ${st}...`);
      const meta = await refreshState(env, st, onProgress);
      ok.push(meta);
      if (onProgress) await onProgress(`${st}: ${meta.count.toLocaleString()} early-vote cells cached.`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ state: st, error });
      if (onProgress) await onProgress(`${st} FAILED: ${error}`);
    }
  }
  return { ok, failed };
}

/**
 * Read a state's cached early-vote phone set from R2. Returns null if there is
 * no cached file for the state at all.
 */
export async function readCachedState(env: Env, state: string): Promise<EvCacheRead | null> {
  if (!env.EV_CACHE) return null;
  const st = state.toUpperCase();
  const [txtObj, jsonObj] = await Promise.all([
    env.EV_CACHE.get(keyTxt(st)),
    env.EV_CACHE.get(keyJson(st)),
  ]);
  if (!txtObj) return null;

  const text = await txtObj.text();
  const phones = new Set<string>();
  for (const line of text.split('\n')) {
    const p = line.trim();
    if (p) phones.add(p);
  }

  let meta: EvMeta;
  if (jsonObj) {
    try {
      meta = JSON.parse(await jsonObj.text());
    } catch {
      meta = fallbackMeta(st, phones.size);
    }
  } else {
    meta = fallbackMeta(st, phones.size);
  }

  const pulledMs = Date.parse(meta.pulledAt || '') || (txtObj.uploaded ? txtObj.uploaded.getTime() : Date.now());
  const ageHours = (Date.now() - pulledMs) / 3600000;
  return { phones, meta, ageHours, stale: ageHours > STALE_HOURS };
}

function fallbackMeta(state: string, count: number): EvMeta {
  return { state, count, universeCount: count, block: '', castStatuses: [], unmappedStatuses: [], pulledAt: '' };
}

export interface EvSummaryRow {
  state: string;
  cached: boolean;
  count: number;
  block: string;
  pulledAt: string;
  ageHours: number | null;
  stale: boolean;
}

/**
 * Lightweight summary of the cache across all configured states - reads only the
 * per-state metadata JSON (not the phone sets), for the daily notification email.
 */
export async function evSummary(env: Env): Promise<EvSummaryRow[]> {
  const states = evStates(env);
  const rows = await Promise.all(
    states.map(async (st): Promise<EvSummaryRow> => {
      const jsonObj = env.EV_CACHE ? await env.EV_CACHE.get(keyJson(st)) : null;
      if (!jsonObj) return { state: st, cached: false, count: 0, block: '', pulledAt: '', ageHours: null, stale: true };
      let meta: EvMeta;
      try { meta = JSON.parse(await jsonObj.text()); } catch { meta = fallbackMeta(st, 0); }
      const pulledMs = Date.parse(meta.pulledAt || '') || (jsonObj.uploaded ? jsonObj.uploaded.getTime() : 0);
      const ageHours = pulledMs ? (Date.now() - pulledMs) / 3600000 : null;
      return {
        state: st,
        cached: true,
        count: meta.count || 0,
        block: meta.block || '',
        pulledAt: meta.pulledAt || '',
        ageHours,
        stale: ageHours === null || ageHours > STALE_HOURS,
      };
    }),
  );
  return rows;
}
