import type { Env } from './types';
import { getObject } from './s3';
import { filesForOrg } from './accounts';
import { l2Config, pullEarlyVoters } from './l2';

/**
 * Read a byte stream as text lines without holding the whole file in memory.
 * Yields one line at a time (newline stripped). Handles \r\n and \n.
 */
async function* streamLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream('utf-8')).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      let line = buf.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      yield line;
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  if (buf.length > 0) {
    if (buf.endsWith('\r')) buf = buf.slice(0, -1);
    yield buf;
  }
}

/** Normalize a phone to 10 digits (strip country code, formatting). */
export function normalizePhone(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return null; // unusable
}

/** Split a CSV line respecting simple quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Find the index of the phone column from a header row. */
export function findPhoneColumn(header: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase());
  const candidates = ['phone', 'phone number', 'phonenumber', 'cell', 'mobile', 'phone_number'];
  for (const c of candidates) {
    const i = norm.indexOf(c);
    if (i >= 0) return i;
  }
  // fallback: first column that looks like phones
  return norm.findIndex((h) => h.includes('phone'));
}

/** Build the opt-out phone set for an org by reading its source files (READ ONLY). */
export async function buildOptOutSet(env: Env, org: string): Promise<Set<string>> {
  const files = await filesForOrg(env, org);
  const set = new Set<string>();
  for (const f of files) {
    const res = await getObject(env, 'source', f.key);
    if (!res.ok) continue;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) continue;
    const header = splitCsvLine(lines[0]);
    let phoneIdx = findPhoneColumn(header);
    // source files are `organization,phone` -> phone is col 1
    if (phoneIdx < 0) phoneIdx = header.length - 1;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = splitCsvLine(lines[i]);
      const p = normalizePhone(cols[phoneIdx] ?? '');
      if (p) set.add(p);
    }
  }
  return set;
}

export interface NormalizeResult {
  org: string;
  inputRows: number;
  validPhones: number;
  skipped: number;
  csv: string; // standard schema: organization,phone
}

/**
 * Normalize an uploaded opt-out CSV into the standard schema:
 *   organization,phone   (phone = raw 10 digits)
 * Handles standard files and off-format files (finds the phone column,
 * strips formatting). Dedupes phones.
 */
export function normalizeOptOutCsv(org: string, csv: string): NormalizeResult {
  const lines = csv.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  let phoneIdx = findPhoneColumn(header);
  if (phoneIdx < 0) phoneIdx = header.length - 1; // last col fallback
  const seen = new Set<string>();
  let inputRows = 0;
  let skipped = 0;
  const out: string[] = ['organization,phone'];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    inputRows++;
    const cols = splitCsvLine(lines[i]);
    const p = normalizePhone(cols[phoneIdx] ?? '');
    if (!p) { skipped++; continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(`${org},${p}`);
  }
  return {
    org,
    inputRows,
    validPhones: seen.size,
    skipped,
    csv: out.join('\n') + '\n',
  };
}

export interface ScrubResult {
  org: string;
  inputRows: number;
  phoneColumn: string;
  phoneColumnIndex: number;
  autoDetected: boolean;
  optOutSetSize: number;
  scrubbed: number;      // rows removed (matched an opt-out)
  kept: number;          // rows remaining
  unparseablePhones: number;
  cleanedCsv: string;    // resulting file content
}

