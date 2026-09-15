import type { Env } from './types';
import { getObject } from './s3';
import { filesForOrg } from './accounts';

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
