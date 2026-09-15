import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser } from './types';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const COOKIE = 'oom_session';
const SESSION_TTL = 60 * 60 * 8; // 8h

function redirectUri(url: URL): string {
  return `${url.protocol}//${url.host}/auth/callback`;
}

// --- Signed session cookie (HMAC) ---
async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function encodeSession(user: SessionUser, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(user));
  const sig = await sign(payload, secret);
  return `${payload}.${sig}`;
}

export async function decodeSession(
  token: string,
  secret: string,
): Promise<SessionUser | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if ((await sign(payload, secret)) !== sig) return null;
  try {
    const user = JSON.parse(atob(payload)) as SessionUser;
    if (user.exp < Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch {
    return null;
  }
}

// --- Middleware: require an authenticated coefficient.org user ---
export function requireAuth() {
  return async (c: any, next: any) => {
    const token = getCookie(c, COOKIE);
    if (!token) return c.redirect('/auth/login');
    const user = await decodeSession(token, c.env.SESSION_SECRET);
    if (!user) return c.redirect('/auth/login');
    if (user.hd !== c.env.GOOGLE_HOSTED_DOMAIN) {
      return c.text('Forbidden: not a coefficient.org account', 403);
    }
    c.set('user', user);
    await next();
  };
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get('/login', (c) => {
  const url = new URL(c.req.url);
  const state = crypto.randomUUID();
  setCookie(c, 'oom_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    scope: 'openid email profile',
    hd: c.env.GOOGLE_HOSTED_DOMAIN,
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return c.redirect(`${GOOGLE_AUTH}?${params.toString()}`);
});

authRoutes.get('/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = getCookie(c, 'oom_state');
  if (!code || !state || state !== savedState) {
    return c.text('Invalid auth state', 400);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return c.text('Token exchange failed', 502);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const infoRes = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return c.text('Userinfo fetch failed', 502);
  const info = (await infoRes.json()) as {
    email: string;
    name: string;
    picture?: string;
    hd?: string;
    email_verified: boolean;
  };

  if (info.hd !== c.env.GOOGLE_HOSTED_DOMAIN || !info.email_verified) {
    return c.text('Forbidden: coefficient.org accounts only', 403);
  }

  const user: SessionUser = {
    email: info.email,
    name: info.name,
    picture: info.picture,
    hd: info.hd,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  };
  const session = await encodeSession(user, c.env.SESSION_SECRET);
  setCookie(c, COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: SESSION_TTL,
    path: '/',
  });
  deleteCookie(c, 'oom_state', { path: '/' });
  return c.redirect('/');
});

authRoutes.get('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.redirect('/auth/login');
});
