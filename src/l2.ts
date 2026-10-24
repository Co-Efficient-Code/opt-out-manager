import type { Env } from './types';
import { normalizePhone } from './scrub';

/**
 * L2 voter-file API client for the "already voted" (early-vote) scrub.
 *
 * READ ONLY. Pulls the set of voters in a state who have already cast an early
 * ballot, so the scrub can remove them from a contact list (after opt-outs).
 *
 * The hard part is that L2 does NOT keep stable column names for the early-vote
 * block. Two moving parts, both handled here (see docs/L2-EARLY-VOTE.md):
 *   1. The ABEV block prefix rotates (C_1A1P08<code>_...) and RE-CODES mid-run.
 *      A state has several blocks (old generals, primaries, this general) and
 *      the code is random, so you CANNOT pick by name or by sort order. We
 *      identify the current general by EVIDENCE: score each block by how many
 *      ballots are dated in the current window and take the highest, with a
 *      guard that the winner's dated ballots cover >=50% of its cast ballots.
 *      (This is Alex's findGeneralColumn approach, the robust one.)
 *   2. The Returned_Ballot_Status values differ by state. We read the live
 *      values and filter on the cast ones that actually exist; an unmapped
 *      value is surfaced, never guessed.
 *
 * Rate limit: a burst of ~10 calls trips a ~2-minute key-wide lockout (it
 * surfaces as API_KEY_INVALID). We pace every call >=7s apart and, on a
 * THRESHOLD reply, wait out the lockout L2 names instead of retrying into it.
 */

const DEFAULT_BASE = 'https://api.l2datamapping.com/api/v2';
const DEFAULT_CUSTOMER = '1QEP';
const DEFAULT_APP = 'VM_US';

// The ballot statuses that mean "this person has already voted".
export const CAST_STATUSES = ['Early in Person', 'Early Method Unknown', 'Returned by Mail'];
// Non-cast statuses we expect to see (mapped so an unexpected one is caught).
const NONCAST_STATUSES = ['Rejected', 'Requested Not Yet Sent', 'Sent Not Yet Returned'];

// Block-scoring window: the current general's ballots are dated after the last
// 2026 primary (mid-September). Older elections score 0.
const WINDOW_START = '2026-09-16';
const MIN_DATED_SHARE = 0.5;
// Minimum gap between calls (ms). ~7s keeps us under the burst threshold.
const MIN_GAP_MS = 7000;

// Stale/recoded-column error signatures. The stats endpoint says
// API_PRIVATE_FIELD_INVALID; the column/values endpoint says API_PRIVATE_CUST.
const STALE_FIELD = /API_PRIVATE_FIELD_INVALID|API_PRIVATE_CUST|no longer accessible|Private Data not found/i;
// The key-wide rate lockout. L2 surfaces it as a threshold message OR, once you
// are deep in the hole, as a misleading "API Key Invalid for customer".
const THRESHOLD = /API_THRESHOLD|THRESHOLD|API_KEY_INVALID|next available/i;

export interface L2Config {
  base: string;
  customer: string;
  app: string;
  key: string;
}

