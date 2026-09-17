import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { authRoutes, requireAuth } from './auth';
import { listAccounts, listAccountsForRole, filesForOrg, listFilesForRole } from './accounts';
import type { SyncRole } from './s3';
import { scrubContacts, buildOptOutSet, normalizeOptOutCsv } from './scrub';
import { putObjectNoOverwrite, getObject } from './s3';
import { fileToCsv } from './parsefile';
import { driveList, driveUploadCsv, driveFolderFor, type DriveDest } from './drive';

import { loadOverrides, setOverride, PAC_SLUGS, DESTINATIONS } from './mapping';
import { loadRunHistory, loadLastRunLog } from './runhistory';
import { runOptOutSync } from './runner';
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

// CRON TRIGGER: external scheduler (GitHub Actions) POSTs here to run the sync.
// Guarded by a shared bearer token (CRON_SECRET), so it is mounted BEFORE the
// Google-login middleware. Runs the same runOptOutSync as the button + native
// cron. Still a DRY RUN (no S3 writes). Returns the summary JSON.
app.post('/cron/run', async (c) => {
  const secret = c.env.CRON_SECRET;
  const auth = c.req.header('Authorization') || '';
  const provided = auth.replace(/^Bearer\s+/i, '');
  if (!secret || provided !== secret) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  try {
    const appUrl = c.env.APP_URL || new URL(c.req.url).origin;
    const { log, email } = await runOptOutSync(c.env, {
      appUrl,
      triggeredBy: 'Chopper (automated)',
      source: 'readygop-cron',
    });
    return c.json({
      ok: true,
      dryRun: true,
      wrote: false,
      ranAt: log.ranAt,
      newTotal: log.groups.reduce((s, g) => s + g.newCount, 0),
      quarantinedProjects: log.quarantined.length,
      emailSent: email.sent,
      emailError: email.error,
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

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

// PREVIEW: parse+convert+normalize an uploaded file and return the cleaned
// result (what WOULD be written) without writing anything. Same logic as push.
api.post('/preview', async (c) => {
  const form = await c.req.formData();
  const org = String(form.get('org') || '');
  const file = form.get('file');
  if (!org) return c.json({ error: 'missing org' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  let csv: string;
  try {
    csv = await fileToCsv(file);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  try {
    const norm = normalizeOptOutCsv(org, csv);
    const lines = norm.csv.split('\n').filter((l) => l.length > 0);
    const previewRows = lines.slice(0, 21); // header + 20
    // The actual S3 key/filename that will be written (timestamp set at write time).
    const outputKey = `optouts/${org}/optouts_${org}_${stampNow()}.csv`;
    return c.json({
      ok: true,
      inputFile: file.name,
      org,
      outputKey,
      outputFile: outputKey.split('/').pop(),
      inputRows: norm.inputRows,
      validPhones: norm.validPhones,
      skipped: norm.skipped,
      previewRows,
      totalOutputRows: Math.max(0, lines.length - 1),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
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

// DRIVE: list the uploaded-lists folder (root + destination subfolders). Read-only.
api.get('/drive/list', async (c) => {
  try {
    const root = c.env.DRIVE_ROOT_FOLDER;
    if (!root) return c.json({ error: 'Drive root folder not configured' }, 500);
    const [bigdog, cd] = await Promise.all([
      driveList(c.env, driveFolderFor(c.env, 'bigdog')),
      driveList(c.env, driveFolderFor(c.env, 'creativedirect')),
    ]);
    const clean = (f: { name: string; modifiedTime?: string; size?: string; webViewLink?: string }) => ({
      name: f.name,
      modifiedTime: f.modifiedTime || '',
      size: f.size ? Number(f.size) : null,
      link: f.webViewLink || '',
    });
    return c.json({
      folders: {
        'Big Dog': bigdog.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').map(clean),
        'Creative Direct': cd.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder').map(clean),
      },
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// SCRUB + SAVE TO DRIVE: scrub a list, return the cleaned CSV as a download,
// AND save a copy to the destination's Drive subfolder named by project.
api.post('/scrub/drive', async (c) => {
  const form = await c.req.formData();
  const org = String(form.get('org') || '');
  const dest = String(form.get('dest') || '');
  const project = String(form.get('project') || '').trim();
  const file = form.get('file');
  const phoneColRaw = form.get('phoneCol');
  const phoneCol =
    phoneColRaw != null && String(phoneColRaw) !== '' ? parseInt(String(phoneColRaw), 10) : undefined;
  const destMap: Record<string, string> = { bigdog: 'Big Dog', creativedirect: 'Creative Direct' };
  if (!org) return c.json({ error: 'missing org' }, 400);
  if (!destMap[dest]) return c.json({ error: 'missing or invalid destination' }, 400);
  if (!project) return c.json({ error: 'missing project name' }, 400);
  if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
  let csv: string;
  try {
    csv = await fileToCsv(file);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  try {
    const result = await scrubContacts(c.env, org, csv, phoneCol);
    const fileName = project.endsWith('.csv') ? project : `${project}.csv`;
    const saved = await driveUploadCsv(
      c.env,
      driveFolderFor(c.env, dest as DriveDest),
      fileName,
      result.cleanedCsv,
    );
    return c.json({
      ok: true,
      org,
      destinationLabel: destMap[dest],
      driveFileName: saved.name,
      driveFileId: saved.id,
      inputRows: result.inputRows,
      scrubbed: result.scrubbed,
      kept: result.kept,
      optOutSetSize: result.optOutSetSize,
      unparseablePhones: result.unparseablePhones,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// Exact record count for one file (read-only). Guards very large files.
const COUNT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
api.get('/count/:bucket/:org/:file', async (c) => {
  const map: Record<string, SyncRole> = { p2p: 'source', bigdog: 'bigdog', creativedirect: 'creativedirect' };
  const role = map[c.req.param('bucket')];
  if (!role) return c.json({ error: 'invalid bucket' }, 400);
  const key = `optouts/${c.req.param('org')}/${c.req.param('file')}`;
  try {
    const res = await getObject(c.env, role, key);
    if (!res.ok) return c.json({ error: 'not found', status: res.status }, 404);
    const len = Number(res.headers.get('content-length') || '0');
    if (len > COUNT_MAX_BYTES) return c.json({ tooLarge: true });
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const records = Math.max(0, lines.length - 1); // minus header
    return c.json({ records });
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

// RUN LOGS (dry-run): FULL pull of opt-outs from ReadyGOP (every page, no cap),
// parse (pac, destination), read back existing opt-outs from S3 (READ ONLY),
// and report what WOULD be new. Writes NOTHING anywhere.
//
// Streams NDJSON progress so the UI can show live status during the full pull:
//   {"type":"progress", ...}   one per page pulled / read-back phase
//   {"type":"done", log:{...}} final run log
//   {"type":"error", error} on failure
api.get('/runlogs/dry-run', async (c) => {
  const encoder = new TextEncoder();
  const user = c.get('user');
  const appUrl = c.env.APP_URL || new URL(c.req.url).origin;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        const { log, email } = await runOptOutSync(c.env, {
          appUrl,
          triggeredBy: user?.email || 'unknown',
          triggeredByName: user?.name,
          source: 'readygop-live',
          onProgress: (phase, message, extra) => send({ type: 'progress', phase, message, ...(extra || {}) }),
        });
        send({ type: 'done', ok: true, dryRun: true, wrote: false, log, email });
      } catch (e) {
        send({ type: 'error', ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
});

// LAST RUN: full log of the most recent completed run. Used by the UI to
// silently recover the result if the live stream drops mid-run.
api.get('/runlogs/last', async (c) => {
  try {
    const last = await loadLastRunLog(c.env);
    return c.json({ ok: true, last });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// RUN HISTORY: compact record of past pulls (when + counts + email outcome).
api.get('/runlogs/history', async (c) => {
  try {
    return c.json({ ok: true, runs: await loadRunHistory(c.env) });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// MAPPING: read current human-assigned project overrides + the canonical
// PAC/destination option lists the UI offers. Read-only.
api.get('/mapping', async (c) => {
  try {
    const overrides = await loadOverrides(c.env);
    return c.json({ ok: true, overrides, pacSlugs: PAC_SLUGS, destinations: DESTINATIONS });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// MAPPING: assign (or clear) a project's (pac, destination). Persists to KV so
// it survives across sessions. Does NOT touch S3. Send empty pac+dest to clear.
api.post('/mapping', async (c) => {
  let body: { project?: string; pac?: string; destination?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400);
  }
  const project = String(body.project || '').trim();
  if (!project) return c.json({ ok: false, error: 'missing project' }, 400);
  const pac = body.pac ? String(body.pac) : null;
  const destination = body.destination ? String(body.destination) : null;
  try {
    const overrides = await setOverride(c.env, project, pac, destination);
    return c.json({ ok: true, project, pac, destination, overrides });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.route('/api', api);

// Scheduled (cron) entry point. No browser, no request origin: uses APP_URL for
// the email link and tags the run as automated so it shows as
// "Chopper (automated)" in run history. Still a DRY RUN (no S3 writes).
async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const appUrl = env.APP_URL || 'https://staging.optouts.coefficient.org';
  ctx.waitUntil(
    runOptOutSync(env, {
      appUrl,
      triggeredBy: 'Chopper (automated)',
      source: 'readygop-cron',
    }).then(
      (r) => console.log(`[cron] done: ${r.log.groups.reduce((s, g) => s + g.newCount, 0)} new, email sent=${r.email.sent}`),
      (e) => console.error(`[cron] failed: ${e instanceof Error ? e.message : String(e)}`),
    ),
  );
}

export default { fetch: app.fetch, scheduled };
