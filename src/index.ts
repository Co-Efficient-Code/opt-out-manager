import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { authRoutes, requireAuth } from './auth';
import { getObject, listObjects, pushToAll } from './s3';

type Variables = { user: SessionUser };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public health check
app.get('/health', (c) =>
  c.json({ ok: true, service: 'opt-out-manager', env: c.env.APP_ENV ?? 'unknown' }),
);

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
<h1>Opt-Out Manager <small>(${c.env.APP_ENV ?? ''})</small></h1>
<p>Signed in as <strong>${user.email}</strong>. <a href="/auth/logout">Log out</a></p>
<h2>Data flow</h2>
<ul>
  <li>PULL from <code>datadash-p2p</code> (vendor opt-outs)</li>
  <li>PUSH to <code>datadash-bigdogstrategies</code> and <code>datadash-creativedirect</code></li>
</ul>
<ul>
  <li><a href="/api/source">List source opt-outs (p2p)</a></li>
</ul>
</body></html>`);
});

// --- API ---
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// List objects available in the SOURCE (p2p) bucket
api.get('/source', async (c) => {
  const res = await listObjects(c.env, 'source', 'optouts/');
  const xml = await res.text();
  if (!res.ok) return c.json({ error: 'source list failed', status: res.status, body: xml }, 502);
  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// Pull a single record from the SOURCE (p2p) bucket
api.get('/source/:key', async (c) => {
  const res = await getObject(c.env, 'source', `optouts/${c.req.param('key')}`);
  if (!res.ok) return c.json({ error: 'not found', status: res.status }, res.status as any);
  return new Response(res.body, { headers: { 'Content-Type': 'application/json' } });
});

// Push a record to BOTH destinations (bigdog + creativedirect)
api.put('/push/:key', async (c) => {
  const body = await c.req.text();
  const results = await pushToAll(c.env, `optouts/${c.req.param('key')}`, body);
  const allOk = results.every((r) => r.ok);
  return c.json({ ok: allOk, key: c.req.param('key'), results }, allOk ? 200 : 502);
});

// Sync: pull a key from source, fan out to both destinations
api.post('/sync/:key', async (c) => {
  const key = `optouts/${c.req.param('key')}`;
  const src = await getObject(c.env, 'source', key);
  if (!src.ok) return c.json({ error: 'source fetch failed', status: src.status }, 502);
  const body = await src.arrayBuffer();
  const results = await pushToAll(c.env, key, body);
  const allOk = results.every((r) => r.ok);
  return c.json({ ok: allOk, key: c.req.param('key'), synced: results }, allOk ? 200 : 502);
});

app.route('/api', api);

export default app;
