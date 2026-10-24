import type { Env } from './types';

/**
 * Google Sheets READ-ONLY client for the Sales Tracker (billing source of truth).
 *
 * SAFETY: read-only. We request only the spreadsheets.readonly scope and only
 * ever issue GET /values reads. This module must NEVER write to or modify the
 * Sales Tracker - it is the company's internal source of truth.
 *
 * Uses the same service account as Drive (GOOGLE_SA_KEY secret, identity
 * sally-bruce@coefficient-org.iam.gserviceaccount.com), which has read access to
 * the sheet. Token is minted fresh per call with the readonly scope only.
 */

interface SAKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/** Mint a READ-ONLY Sheets access token for the service account. */
async function getReadonlyToken(env: Env): Promise<string> {
  if (!env.GOOGLE_SA_KEY) throw new Error('GOOGLE_SA_KEY is not configured');
  const key = JSON.parse(env.GOOGLE_SA_KEY) as SAKey;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud: key.token_uri || 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claim}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Sheets token error: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Read a range (READ ONLY). Returns the raw 2D value grid (unformatted). */
async function readRange(env: Env, spreadsheetId: string, range: string): Promise<unknown[][]> {
  const token = await getReadonlyToken(env);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { values?: unknown[][] };
  return data.values || [];
}

/** Read one COLUMN (READ ONLY) by column letter via majorDimension=COLUMNS, so
 * the payload is a single array, not a wide grid. Used to pull just a send
 * list's phone column from an oversized native Google Sheet (the Drive CSV
 * export has a ~10MB cap; the values API paginates and has no such cap). */
async function readColumn(
  env: Env,
  spreadsheetId: string,
  tab: string,
  colLetter: string,
): Promise<unknown[]> {
  const token = await getReadonlyToken(env);
  const range = `${tab}!${colLetter}:${colLetter}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets column read error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values && data.values[0]) || [];
}

function colLetter(idx0: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA ...
  let n = idx0;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Read a send-list send-list PHONE column from a native Google Sheet via the
 * values API (READ ONLY). Finds the phone column from the header row, then
 * pulls only that column. Returns the raw string cell values (caller normalizes).
 * This is the fallback for Sheets too large for Drive CSV export.
 */
export async function readSheetPhoneColumn(env: Env, spreadsheetId: string): Promise<string[]> {
  // First tab, header row.
  const headerGrid = await readRange(env, spreadsheetId, 'A1:Z1');
  const header = (headerGrid[0] || []).map((h) => String(h ?? '').trim());
  if (!header.length) throw new Error('sheet has no header row');
  let idx = header.findIndex((h) => h.replace(/\s+/g, '').toLowerCase() === 'cellphone');
  if (idx < 0) idx = header.findIndex((h) => /phone|cell|mobile/i.test(h));
  if (idx < 0) throw new Error(`sheet has no phone column (header: ${header.join(',').slice(0, 160)})`);
  // Determine the first tab name (values API default range needs a tab name for
  // the column read; A1:Z1 above used the default first tab implicitly).
  const tab = await firstTabName(env, spreadsheetId);
  const col = await readColumn(env, spreadsheetId, tab, colLetter(idx));
  // Drop the header cell.
  return col.slice(1).map((v) => String(v ?? ''));
}

/** Get the first sheet/tab title (READ ONLY metadata). */
async function firstTabName(env: Env, spreadsheetId: string): Promise<string> {
  const token = await getReadonlyToken(env);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?fields=sheets(properties(title,index))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets metadata error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { sheets?: Array<{ properties?: { title?: string; index?: number } }> };
  const sheets = data.sheets || [];
  const first = sheets.slice().sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0))[0];
  return first?.properties?.title || 'Sheet1';
}

// Sales Tracker config. The spreadsheet id + tab are stable; column headers are
// matched by NAME (not fixed index) so a column reorder won't silently break us.
const SALES_TRACKER_ID = '1xMKqkIYzzqATrfhEyGGXY91VqKIqJZr3Pp1YWWFZuuk';
const SALES_TRACKER_TAB = 'Sales Tracker';

export interface VolumeMap {
  /** project number (string) -> billed Volume (integer). Missing = not in sheet. */
  volume: Map<string, number>;
  /** project numbers present in the sheet but with a BLANK Volume cell. */
  blank: Set<string>;
  rowsScanned: number;
}

/**
 * Pull the Sales Tracker Volume keyed by project number (the `#` column).
 * READ ONLY. Matches columns by header name: `#`, `Project`, `Volume`.
 *
 * - A numeric Volume -> volume map entry (billed texts for that project).
 * - A row present with a BLANK Volume -> added to `blank` (caller renders "N/A").
 * - A project not present at all -> absent from both (caller also renders "N/A").
 */
export async function pullSalesTrackerVolume(env: Env): Promise<VolumeMap> {
  // Header + data in one read. Columns are far left (#, Project, ... Volume=AB).
  const grid = await readRange(env, SALES_TRACKER_ID, `${SALES_TRACKER_TAB}!A1:AB3000`);
  const volume = new Map<string, number>();
  const blank = new Set<string>();
  if (!grid.length) return { volume, blank, rowsScanned: 0 };

  const header = (grid[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const numIdx = header.findIndex((h) => h === '#');
  const volIdx = header.findIndex((h) => h === 'volume');
  if (numIdx < 0 || volIdx < 0) {
    throw new Error(`Sales Tracker: could not find '#' and 'Volume' columns (found: ${header.filter(Boolean).join(', ').slice(0, 200)})`);
  }

  let rowsScanned = 0;
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const rawNum = row[numIdx];
    if (rawNum === undefined || rawNum === null || String(rawNum).trim() === '') continue;
    // Normalize the project number to a bare integer string (sheet may store it
    // as a number -> "261173" or occasionally "261173.0").
    const num = String(rawNum).replace(/\.0+$/, '').trim();
    if (!/^\d+$/.test(num)) continue;
    rowsScanned++;
    const rawVol = volIdx < row.length ? row[volIdx] : undefined;
    if (rawVol === undefined || rawVol === null || String(rawVol).trim() === '') {
      if (!volume.has(num)) blank.add(num);
      continue;
    }
    const v = Number(String(rawVol).replace(/[, ]/g, ''));
    if (Number.isFinite(v)) {
      volume.set(num, Math.round(v));
      blank.delete(num);
    } else {
      if (!volume.has(num)) blank.add(num);
    }
  }
  return { volume, blank, rowsScanned };
}
