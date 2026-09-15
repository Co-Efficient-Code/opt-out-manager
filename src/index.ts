import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { authRoutes, requireAuth } from './auth';
import { listAccounts, filesForOrg } from './accounts';
import { scrubContacts, buildOptOutSet } from './scrub';
import { renderApp } from './ui';

type Variables = { user: SessionUser };

// HARD SAFETY SWITCH: writes to client S3 buckets are disabled.
const ALLOW_BUCKET_WRITES = false;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/health', (c) =>
  c.json({ ok: true, service: 'opt-out-manager', env: c.env.APP_ENV ?? 'unknown' }),
);

app.route('/auth', authRoutes);
app.use('*', requireAuth());

// --- UI ---
app.get('/', (c) => c.html(renderApp(c.get('user'), c.env.APP_ENV ?? '')));

// --- API ---
const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// List PAC accounts (read-only, derived from p2p prefixes)
api.get('/accounts', async (c) => {
  try {
    return c.json({ accounts: await listAccounts(c.env) });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// Files for one account
api.get('/accounts/:org/files', async (c) => {
  try {
    return c.json({ org: c.req.param('org'), files: await filesForOrg(c.env, c.req.param('org')) });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// Opt-out set summary for an account (count only, read-only)
api.get('/accounts/:org/optouts/summary', async (c) => {
  try {
    const set = await buildOptOutSet(c.env, c.req.param('org'));
    return c.json({ org: c.req.param('org'), optOutCount: set.size });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// SCRUB: upload a contact CSV, pick a PAC, get a cleaned file + stats.
// multipart form: file=<csv>, org=<pac>
api.post('/scrub', async (c) => {
  const form = await c.req.formData();
  const org = String(form.get('org') || '');
  const file = form.get('file');
  const phoneColRaw = form.get('phoneCol');
  const phoneCol =
    phoneColRaw != null && String(phoneColRaw) !== ''
      ? parseInt(String(phoneColRaw), 10)
      : undefined;
  if (!org) return c.json({ error: 'missing org' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  const csv = await file.text();
  try {
    const result = await scrubContacts(c.env, org, csv, phoneCol);
    const download = c.req.query('download') === '1';
    if (download) {
      const base = (file.name || 'contacts').replace(/\.csv$/i, '');
      return new Response(result.cleanedCsv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${base}_scrubbed_${org}.csv"`,
        },
      });
    }
    // return stats + cleaned csv inline (no download)
    return c.json({
      inputFile: file.name,
      ...result,
      cleanedCsv: undefined, // omit body from JSON summary
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// PUSH: DISABLED. Accepts request, validates, but never writes to a bucket.
api.post('/push', async (c) => {
  const form = await c.req.formData();
  const org = String(form.get('org') || '');
  const file = form.get('file');
  const fileName = file instanceof File ? file.name : null;
  if (!ALLOW_BUCKET_WRITES) {
    return c.json({
      ok: false,
      dryRun: true,
      wrote: false,
      message: 'Bucket writes are DISABLED. This is a dry run. No data was pushed to any S3 bucket.',
      wouldPush: {
        org,
        file: fileName,
        destinations: ['datadash-bigdogstrategies', 'datadash-creativedirect'],
      },
    }, 200);
  }
  // (unreachable while writes disabled)
  return c.json({ error: 'not implemented' }, 501);
});

app.route('/api', api);

export default app;
