import type { Env } from './types';

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

// Mint a Google OAuth access token for the service account (scope: drive).
async function getAccessToken(env: Env): Promise<string> {
  const key = JSON.parse(env.GOOGLE_SA_KEY) as SAKey;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/drive',
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
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Drive token error: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export type DriveDest = 'bigdog' | 'creativedirect';

export function driveFolderFor(env: Env, dest: DriveDest): string {
  const id = dest === 'bigdog' ? env.DRIVE_FOLDER_BIGDOG : env.DRIVE_FOLDER_CREATIVEDIRECT;
  if (!id) throw new Error(`Drive folder not configured for ${dest}`);
  return id;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

/** List files in a folder (read-only). */
export async function driveList(env: Env, folderId: string): Promise<DriveFile[]> {
  const token = await getAccessToken(env);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=name` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { files: DriveFile[] }).files || [];
}

/** Download a Drive file's raw bytes as text (read-only, alt=media). */
export async function driveDownloadText(env: Env, fileId: string): Promise<string> {
  const token = await getAccessToken(env);
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download error: ${res.status} ${await res.text()}`);
  return res.text();
}

/** Open a streaming download of a Drive file (alt=media). Returns the raw
 * fetch Response so the caller can pipe `.body` straight to the client without
 * buffering the whole file in the Worker. Read-only. */
export async function driveDownloadStream(env: Env, fileId: string): Promise<Response> {
  const token = await getAccessToken(env);
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.body) {
    throw new Error(`Drive download error: ${res.status} ${res.ok ? '(no body)' : await res.text()}`);
  }
  return res;
}

/** The native Google mime type for Sheets (files that were opened/edited in
 * Google and converted away from plain CSV). These cannot be fetched with
 * alt=media; they must be EXPORTED. */
export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** Export a native Google Sheet as CSV text (read-only). NOTE: Sheets export
 * returns only the FIRST tab. Our scrubbed send lists are single-tab. */
export async function driveExportSheetCsv(env: Env, fileId: string): Promise<string> {
  const token = await getAccessToken(env);
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `/export?mimeType=text/csv&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive export error: ${res.status} ${await res.text()}`);
  return res.text();
}

/** Download a send-list file as CSV text regardless of whether it is a real CSV
 * (alt=media) or a native Google Sheet (export). Branch on mimeType so files
 * that were opened in Google and converted to Sheets still get ingested. */
export async function driveDownloadCsvText(
  env: Env,
  fileId: string,
  mimeType?: string,
): Promise<string> {
  if (mimeType === GOOGLE_SHEET_MIME) return driveExportSheetCsv(env, fileId);
  return driveDownloadText(env, fileId);
}

/**
 * Upload CSV content as a file into a folder. Returns the created file id.
 * (No overwrite protection at Drive level; Drive allows same-named files.)
 */
export async function driveUploadCsv(
  env: Env,
  folderId: string,
  name: string,
  csv: string,
): Promise<{ id: string; name: string }> {
  const token = await getAccessToken(env);
  const boundary = 'oomBoundary' + crypto.randomUUID();
  const metadata = { name, parents: [folderId], mimeType: 'text/csv' };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: text/csv\r\n\r\n' +
    csv +
    `\r\n--${boundary}--`;
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload error: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; name: string };
}

/**
 * Upload CSV content into a folder by STREAMING the body, so the full file is
 * never materialized as a single string in the Worker. Uses Drive's resumable
 * upload protocol: (1) POST to open a session and get an upload URL, then
 * (2) PUT the body as a ReadableStream to that URL. Memory stays flat regardless
 * of file size (fixes the large-file OOM). Returns the created file id/name.
 *
 * Note: the caller supplies `body` as a ReadableStream<Uint8Array>. For chunked
 * (unknown-length) transfer we omit Content-Length; Drive accepts a single
 * streamed PUT that finalizes the file.
 */
export async function driveUploadCsvStream(
  env: Env,
  folderId: string,
  name: string,
  body: ReadableStream<Uint8Array>,
): Promise<{ id: string; name: string }> {
  const uploadUrl = await driveResumableInit(env, folderId, name);
  return driveResumablePut(uploadUrl, body);
}

/**
 * Open a Drive resumable upload session and return the session URL. Doing this
 * as a SEPARATE step (before any body is produced) lets the caller fail fast on
 * auth/init errors and only then start generating the (large) body, avoiding a
 * race where a not-yet-consumed stream errors out.
 */
export async function driveResumableInit(
  env: Env,
  folderId: string,
  name: string,
): Promise<string> {
  const token = await getAccessToken(env);
  const metadata = { name, parents: [folderId], mimeType: 'text/csv' };
  const init = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'text/csv',
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!init.ok) throw new Error(`Drive resumable init error: ${init.status} ${await init.text()}`);
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new Error('Drive resumable init: missing upload URL (Location header)');
  return uploadUrl;
}

/** PUT a streamed body to an already-open resumable session URL. */
export async function driveResumablePut(
  uploadUrl: string,
  body: ReadableStream<Uint8Array>,
): Promise<{ id: string; name: string }> {
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/csv' },
    body,
    // Cloudflare requires this hint for streaming request bodies.
    // @ts-expect-error - duplex is valid in the Workers runtime fetch.
    duplex: 'half',
  });
  if (!put.ok) throw new Error(`Drive resumable upload error: ${put.status} ${await put.text()}`);
  return (await put.json()) as { id: string; name: string };
}
