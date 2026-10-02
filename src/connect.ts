import type { Env } from './types';
import { parseUploadCsv } from './runlogs';
import type { RgopOptOut } from './rgop';

/**
 * Memory-bounded co/nnect pull: fetch the export and reduce it row-by-row via
 * `onRow`, never building a full grid or row array (the 6.9MB export expands to
 * ~60k row objects, which combined with other sources blew the Worker's memory
 * budget). Parses the CSV line by line, matching columns by header name. Applies
 * the same defensive filters (skip reinstated / non-"opted out"). Returns counts.
 */
export async function pullConnectOptOutsReduce(
  env: Env,
  onRow: (phone: string | null, project: string) => void,
): Promise<{ totalRows: number; usableRows: number; skipped: number }> {
  const token = (env.CONNECT_API_TOKEN || '').trim();
  if (!token) throw new Error('CONNECT_API_TOKEN is not configured');
  const url = (env.CONNECT_API_URL || DEFAULT_CONNECT_URL).trim();
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/csv' },
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`co/nnect export HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('co/nnect export returned no body');

  const reader = res.body.pipeThrough(new TextDecoderStream('utf-8')).getReader();
  let buf = '';
  let header: string[] | null = null;
  let pIdx = -1, projIdx = -1, statusIdx = -1, reinstIdx = -1;
  let totalRows = 0, usableRows = 0, skipped = 0;

  const handle = (line: string) => {
    if (header === null) {
      header = splitCsvLine(line).map((h) => h.replace(/^\uFEFF/, '').trim());
      const lower = header.map((h) => h.toLowerCase());
      pIdx = lower.findIndex((h) => h === 'phone' || h.includes('phone'));
      projIdx = lower.findIndex((h) => h === 'project');
      if (projIdx < 0) projIdx = lower.findIndex((h) => h.includes('project'));
      statusIdx = lower.findIndex((h) => h === 'status');
      reinstIdx = lower.findIndex((h) => h.includes('reinstated'));
      if (pIdx < 0) throw new Error('co/nnect export: no phone column');
      if (projIdx < 0) throw new Error('co/nnect export: no project column');
      return;
    }
    if (!line.trim()) return;
    totalRows++;
    const cols = splitCsvLine(line);
    if (reinstIdx >= 0 && (cols[reinstIdx] || '').trim() !== '') { skipped++; return; }
    if (statusIdx >= 0) {
      const st = (cols[statusIdx] || '').trim().toLowerCase();
      if (st && st !== 'opted out') { skipped++; return; }
    }
    const project = (cols[projIdx] ?? '').replace(/\t/g, ' ').trim();
    onRow(cols[pIdx] ?? null, project);
    usableRows++;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      let line = buf.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      handle(line);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  if (buf.length) { if (buf.endsWith('\r')) buf = buf.slice(0, -1); handle(buf); }
  return { totalRows, usableRows, skipped };
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

/**
 * co/nnect (txt.coefficient.org) opt-out export - READ ONLY.
 *
 * The nightly sync pulls opt-outs from ReadyGOP AND from co/nnect, our other
 * texting platform. co/nnect exposes a single CSV export of ALL its opt-outs:
 *
 *   GET https://txt.coefficient.org/api/v1/opt-outs/export.csv
 *       Authorization: Bearer <CONNECT_API_TOKEN>
 *
 * That endpoint responds 302 -> a short-lived presigned S3 URL (the vendor's
 * own export bucket, us-east-2). We must follow the redirect to get the CSV.
 *
 * The CSV columns are the SAME family the manual-drop upload already accepts
 * (Phone, Project, Source, Keyword, Opted Out At (UTC), Status, ...), so we
 * reuse parseUploadCsv - it matches columns by HEADER NAME (not position), so
 * the raw co/nnect export parses directly with no transform. It also drops
 * reinstated / non-"Opted Out" rows defensively.
 *
 * The token is a Worker SECRET (never in code/git). If it is unset, the caller
 * skips co/nnect entirely (non-fatal): the run proceeds with ReadyGOP only.
 */

const DEFAULT_CONNECT_URL = 'https://txt.coefficient.org/api/v1/opt-outs/export.csv';

export interface ConnectPullResult {
  rows: RgopOptOut[];
  totalRows: number;   // data rows in the export (excl header)
  usableRows: number;  // rows with a valid phone (what we keep)
  skipped: number;     // dropped (no phone / reinstated / not opted out)
}

/** True when a co/nnect token is configured (so the caller can decide to pull). */
export function connectConfigured(env: Env): boolean {
  return !!(env.CONNECT_API_TOKEN && env.CONNECT_API_TOKEN.trim());
}

/**
 * Pull ALL co/nnect opt-outs and return them as RgopOptOut[] (same shape the
 * ReadyGOP pull yields), so they merge into buildRunLog unchanged.
 *
 * Throws on transport/auth/parse failure. The caller treats co/nnect failures
 * as non-fatal and continues with ReadyGOP only.
 */
export async function pullConnectOptOuts(env: Env): Promise<ConnectPullResult> {
  const token = (env.CONNECT_API_TOKEN || '').trim();
  if (!token) throw new Error('CONNECT_API_TOKEN is not configured');
  const url = (env.CONNECT_API_URL || DEFAULT_CONNECT_URL).trim();

  // redirect: 'follow' makes fetch chase the 302 to the presigned S3 URL. The
  // Authorization header is only sent to the first host; S3 uses its own signed
  // query params, so dropping the header on the hop is correct.
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/csv' },
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`co/nnect export HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text.trim()) throw new Error('co/nnect export returned an empty body');

  const parsed = parseUploadCsv(text);
  // Tag every row with its platform so the run log / email can attribute each
  // project to co/nnect. Projects are unique to one platform.
  const rows = parsed.rows.map((r) => ({ ...r, platform: 'co/nnect' as const }));
  return {
    rows,
    totalRows: parsed.totalRows,
    usableRows: parsed.usableRows,
    skipped: parsed.skippedNoPhone,
  };
}
