import type { Env } from './types';
import { pullOptOutsParallel, MAGA_CLIENT } from './rgop';
import { pullConnectOptOutsReduce, connectConfigured } from './connect';
import { createRunLogAccumulator, buildRunEmail, buildOutputFiles, normalizePhone, type RunLog, type SourceBreakdown } from './runlogs';
import { putObjectNoOverwrite } from './s3';
import { sendEmail } from './email';
import { appendRunRecord, recordFromRun, saveLastRunLog } from './runhistory';

/**
 * Shared opt-out sync run, used by BOTH the interactive button (streaming) and
 * the scheduled cron. Full ReadyGOP pull -> parse (pac,dest) -> S3 read-back
 * (READ ONLY) -> summary email -> persist run record.
 *
 * Still a DRY RUN: writes NOTHING to S3. The write step is added later.
 *
 * onProgress lets the streaming route surface live status; the cron passes
 * nothing (no browser). Email/history failures never fail the run.
 */

export interface WriteResult {
  attempted: boolean; // was writing enabled this run?
  files: { key: string; bucketRole: string; rows: number; status: 'written' | 'exists' | 'error'; detail?: string }[];
  written: number; // count of files newly written
}

export interface RunResult {
  log: RunLog;
  email: { sent: boolean; error?: string };
  write: WriteResult;
}

export interface RunOptions {
  appUrl: string; // base URL for the email's "assign mappings" link
  triggeredBy: string; // user email, or 'Chopper (automated)'
  triggeredByName?: string;
  source: string; // 'readygop-live' (button) or 'readygop-cron' (scheduled)
  emailTo?: string[];
  onProgress?: (phase: string, message: string, extra?: Record<string, unknown>) => void | Promise<void>;
}

const DEFAULT_EMAIL_TO = [
  'jacob@coefficient.org',
  'ryan@coefficient.org',
  'gregory@coefficient.org',
  'jessica@coefficient.org',
  'lydia@coefficient.org',
  'walker@coefficient.org',
  'alex@coefficient.org',
];

export async function runOptOutSync(env: Env, opts: RunOptions): Promise<RunResult> {
  const prog = async (phase: string, message: string, extra?: Record<string, unknown>) => {
    if (opts.onProgress) await opts.onProgress(phase, message, extra);
  };

  // STREAMING pull: rows are fed one at a time into the run-log accumulator and
  // never held as a full array. This fixes BOTH nightly failure modes:
  //   (1) 503 / Cloudflare 1102 wall-clock -> parallel batched ReadyGOP pull;
  //   (2) "Worker exceeded memory limit" -> no 126k-row array ever materializes.
  // Source-attribution for the email is tracked with two phone-only Sets
  // (strings), which are far lighter than full row objects.
  const acc = await createRunLogAccumulator(env, (msg) => prog('readback', msg));
  const rgopPhones = new Set<string>();
  const connPhones = new Set<string>();

  await prog('pull', 'Connecting to ReadyGOP...');
  const { totalCount } = await pullOptOutsParallel(env, MAGA_CLIENT.id, {
    concurrency: 12,
    onRow: (r) => {
      acc.addRow(r);
      const p = normalizePhone(r.phone);
      if (p) rgopPhones.add(p);
    },
    onProgress: (p) =>
      prog(
        'pull',
        `Pulling from ReadyGOP: ${p.pulled.toLocaleString()}${p.totalCount ? ' of ' + p.totalCount.toLocaleString() : ''} opt-outs`,
        { page: p.page, pulled: p.pulled, totalCount: p.totalCount },
      ),
  });

  // --- co/nnect (txt.coefficient.org) pull -------------------------------
  // Second source. NON-FATAL: if it is not configured or the pull errors, we
  // log it and proceed with ReadyGOP only, so a co/nnect outage never blocks
  // the ReadyGOP sync. Streamed row-by-row into the SAME accumulator (de-dup by
  // phone per (pac,dest) is handled inside the accumulator's Sets).
  let connectStatus: SourceBreakdown['connectStatus'] = 'skipped';
  let connectError: string | undefined;
  if (connectConfigured(env)) {
    try {
      await prog('pull', 'Pulling from co/nnect...');
      const c = await pullConnectOptOutsReduce(env, (phone, project) => {
        acc.addRow({ phone, project, createdAt: null, platform: 'co/nnect' });
        const p = normalizePhone(phone);
        if (p) connPhones.add(p);
      });
      connectStatus = 'ok';
      await prog('pull', `co/nnect: ${c.usableRows.toLocaleString()} opt-outs (${c.totalRows.toLocaleString()} rows)`);
    } catch (e) {
      connectStatus = 'failed';
      connectError = e instanceof Error ? e.message : String(e);
      await prog('pull', `co/nnect pull FAILED (continuing with ReadyGOP only): ${connectError}`);
    }
  } else {
    await prog('pull', 'co/nnect not configured (CONNECT_API_TOKEN unset); ReadyGOP only.');
  }

  // Source breakdown for the email, computed from the two phone-only Sets.
  let overlap = 0;
  for (const p of connPhones) if (rgopPhones.has(p)) overlap += 1;
  const merged = new Set<string>(rgopPhones);
  for (const p of connPhones) merged.add(p);
  const sourceBreakdown: SourceBreakdown = {
    readygop: rgopPhones.size,
    connect: connPhones.size,
    overlap,
    merged: merged.size,
    connectStatus,
    connectError,
  };

  const log = await acc.finalize({ client: MAGA_CLIENT.name, source: opts.source, totalCount });
  log.sourceBreakdown = sourceBreakdown;

  return commitRunLog(env, log, opts);
}

