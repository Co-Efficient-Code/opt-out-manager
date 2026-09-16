import type { Env } from './types';

/**
 * Gmail send via the same service account used for Drive (GOOGLE_SA_KEY),
 * using domain-wide delegation to impersonate a real workspace mailbox.
 *
 * Mirrors the engine's api/email/sender.go approach: mint a JWT with the
 * gmail.send scope and `sub` set to the sender mailbox, exchange it for an
 * access token, and POST a raw RFC-2822 message to the Gmail REST API.
 *
 * Requires the SA's client ID to have domain-wide delegation for the
 * https://www.googleapis.com/auth/gmail.send scope (Workspace Admin setting).
 * If that is missing the token exchange fails with unauthorized_client.
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

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s));
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

/** Mint an access token for the SA impersonating `subject` with gmail.send. */
async function getGmailToken(env: Env, subject: string): Promise<string> {
  if (!env.GOOGLE_SA_KEY) throw new Error('GOOGLE_SA_KEY is not configured');
  const key = JSON.parse(env.GOOGLE_SA_KEY) as SAKey;
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(
    JSON.stringify({
      iss: key.client_email,
      sub: subject, // impersonate this mailbox (domain-wide delegation)
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: key.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
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
  if (!res.ok) {
    const body = await res.text();
    // unauthorized_client here almost always means domain-wide delegation for
    // gmail.send is not granted for this service account's client ID.
    throw new Error(`Gmail token error ${res.status}: ${body.slice(0, 300)}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

function encodeHeader(s: string): string {
  // RFC 2047 encode so accents/commas in subject or name do not break headers.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?utf-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

export interface EmailMessage {
  fromEmail: string;
  fromName?: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** Send `msg` as msg.fromEmail (must be a real workspace mailbox). */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<{ id: string }> {
  if (!msg.fromEmail) throw new Error('no sender address');
  if (!msg.to.length) throw new Error('no recipients');
  const token = await getGmailToken(env, msg.fromEmail);

  const from = msg.fromName
    ? `${encodeHeader(msg.fromName)} <${msg.fromEmail}>`
    : msg.fromEmail;
  const boundary = 'boundary_coefficient_optout';
  const lines = [
    `From: ${from}`,
    `To: ${msg.to.join(', ')}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary=${boundary}`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    msg.text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    msg.html,
    `--${boundary}--`,
  ];
  const raw = b64url(new TextEncoder().encode(lines.join('\r\n')));

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail send error ${res.status}: ${body.slice(0, 300)}`);
  }
  const out = (await res.json()) as { id: string };
  return { id: out.id };
}
