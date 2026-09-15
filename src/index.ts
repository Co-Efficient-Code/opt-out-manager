import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { authRoutes, requireAuth } from './auth';
import { getObject, putObject, listObjects } from './s3';

type Variables = { user: SessionUser };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public health check
app.get('/health', (c) => c.json({ ok: true, service: 'opt-out-manager' }));

// Auth routes (login/callback/logout)
app.route('/auth', authRoutes);

// Everything below requires a signed-in coefficient.org user
app.use('*', requireAuth());

app.get('/', (c) => {
  const user = c.get('user');
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>Opt-Out Manager</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1rem}</style>
</head><body>
<h1>Opt-Out Manager</h1>
<p>Signed in as <strong>${user.email}</strong>. <a href="/auth/logout">Log out</a></p>
<ul>
  <li><a href="/api/optouts">List opt-outs (from S3)</a></li>
</ul>
</body></html>`);
});

// --- API ---
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// List objects / opt-out records from client S3 bucket
api.get('/optouts', async (c) => {
  const res = await listObjects(c.env, 'optouts/');
  const xml = await res.text();
  if (!res.ok) return c.json({ error: 'S3 list failed', status: res.status, body: xml }, 502);
  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// Pull a single record
api.get('/optouts/:key', async (c) => {
  const res = await getObject(c.env, `optouts/${c.req.param('key')}`);
  if (!res.ok) return c.json({ error: 'not found', status: res.status }, res.status as any);
  return new Response(res.body, { headers: { 'Content-Type': 'application/json' } });
});

// Push a record
api.put('/optouts/:key', async (c) => {
  const body = await c.req.text();
  const res = await putObject(c.env, `optouts/${c.req.param('key')}`, body);
  if (!res.ok) return c.json({ error: 'S3 put failed', status: res.status }, 502);
  return c.json({ ok: true, key: c.req.param('key') });
});

app.route('/api', api);

export default app;
