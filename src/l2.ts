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
  console.log(JSON.stringify({ tag: 'EVDIAG', phase: 'blocks', state, blocks }));

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
      console.log(JSON.stringify({ tag: 'EVDIAG', phase: 'score', block: b, kind, result: r && r.result, count: r && r.count, message: r && String(r.message || '').slice(0, 120) }));
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
  console.log(JSON.stringify({ tag: 'EVDIAG', phase: 'cands', cands: cands.map((c) => ({ block: c.block, score: c.score, returned: c.returned })) }));
  for (const c of cands) {
    const r = await stats(cfg, [stFilter, [`view.${c.col}`, '1']], gate, onProgress);
    const S = (r && r.statistics && r.statistics[c.col]) || {};
    const cast = CAST_STATUSES.reduce((a, v) => a + (S[v] || 0), 0);
    console.log(JSON.stringify({ tag: 'EVDIAG', phase: 'guard', block: c.block, result: r && r.result, cast, returned: c.returned, keys: Object.keys(S).slice(0, 8) }));
    if (!r || r.result !== 'ok') continue;
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
  // Count first (cheap) so progress can show the size before the export. The
  // stats endpoint uses filter./view. query params.
  const statFilters: [string, string][] = [stFilter];
  if (opts.district) statFilters.push(['filter.US_Congressional_District', opts.district]);
  for (const v of castStatuses) statFilters.push([`filter.${gc.col}`, v]);
  if (onProgress) await onProgress('Counting early voters...');
  const cj = await stats(cfg, [...statFilters, [`view.${gc.col}`, '1']], gate, onProgress);
  const castCount = cj && cj.result === 'ok' && typeof cj.count === 'number' ? cj.count : 0;

  // The records/search export takes a JSON filter object of RAW column ids (no
  // filter. prefix). An ENUM column (the status) takes the full value list.
  const exportFilters: Record<string, string | string[]> = {
    Residence_Addresses_State: state,
  };
  if (opts.district) exportFilters.US_Congressional_District = opts.district;
  exportFilters[gc.col] = castStatuses;

  if (onProgress) await onProgress(`Pulling ${castCount.toLocaleString()} early voters from L2...`);
  const phones = await exportCastPhones(cfg, exportFilters, gate, onProgress);

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
 * Pull the cast voters' cell numbers via L2's records/search EXPORT (a 4-step
 * async job - confirmed live by Skye 2026-10-23, validated locally 2026-10-26):
 *   1. submit:  POST records/search/<cust>/<app> {filters, format:'csv', wait:0, columns}
 *               -> { job }
 *   2. poll:    GET records/search/status/<job> every ~20s until FINISHED (ERROR aborts)
 *   3. file:    GET records/search/file/<job> -> stream the CSV
 * We stream the CSV and keep only the normalized cell phones (bounded memory).
 * `filters` is a JSON object of RAW L2 column ids; an ENUM column takes a list.
 */
async function exportCastPhones(
  cfg: L2Config,
  filters: Record<string, string | string[]>,
  gate: { next: number },
  onProgress?: (m: string) => void | Promise<void>,
): Promise<Set<string>> {
  const PHONE_COL = 'VoterTelephones_CellPhoneUnformatted';
  const auth = `id=${encodeURIComponent(cfg.customer)}&apikey=${encodeURIComponent(cfg.key)}`;
  const paced = async () => {
    const wait = gate.next - Date.now();
    if (wait > 0) await sleep(wait);
    gate.next = Math.max(gate.next, Date.now()) + MIN_GAP_MS;
  };

  // 1. submit the export job
  await paced();
  const submitUrl = `${cfg.base}/records/search/${cfg.customer}/${cfg.app}?${auth}`;
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, format: 'csv', wait: 0, columns: ['LALVOTERID', PHONE_COL] }),
  });
  const submitTxt = await submitRes.text();
  let submit: any;
  try { submit = JSON.parse(submitTxt); } catch { throw new Error(`L2 export submit: bad response ${submitTxt.slice(0, 160)}`); }
  const job = submit && submit.job;
  if (!job) throw new Error(`L2 export submit: no job id (${String(submit && submit.message || submitTxt).slice(0, 160)})`);

  // 2. poll until FINISHED (or ERROR). Paced; bounded to ~20 min.
  const statusUrl = `${cfg.base}/records/search/status/${job}?${auth}`;
  let finished = false;
  for (let i = 0; i < 60; i++) {
    await sleep(20000);
    const sj = await (await fetch(statusUrl)).json().catch(() => ({} as any));
    const s = String((sj as any).status || '').toUpperCase();
    if (onProgress && s) await onProgress(`L2 export ${s.toLowerCase()}...`);
    if (s === 'FINISHED') { finished = true; break; }
    if (s === 'ERROR') throw new Error(`L2 export job error: ${JSON.stringify(sj).slice(0, 160)}`);
  }
  if (!finished) throw new Error('L2 export job did not finish in time');

  // 3. download + stream-parse the CSV for the phone column.
  await paced();
  const fileUrl = `${cfg.base}/records/search/file/${job}?${auth}`;
  const res = await fetch(fileUrl);
  if (!res.ok || !res.body) throw new Error(`L2 export file HTTP ${res.status}`);

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