/**
 * COMMIT PHASE (shared): given a computed RunLog, do the S3 write (gated by
 * ALLOW_S3_WRITES) + summary email + run-history persist. Used by BOTH the
 * ReadyGOP runner and the manual-drop commit route, so the write/email/history
 * behavior is byte-identical across sources. This function performs the actual
 * dump + email - do NOT call it for a preview.
 */
export async function commitRunLog(env: Env, log: RunLog, opts: RunOptions): Promise<RunResult> {
  const prog = async (phase: string, message: string, extra?: Record<string, unknown>) => {
    if (opts.onProgress) await opts.onProgress(phase, message, extra);
  };

  // --- S3 WRITE STEP -------------------------------------------------------
  // Writes only when ALLOW_S3_WRITES === 'true' (per-env config, OFF by
  // default). Writes each mapped group's NEW opt-outs to its REAL destination
  // bucket under optouts/<pac>/, using putObjectNoOverwrite (never clobbers).
  // Quarantined/unmapped projects produce no output file, so they never write.
  const write: WriteResult = { attempted: false, files: [], written: 0 };
  if (env.ALLOW_S3_WRITES === 'true') {
    write.attempted = true;
    const files = buildOutputFiles(log);
    let i = 0;
    for (const f of files) {
      i += 1;
      await prog('write', `Writing to S3 (${i}/${files.length}): ${f.key}`);
      try {
        const res = await putObjectNoOverwrite(env, f.bucketRole, f.key, f.content, 'text/csv');
        if (res.status === 412) {
          write.files.push({ key: f.key, bucketRole: f.bucketRole, rows: f.rowCount, status: 'exists' });
        } else if (res.ok) {
          write.files.push({ key: f.key, bucketRole: f.bucketRole, rows: f.rowCount, status: 'written' });
          write.written += 1;
        } else {
          const body = await res.text();
          write.files.push({ key: f.key, bucketRole: f.bucketRole, rows: f.rowCount, status: 'error', detail: `HTTP ${res.status}: ${body.slice(0, 160)}` });
        }
      } catch (e) {
        write.files.push({ key: f.key, bucketRole: f.bucketRole, rows: f.rowCount, status: 'error', detail: e instanceof Error ? e.message : String(e) });
      }
    }
    await prog('write', `S3 write complete: ${write.written} file(s) written`);
  }

  // Summary email. Failure never fails the run.
  let email: { sent: boolean; error?: string } = { sent: false };
  try {
    await prog('email', 'Sending summary email...');
    const mail = buildRunEmail(log, opts.appUrl);
    // SAFETY: on staging, force ALL summary emails to Jacob only, so testing
    // (esp. the manual-drop commit) never spams the full team list. Prod uses
    // the real distribution list. Explicit opts.emailTo still wins if set.
    const isStaging = (env.APP_ENV || '').toLowerCase() === 'staging';
    const recipients = opts.emailTo && opts.emailTo.length
      ? opts.emailTo
      : (isStaging ? ['jacob@coefficient.org'] : DEFAULT_EMAIL_TO);
    await sendEmail(env, {
      fromEmail: 'chopper@coefficient.org',
      fromName: 'Chopper (Opt-Out Sync)' + (isStaging ? ' [STAGING]' : ''),
      to: recipients,
      subject: (isStaging ? '[STAGING] ' : '') + mail.subject,
      html: mail.html,
      text: mail.text,
    });
    email = { sent: true };
    await prog('email', `Summary email sent to ${recipients.join(', ')}`);
  } catch (e) {
    email = { sent: false, error: e instanceof Error ? e.message : String(e) };
    await prog('email', `Email failed (run still OK): ${email.error}`);
  }

  // Persist run record + full last log. Best-effort. The full log lets the UI
  // silently recover the complete result if the live stream drops mid-run.
  try {
    await appendRunRecord(
      env,
      recordFromRun(log, email, write.attempted && write.written > 0, opts.triggeredBy, opts.triggeredByName),
    );
    await saveLastRunLog(env, { log, email });
  } catch (e) {
    await prog('history', `Run-history save failed (run still OK): ${e instanceof Error ? e.message : String(e)}`);
  }

  return { log, email, write };
}
