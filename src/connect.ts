import type { Env } from './types';
import { parseUploadCsv } from './runlogs';
import type { RgopOptOut } from './rgop';

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