export function l2Config(env: Env): L2Config | null {
  const key = (env.L2_API_KEY || '').trim();
  if (!key) return null;
  return {
    base: (env.L2_API_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
    customer: env.L2_CUSTOMER_ID || DEFAULT_CUSTOMER,
    app: env.L2_APP || DEFAULT_APP,
    key,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function lockoutMs(message: string): number {
  const m = /in (\d+|a|an) minute/i.exec(message || '');
  if (m) return (/^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1) * 60000 + 5000;
  return 15000; // "in a few seconds" or unparsed
}

/**
 * One rate-paced GET -> parsed JSON. A THRESHOLD/lockout reply waits out the
 * window L2 names and retries (up to ~30 min total); network/parse errors retry
 * with backoff. Throws if it truly can't get a good reply.
 *
 * `gate` is a shared { next:number } so every call in a run is spaced, not just
 * calls on one path (the lockout is key-wide).
 */
async function l2Get(
  cfg: L2Config,
  path: string,
  params: [string, string][],
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
): Promise<any> {
  const qs = new URLSearchParams([['id', cfg.customer], ['apikey', cfg.key], ...params]);
  const url = `${cfg.base}/${path}?${qs.toString()}`;
  let errors = 0;
  let waited = 0;
  let lastErr = '';
  while (errors < 5 && waited < 30 * 60000) {
    const wait = gate.next - Date.now();
    if (wait > 0) await sleep(wait);
    gate.next = Math.max(gate.next, Date.now()) + MIN_GAP_MS;
    try {
      const res = await fetch(url);
      const text = await res.text();
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        j = { result: 'fail', message: text.slice(0, 200) };
      }
      const msg = String(j.message || '');
      if (j.result === 'fail' && THRESHOLD.test(msg)) {
        const ms = lockoutMs(msg);
        gate.next = Math.max(gate.next, Date.now() + ms);
        waited += ms;
        if (onProgress) await onProgress(`L2 rate limit; waiting ${Math.round(ms / 1000)}s`);
        continue;
      }
      return j;
    } catch (e) {
      errors++;
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(5000 * errors);
    }
  }
  throw new Error(`L2 request failed after retries (${lastErr || 'rate limit'}): ${path}`);
}

export function isStaleField(j: any): boolean {
  return !!(j && j.result === 'fail' && STALE_FIELD.test(j.message || ''));
}

function easternTodayISO(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

async function fetchColumns(cfg: L2Config, gate: { next: number }, onProgress?: (m: string) => void | Promise<void>) {
  return l2Get(cfg, `customer/application/columns/${cfg.customer}/${cfg.app}`, [], gate, onProgress);
}

async function stats(
  cfg: L2Config,
  params: [string, string][],
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
) {
  return l2Get(cfg, `customer/application/stats/${cfg.customer}/${cfg.app}`, params, gate, onProgress);
}

async function columnValues(
  cfg: L2Config,
  col: string,
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
) {
  return l2Get(cfg, `customer/application/column/values/${cfg.customer}/${cfg.app}/${col}`, [], gate, onProgress);
}

export interface GeneralColumn {
  col: string; // the <block>_Returned_Ballot_Status column id
  block: string; // C_1A1P08<code>
  score: number; // ballots dated in window
  returned: number;
}

/**
 * Find the current general's Returned_Ballot_Status column for one state, by
 * scoring every ABEV block on ballots dated in the window. Returns the winning
 * column, or null if the state is not reporting a general yet.
 */
export async function findGeneralColumn(
  cfg: L2Config,
  state: string,
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
): Promise<GeneralColumn | null> {
  const cj = await fetchColumns(cfg, gate, onProgress);
  if (!cj || !cj.columns) throw new Error('L2: could not list columns');
  const ids = new Set<string>(cj.columns.map((c: any) => c.id));
  const blocks = [...ids]
    .filter((id) => /^C_1A1P08[A-Z0-9]+_Returned_Ballot_Status$/.test(id))
    .map((id) => id.replace(/_Returned_Ballot_Status$/, ''));
  if (!blocks.length) throw new Error(`L2: no ABEV blocks on ${cfg.app}`);

  const window = `${WINDOW_START}|${easternTodayISO()}`;
  const stFilter: [string, string] = ['filter.Residence_Addresses_State', state];
  const cands: GeneralColumn[] = [];
  for (const b of blocks) {
    let score = 0;
    let returned = 0;
    for (const kind of ['Returned', 'Sent']) {
      const f = `${b}_${kind}_Ballot_Date`;
      if (!ids.has(f)) continue;
      const r = await stats(cfg, [stFilter, [`filter.${f}`, window]], gate, onProgress);
      if (!r || r.result !== 'ok') break; // transient; skip this block this run
      score += r.count || 0;
      if (kind === 'Returned') returned = r.count || 0;
      if (score) break; // returned-in-window is enough; Sent only matters at 0
    }
    if (score) cands.push({ col: `${b}_Returned_Ballot_Status`, block: b, score, returned });
  }
  cands.sort((a, b) => b.score - a.score);

  // Take the highest-scoring block whose cast ballots are mostly dated in-window
  // (guards against a junk-dated old election winning on a few stray dates).
  for (const c of cands) {
    const r = await stats(cfg, [stFilter, [`view.${c.col}`, '1']], gate, onProgress);
    if (!r || r.result !== 'ok') continue;
    const S = (r.statistics && r.statistics[c.col]) || {};
    const cast = CAST_STATUSES.reduce((a, v) => a + (S[v] || 0), 0);
    if (cast === 0 || c.returned >= MIN_DATED_SHARE * cast) return c;
  }
  return null;
}

export interface EarlyVoteResult {
  state: string;
  block: string; // the block code we used (for logging / the churn audit)
  statusColumn: string;
  liveStatuses: string[]; // every status value the state currently emits
  castStatuses: string[]; // the cast ones present (what we filtered on)
  unmappedStatuses: string[]; // live values we did not recognize (surfaced, never counted)
  castCount: number; // reported count of already-voted records (stats)
  phones: Set<string>; // normalized 10-digit cells of already-voted voters
}

/**
 * Pull the set of already-voted cell phones for a state (optionally narrowed to
 * a congressional district). READ ONLY.
 *
 * Steps: discover the general block (by evidence) -> read live statuses ->
 * filter to cast statuses -> export the cast voters' cell numbers.
 */
export async function pullEarlyVoters(
  cfg: L2Config,
  state: string,
  opts: { district?: string; onProgress?: (m: string) => void | Promise<void> } = {},
): Promise<EarlyVoteResult> {
  const onProgress = opts.onProgress;
  const gate = { next: Date.now() };
  const stFilter: [string, string] = ['filter.Residence_Addresses_State', state];

  if (onProgress) await onProgress(`Finding ${state}'s current early-vote field...`);
  const gc = await findGeneralColumn(cfg, state, gate, onProgress);
  if (!gc) {
    return {
      state,
      block: '',
      statusColumn: '',
      liveStatuses: [],
      castStatuses: [],
      unmappedStatuses: [],
      castCount: 0,
      phones: new Set<string>(),
    };
  }

  // Read the live status values; the set differs per state and can recode, so
  // we filter only on the cast values that actually exist.
  if (onProgress) await onProgress('Reading live ballot statuses...');
  let vj = await columnValues(cfg, gc.col, gate, onProgress);
  if (isStaleField(vj)) {
    // Recoded between discovery and now: re-detect once.
    const re = await findGeneralColumn(cfg, state, gate, onProgress);
    if (!re) throw new Error(`L2: ${state} early-vote column recoded and re-detection found no general`);
    gc.col = re.col;
    gc.block = re.block;
    vj = await columnValues(cfg, gc.col, gate, onProgress);
  }
  const liveStatuses: string[] = ((vj && vj.values) || []).filter(Boolean);
  const castStatuses = CAST_STATUSES.filter((v) => liveStatuses.includes(v));
  const known = new Set([...CAST_STATUSES, ...NONCAST_STATUSES]);
  const unmappedStatuses = liveStatuses.filter((v) => !known.has(v));
  if (!castStatuses.length) {
    // No cast statuses present yet (e.g. in-person not started and no mail back):
    // nothing to scrub. Return an empty, non-error result.
    return {
      state,
      block: gc.block,
      statusColumn: gc.col,
      liveStatuses,
      castStatuses,
      unmappedStatuses,
      castCount: 0,
      phones: new Set<string>(),
    };
  }

  // Export the cast voters' cell numbers. The export endpoint streams a CSV; we
  // request only the phone column + the status (so we can sanity check) under
  // the state (+ district) filter and the cast-status filter.
  const filters: [string, string][] = [stFilter];
  if (opts.district) filters.push(['filter.US_Congressional_District', opts.district]);
  for (const v of castStatuses) filters.push([`filter.${gc.col}`, v]);

  // Count first (cheap) so progress can show the size before the export.
  if (onProgress) await onProgress('Counting early voters...');
  const cj = await stats(cfg, [...filters, [`view.${gc.col}`, '1']], gate, onProgress);
  const castCount = cj && cj.result === 'ok' && typeof cj.count === 'number' ? cj.count : 0;

  if (onProgress) await onProgress(`Pulling ${castCount.toLocaleString()} early voters from L2...`);
  const phones = await exportCastPhones(cfg, filters, gate, onProgress);

  return {
    state,
    block: gc.block,
    statusColumn: gc.col,
    liveStatuses,
    castStatuses,
    unmappedStatuses,
    castCount,
    phones,
  };
}

/**
 * Stream the cast voters' cell numbers from the L2 export endpoint into a Set of
 * normalized 10-digit phones. Bounded memory: only the phone set is retained.
 */
async function exportCastPhones(
  cfg: L2Config,
  filters: [string, string][],
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
): Promise<Set<string>> {
  const PHONE_COL = 'VoterTelephones_CellPhoneUnformatted';
  const qs = new URLSearchParams([
    ['id', cfg.customer],
    ['apikey', cfg.key],
    [`view.${PHONE_COL}`, '1'],
    ...filters,
  ]);
  const url = `${cfg.base}/customer/application/search/${cfg.customer}/${cfg.app}?${qs.toString()}`;

  // Pace with the shared gate (export counts against the same quota).
  const wait = gate.next - Date.now();
  if (wait > 0) await sleep(wait);
  gate.next = Math.max(gate.next, Date.now()) + MIN_GAP_MS;

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`L2 export HTTP ${res.status}`);

  const phones = new Set<string>();
  const reader = res.body.pipeThrough(new TextDecoderStream('utf-8')).getReader();
  let buf = '';
  let header: string[] | null = null;
  let phoneIdx = -1;
  let seen = 0;
  const pushLine = (line: string) => {
    if (!line.trim()) return;
    const cols = splitCsvLine(line);
    if (header === null) {
      header = cols.map((h) => h.trim());
      phoneIdx = header.findIndex((h) => h === PHONE_COL || h.toLowerCase().includes('cellphone'));
      if (phoneIdx < 0) phoneIdx = header.length - 1;
      return;
    }
    const p = normalizePhone(cols[phoneIdx] ?? '');
    if (p) phones.add(p);
    seen++;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      let line = buf.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      pushLine(line);
      if (onProgress && seen && seen % 50000 === 0) await onProgress(`Read ${seen.toLocaleString()} early voters...`);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  if (buf.length) {
    if (buf.endsWith('\r')) buf = buf.slice(0, -1);
    pushLine(buf);
  }
  return phones;
}

/** Minimal CSV line split (quoted fields). Mirrors scrub.ts. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
