import type { Env } from './types';
import { pullOptOuts, MAGA_CLIENT } from './rgop';
import { buildRunLog, buildRunEmail, type RunLog } from './runlogs';
import { sendEmail } from './email';
import { appendRunRecord, recordFromRun } from './runhistory';

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

export interface RunResult {
  log: RunLog;
  email: { sent: boolean; error?: string };
}

export interface RunOptions {
  appUrl: string; // base URL for the email's "assign mappings" link
  triggeredBy: string; // user email, or 'Chopper (automated)'
  triggeredByName?: string;
  source: string; // 'readygop-live' (button) or 'readygop-cron' (scheduled)
  emailTo?: string[];
  onProgress?: (phase: string, message: string, extra?: Record<string, unknown>) => void | Promise<void>;
}

const DEFAULT_EMAIL_TO = ['jacob@coefficient.org'];

export async function runOptOutSync(env: Env, opts: RunOptions): Promise<RunResult> {
  const prog = async (phase: string, message: string, extra?: Record<string, unknown>) => {
    if (opts.onProgress) await opts.onProgress(phase, message, extra);
  };

  await prog('pull', 'Connecting to ReadyGOP...');
  const { rows, totalCount } = await pullOptOuts(env, MAGA_CLIENT.id, {
    onProgress: (p) =>
      prog(
        'pull',
        `Pulling from ReadyGOP: ${p.pulled.toLocaleString()}${p.totalCount ? ' of ' + p.totalCount.toLocaleString() : ''} opt-outs (page ${p.page})`,
        { page: p.page, pulled: p.pulled, totalCount: p.totalCount },
      ),
  });

  const log = await buildRunLog(
    env,
    rows,
    { client: MAGA_CLIENT.name, source: opts.source, totalCount },
    (msg) => prog('readback', msg),
  );

  // Summary email (dry run: no S3 writes). Failure never fails the run.
  let email: { sent: boolean; error?: string } = { sent: false };
  try {
    await prog('email', 'Sending summary email...');
    const mail = buildRunEmail(log, opts.appUrl);
    await sendEmail(env, {
      fromEmail: 'chopper@coefficient.org',
      fromName: 'Chopper (Opt-Out Sync)',
      to: opts.emailTo && opts.emailTo.length ? opts.emailTo : DEFAULT_EMAIL_TO,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    email = { sent: true };
    await prog('email', `Summary email sent to ${(opts.emailTo || DEFAULT_EMAIL_TO).join(', ')}`);
  } catch (e) {
    email = { sent: false, error: e instanceof Error ? e.message : String(e) };
    await prog('email', `Email failed (run still OK): ${email.error}`);
  }

  // Persist run record. Best-effort.
  try {
    await appendRunRecord(
      env,
      recordFromRun(log, email, false, opts.triggeredBy, opts.triggeredByName),
    );
  } catch (e) {
    await prog('history', `Run-history save failed (run still OK): ${e instanceof Error ? e.message : String(e)}`);
  }

  return { log, email };
}
