import type { Env } from './types';
import { getObject } from './s3';
import { filesForOrg } from './accounts';

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

/** Build the opt-out phone set by streaming source files (bounded memory). */
export async function buildOptOutSetStreaming(env: Env, org: string): Promise<Set<string>> {
  const files = await filesForOrg(env, org);
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
export async function scrubContactsStreaming(
  env: Env,
  org: string,
  fileStream: ReadableStream<Uint8Array>,
  phoneColOverride?: number,
): Promise<ScrubResult> {
  const optOuts = await buildOptOutSetStreaming(env, org);
  const outParts: string[] = [];
  let headerCols: string[] = [];
  let phoneIdx = -1;
  let headerSeen = false;
  let inputRows = 0;
  let scrubbed = 0;
  let unparseable = 0;

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
      outParts.push(line);
      continue;
    }
    if (!line.trim()) continue;
    inputRows++;
    const cols = splitCsvLine(line);
    const p = normalizePhone(cols[phoneIdx] ?? '');
    if (!p) { unparseable++; outParts.push(line); continue; }
    if (optOuts.has(p)) { scrubbed++; continue; }
    outParts.push(line);
  }

  return {
    org,
    inputRows,
    phoneColumn: headerCols[phoneIdx] ?? `col ${phoneIdx}`,
    phoneColumnIndex: phoneIdx,
    autoDetected: typeof phoneColOverride !== 'number',
    optOutSetSize: optOuts.size,
    scrubbed,
    kept: inputRows - scrubbed,
    unparseablePhones: unparseable,
    cleanedCsv: outParts.join('\n'),
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
