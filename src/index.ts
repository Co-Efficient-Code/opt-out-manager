import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { authRoutes, requireAuth } from './auth';
import { listAccounts, listAccountsForRole, filesForOrg, listFilesForRole } from './accounts';
import type { SyncRole } from './s3';
import { scrubContacts, buildOptOutSet, normalizeOptOutCsv } from './scrub';
import { putObjectNoOverwrite } from './s3';
import { fileToCsv } from './parsefile';
import { renderApp } from './ui';

type Variables = { user: SessionUser };

// SAFETY: writes to client S3 buckets.
// ALLOW_BUCKET_WRITES enables the real push path.
// TEST_PAC_ONLY restricts writes to the test account only, so real client
// buckets cannot be touched while we validate end-to-end.
const ALLOW_BUCKET_WRITES = true;
const TEST_PAC_ONLY = true;
const TEST_PAC = 'testing-nightly-batch';

function pad(n: number): string { return String(n).padStart(2, '0'); }
function stampNow(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

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

// PAC list for the upload flow: all PACs from p2p (source) UNION any that
// already exist in the chosen destination bucket (e.g. testing accounts).
// Read-only.
api.get('/accounts/dest/:dest', async (c) => {
  const map: Record<string, SyncRole> = { bigdog: 'bigdog', creativedirect: 'creativedirect' };
  const role = map[c.req.param('dest')];
  if (!role) return c.json({ error: 'invalid destination' }, 400);
  try {
    // Union PACs across source (p2p) and BOTH destination buckets so testing/
    // one-off accounts show up regardless of which destination is selected.
    const [source, bigdog, cd] = await Promise.all([
      listAccounts(c.env),
      listAccountsForRole(c.env, 'bigdog'),
      listAccountsForRole(c.env, 'creativedirect'),
    ]);
    const orgs = new Set<string>();
    for (const a of [...source, ...bigdog, ...cd]) orgs.add(a.org);
    const accounts = [...orgs].sort((x, y) => x.localeCompare(y)).map((org) => ({ org }));
    return c.json({ dest: c.req.param('dest'), accounts });
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

// BROWSE: read-only listing of a bucket's folders + files. No download.
api.get('/browse/:bucket', async (c) => {
  const map: Record<string, { role: SyncRole; name: string }> = {
    p2p: { role: 'source', name: 'datadash-p2p' },
    bigdog: { role: 'bigdog', name: 'datadash-bigdogstrategies' },
    creativedirect: { role: 'creativedirect', name: 'datadash-creativedirect' },
  };
  const info = map[c.req.param('bucket')];
  if (!info) return c.json({ error: 'invalid bucket' }, 400);
  try {
    const files = await listFilesForRole(c.env, info.role);
    // group by org (folder)
    const folders: Record<string, { file: string; size: number; lastModified: string }[]> = {};
    for (const f of files) {
      const parts = f.key.split('/');
      const org = parts.length >= 3 && parts[0] === 'optouts' ? parts[1] : '(root)';
      (folders[org] ??= []).push({ file: f.file, size: f.size, lastModified: f.lastModified });
    }
    for (const k of Object.keys(folders)) {
      folders[k].sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    }
    return c.json({
      bucket: info.name,
      fileCount: files.length,
      folderCount: Object.keys(folders).length,
      folders,
    });
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
  let csv: string;
  try {
    csv = await fileToCsv(file);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
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
  const dest = String(form.get('dest') || '');
  const file = form.get('file');
  const fileName = file instanceof File ? file.name : null;
  const destMap: Record<string, { bucket: string; label: string }> = {
    bigdog: { bucket: 'datadash-bigdogstrategies', label: 'Big Dog Strategies' },
    creativedirect: { bucket: 'datadash-creativedirect', label: 'Creative Direct' },
  };
  const destInfo = destMap[dest];
  const role = dest as SyncRole;
  if (!org) return c.json({ error: 'missing org' }, 400);
  if (!destInfo) return c.json({ error: 'missing or invalid destination' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);

  if (!ALLOW_BUCKET_WRITES) {
    return c.json({
      ok: false, dryRun: true, wrote: false,
      message: 'Bucket writes are DISABLED. This is a dry run.',
      wouldPush: { org, file: fileName, destination: destInfo.bucket, destinationLabel: destInfo.label },
    }, 200);
  }

  // Test-only lock: refuse writes to any real PAC while validating.
  if (TEST_PAC_ONLY && org !== TEST_PAC) {
    return c.json({
      ok: false, wrote: false,
      message: `TEST MODE: writes are restricted to the test account "${TEST_PAC}" only. "${org}" is a real client PAC and was NOT written.`,
    }, 403);
  }

  // Accept CSV or XLSX/XLS; convert to CSV text.
  let csv: string;
  try {
    csv = await fileToCsv(file);
  } catch (e) {
    return c.json({ ok: false, wrote: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const norm = normalizeOptOutCsv(org, csv);
  if (norm.validPhones === 0) {
    return c.json({
      ok: false, wrote: false,
      error: `No valid phone numbers found in the file (checked ${norm.inputRows} rows). Nothing was written. Make sure there is a phone column.`,
    }, 400);
  }
  const key = `optouts/${org}/optouts_${org}_${stampNow()}.csv`;
  try {
    const res = await putObjectNoOverwrite(c.env, role, key, norm.csv, 'text/csv');
    if (res.status === 412) {
      return c.json({ ok: false, wrote: false, message: 'A file with this key already exists. Not overwritten.', key }, 409);
    }
    if (!res.ok) {
      const body = await res.text();
      return c.json({ ok: false, wrote: false, error: `S3 write failed: ${res.status}`, detail: body.slice(0, 500) }, 502);
    }
    return c.json({
      ok: true, wrote: true,
      message: `Wrote ${norm.validPhones} opt-outs for ${org} to ${destInfo.label}.`,
      destination: destInfo.bucket, destinationLabel: destInfo.label,
      key, inputRows: norm.inputRows, validPhones: norm.validPhones, skipped: norm.skipped,
    }, 200);
  } catch (e) {
    return c.json({ ok: false, wrote: false, error: String(e) }, 502);
  }
});

app.route('/api', api);

export default app;
