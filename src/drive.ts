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
    `&fields=files(id,name,mimeType,modifiedTime,size,webViewLink)&orderBy=name`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { files: DriveFile[] }).files || [];
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
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
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