/** Serialize a CSV field, quoting only when needed. */
function csvField(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

/** Build the opt-out phone set by streaming source files (bounded memory). */
export async function buildOptOutSetStreaming(
  env: Env,
  org: string,
  onFiles?: (count: number) => void,
): Promise<Set<string>> {
  const files = await filesForOrg(env, org);
  if (onFiles) onFiles(files.length);
  const set = new Set<string>();
  for (const f of files) {
    const res = await getObject(env, 'source', f.key);
    if (!res.ok || !res.body) continue;
    let header: string[] | null = null;
    let phoneIdx = -1;
    for await (const line of streamLines(res.body)) {
      if (header === null) {
        header = splitCsvLine(line);
        phoneIdx = findPhoneColumn(header);
        if (phoneIdx < 0) phoneIdx = header.length - 1;
        continue;
      }
      if (!line.trim()) continue;
      const cols = splitCsvLine(line);
      const p = normalizePhone(cols[phoneIdx] ?? '');
      if (p) set.add(p);
    }
  }
  return set;
}

/**
 * Streaming scrub: reads the uploaded file as a stream and writes the cleaned
 * output incrementally, so we never hold multiple full copies of a large file
 * in memory at once (avoids the Worker 128MB limit on 100k-row lists).
 */
export interface StreamScrubOptions {
  phoneCol?: number;
  /** If set, output keeps only these columns (by header name, case-insensitive), in this order. */
  keepColumns?: string[];
  /** Called with a human-readable progress message at each phase. */
  onProgress?: (msg: string) => void | Promise<void>;
  /**
   * Early-vote (already-voted) scrub. When `evState` is set and L2 is
   * configured, we pull that state's already-voted cell phones (statewide) and
   * remove them from the list AFTER the opt-out scrub, matching on cell phone.
   */
  evState?: string | null;
}

/** Early-vote scrub stats, attached to the scrub result when the EV scrub ran. */
export interface EarlyVoteScrub {
  ran: boolean;
  state: string;
  universeSize: number;   // already-voted cell phones pulled from L2
  removed: number;        // rows removed from the list because they already voted
  block: string;          // the L2 block code used (churn audit)
  castStatuses: string[]; // the cast statuses present in the state
  unmappedStatuses: string[];
  error?: string;         // set when the EV scrub could not run (L2 down / key)
}

export async function scrubContactsStreaming(
  env: Env,
  org: string,
  fileStream: ReadableStream<Uint8Array>,
  opts: StreamScrubOptions = {},
): Promise<ScrubResult & { keptColumns: string[]; droppedColumns: number; earlyVote?: EarlyVoteScrub }> {
  const phoneColOverride = opts.phoneCol;
  const emit = async (m: string) => { if (opts.onProgress) await opts.onProgress(m); };

  await emit('Reading opt-out list...');
  let fileCount = 0;
  const optOuts = await buildOptOutSetStreaming(env, org, (n) => { fileCount = n; });
  await emit(
    `Scrubbing against ${optOuts.size.toLocaleString()} opt-outs (${fileCount} source file${fileCount === 1 ? '' : 's'})...`,
  );

  // --- Early-vote (already-voted) phone set, pulled BEFORE we stream the file so
  // both scrubs happen in one pass. Non-fatal: if L2 is unavailable we record the
  // error and the list still scrubs against opt-outs. ---
  let evPhones: Set<string> | null = null;
  const ev: EarlyVoteScrub = {
    ran: false, state: opts.evState || '', universeSize: 0, removed: 0,
    block: '', castStatuses: [], unmappedStatuses: [],
  };
  if (opts.evState) {
    const cfg = l2Config(env);
    if (!cfg) {
      ev.error = 'L2 is not configured (no API key); early-vote scrub skipped.';
      await emit('Early-vote scrub skipped: L2 not configured.');
    } else {
      try {
        await emit(`Scrubbing early voters: pulling ${opts.evState} already-voted universe from L2...`);
        const r = await pullEarlyVoters(cfg, opts.evState, { onProgress: emit });
        evPhones = r.phones;
        ev.ran = true;
        ev.universeSize = r.phones.size;
        ev.block = r.block;
        ev.castStatuses = r.castStatuses;
        ev.unmappedStatuses = r.unmappedStatuses;
        await emit(`Early-vote universe: ${r.phones.size.toLocaleString()} already-voted cell phones in ${opts.evState}.`);
      } catch (e) {
        ev.error = e instanceof Error ? e.message : String(e);
        await emit(`Early-vote scrub FAILED (list still scrubbed against opt-outs): ${ev.error}`);
      }
    }
  }

  const outParts: string[] = [];
  let headerCols: string[] = [];
  let phoneIdx = -1;
  let headerSeen = false;
  let inputRows = 0;
  let scrubbed = 0;
  let unparseable = 0;

  // Column-trim setup (resolved after we see the header).
  const wantKeep = (opts.keepColumns || []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  let keepIdx: number[] | null = null; // indexes to keep, in output order
  let keptColumns: string[] = [];

  const projectLine = (cols: string[]): string =>
    keepIdx === null ? '' : keepIdx.map((i) => csvField(cols[i] ?? '')).join(',');

  for await (const line of streamLines(fileStream)) {
    if (!headerSeen) {
      headerSeen = true;
      headerCols = splitCsvLine(line);
      phoneIdx =
        typeof phoneColOverride === 'number' &&
        phoneColOverride >= 0 &&
        phoneColOverride < headerCols.length
          ? phoneColOverride
          : findPhoneColumn(headerCols);
      if (phoneIdx < 0) phoneIdx = 0;
      // Resolve which columns to keep.
      if (wantKeep.length > 0) {
        const lower = headerCols.map((h) => h.trim().toLowerCase());
        keepIdx = [];
        for (const name of wantKeep) {
          const i = lower.indexOf(name);
          if (i >= 0) keepIdx.push(i);
        }
        // Safety: always keep the phone column so downstream detection works.
        if (!keepIdx.includes(phoneIdx)) keepIdx.push(phoneIdx);
        keptColumns = keepIdx.map((i) => headerCols[i]);
        outParts.push(keepIdx.map((i) => csvField(headerCols[i] ?? '')).join(','));
        await emit(`Trimming to ${keepIdx.length} column${keepIdx.length === 1 ? '' : 's'}, scrubbing rows...`);
      } else {
        keptColumns = headerCols;
        outParts.push(line);
      }
      continue;
    }
    if (!line.trim()) continue;
    inputRows++;
    const cols = splitCsvLine(line);
    const p = normalizePhone(cols[phoneIdx] ?? '');
    const outLine = keepIdx === null ? line : projectLine(cols);
    if (!p) { unparseable++; outParts.push(outLine); continue; }
    if (optOuts.has(p)) { scrubbed++; continue; }        // opt-out removed first
    if (evPhones && evPhones.has(p)) { ev.removed++; continue; } // then already-voted
    outParts.push(outLine);
  }

  await emit('Building cleaned file...');
  return {
    org,
    inputRows,
    phoneColumn: headerCols[phoneIdx] ?? `col ${phoneIdx}`,
    phoneColumnIndex: phoneIdx,
    autoDetected: typeof phoneColOverride !== 'number',
    optOutSetSize: optOuts.size,
    scrubbed,
    kept: inputRows - scrubbed - ev.removed,
    unparseablePhones: unparseable,
    cleanedCsv: outParts.join('\n'),
    keptColumns,
    droppedColumns: Math.max(0, headerCols.length - keptColumns.length),
    earlyVote: opts.evState ? ev : undefined,
  };
}

/**
 * Scrub an uploaded contact CSV against an org's opt-out set.
 * Removes any row whose phone matches an opt-out. Returns cleaned CSV + stats.
 * Does NOT write anything anywhere.
 */
export async function scrubContacts(
  env: Env,
  org: string,
  csv: string,
  phoneColOverride?: number,
): Promise<ScrubResult> {
  const optOuts = await buildOptOutSet(env, org);
  const lines = csv.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  let phoneIdx =
    typeof phoneColOverride === 'number' && phoneColOverride >= 0 && phoneColOverride < header.length
      ? phoneColOverride
      : findPhoneColumn(header);
  if (phoneIdx < 0) phoneIdx = 0;

  const outLines: string[] = [lines[0] ?? ''];
  let inputRows = 0;
  let scrubbed = 0;
  let unparseable = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    inputRows++;
    const cols = splitCsvLine(lines[i]);
    const p = normalizePhone(cols[phoneIdx] ?? '');
    if (!p) { unparseable++; outLines.push(lines[i]); continue; }
    if (optOuts.has(p)) { scrubbed++; continue; } // drop opted-out row
    outLines.push(lines[i]);
  }

  return {
    org,
    inputRows,
    phoneColumn: header[phoneIdx] ?? `col ${phoneIdx}`,
    phoneColumnIndex: phoneIdx,
    autoDetected: typeof phoneColOverride !== 'number',
    optOutSetSize: optOuts.size,
    scrubbed,
    kept: inputRows - scrubbed,
    unparseablePhones: unparseable,
    cleanedCsv: outLines.join('\n'),
  };
}
