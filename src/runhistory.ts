import type { Env } from './types';
import type { RunLog } from './runlogs';

/**
 * Run history — a compact record of every pull, persisted to KV so the UI can
 * show when each run happened and how it correlated with the summary email.
 *
 * Stored in the same OPTOUT_MAPPING namespace under a distinct key. We keep a
 * rolling window of the most recent runs (not the full opt-out data, just the
 * summary counts). No S3 involved. Nothing is written to client data.
 */

const KEY = 'run_history';
const MAX_RUNS = 50;

export interface RunRecord {
  ranAt: string; // ISO timestamp
  client: string;
  source: string; // 'readygop-live' etc.
  triggeredBy: string; // who ran it: a user email, or 'Chopper (automated)'
  triggeredByName?: string; // display name when available
  totalCount: number; // client-wide total opt-outs
  newTotal: number; // sum of new across mapped groups
  quarantinedProjects: number; // count of unmapped projects
  quarantinedOptOuts: number; // opt-outs held
  projectCount: number; // distinct projects seen
  emailSent: boolean;
  emailError?: string;
  wrote: boolean; // did this run write to S3 (false while dry-run)
}

export async function loadRunHistory(env: Env): Promise<RunRecord[]> {
  if (!env.OPTOUT_MAPPING) return [];
  const raw = await env.OPTOUT_MAPPING.get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RunRecord[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Build a compact record from a run log + email outcome. */
export function recordFromRun(
  log: RunLog,
  email: { sent: boolean; error?: string },
  wrote: boolean,
  triggeredBy: string,
  triggeredByName?: string,
): RunRecord {
  return {
    ranAt: log.ranAt,
    client: log.client,
    source: log.source,
    triggeredBy,
    triggeredByName,
    totalCount: log.totalCount,
    newTotal: log.groups.reduce((s, g) => s + g.newCount, 0),
    quarantinedProjects: log.quarantined.length,
    quarantinedOptOuts: log.quarantined.reduce((s, q) => s + q.count, 0),
    projectCount: log.projects.length,
    emailSent: email.sent,
    emailError: email.error,
    wrote,
  };
}

/** Prepend a record and persist, keeping only the most recent MAX_RUNS. */
export async function appendRunRecord(env: Env, rec: RunRecord): Promise<void> {
  if (!env.OPTOUT_MAPPING) return; // history is best-effort; never fail the run
  const history = await loadRunHistory(env);
  history.unshift(rec);
  const trimmed = history.slice(0, MAX_RUNS);
  await env.OPTOUT_MAPPING.put(KEY, JSON.stringify(trimmed));
}
