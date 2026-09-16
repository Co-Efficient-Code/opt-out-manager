import type { Env } from './types';
import type { SyncRole } from './s3';
import { listObjects, getObject } from './s3';
import type { RgopOptOut } from './rgop';
import { loadOverrides, cleanName, type OverrideMap } from './mapping';

/**
 * Run-log dry-run: pull opt-outs from ReadyGOP, parse each project into a
 * (PAC, Destination) pair, read back existing opt-outs from the client S3
 * folder (READ ONLY), and compute how many would be NEW.
 *
 * RULE #1: this module NEVER writes to S3 (or anywhere). It only reads and
 * computes. No putObject, no putObjectNoOverwrite here.
 *
 * The (PAC, Destination) PAIR is the key — not "PAC routes to Destination".
 * The same PAC can appear under both destinations and stays fully separate.
 */

// --- parser -----------------------------------------------------------------
// pac (x) and destination (y) are two INDEPENDENT values parsed from the name.
const PAC_TOKENS: [string, string][] = [
  ['SAG', 'sag-pac'],
  ['No Going Back', 'no-going-back-pac'],
];
const DEST_TOKENS: [string, string][] = [
  ['Big Dog', 'Big Dog'],
  ['Creative Direct', 'Creative Direct'],
];

export function parseProject(name: string): { pac: string | null; destination: string | null } {
  const clean = (name || '').replace(/\t/g, ' ');
  const lower = clean.toLowerCase();
  const destination = DEST_TOKENS.find(([t]) => lower.includes(t.toLowerCase()))?.[1] ?? null;
  const pac = PAC_TOKENS.find(([t]) => lower.includes(t.toLowerCase()))?.[1] ?? null;
  return { pac, destination };
}

// Destination label -> S3 read-back role. READ ONLY.
const DEST_ROLE: Record<string, SyncRole> = {
  'Big Dog': 'bigdog',
  'Creative Direct': 'creativedirect',
};

function normalizePhone(raw: string | null): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return null;
}

// --- S3 read-back (READ ONLY) ----------------------------------------------
async function listKeys(env: Env, role: SyncRole, prefix: string): Promise<string[]> {
  const res = await listObjects(env, role, prefix);
  if (!res.ok) return [];
  const xml = await res.text();
  const keys: string[] = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const k = m[1];
    if (!k.endsWith('/')) keys.push(k);
  }
  return keys;
}

function phonesFromCsv(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const header = (lines[0] || '').split(',').map((h) => h.trim().toLowerCase());
  let pidx = header.findIndex((h) => h.includes('phone'));
  if (pidx < 0) pidx = header.length - 1;
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;
    const cols = row.split(',');
    if (pidx < cols.length) {
      const p = normalizePhone(cols[pidx]);
      if (p) out.push(p);
    }
  }
  return out;
}

/** READ ONLY: build the set of phones already reported in optouts/<pac>/. */
async function readExistingPhones(env: Env, destination: string, pac: string): Promise<Set<string>> {
  const role = DEST_ROLE[destination];
  const phones = new Set<string>();
  if (!role) return phones;
  const prefix = `optouts/${pac}/`;
  const keys = await listKeys(env, role, prefix);
  for (const key of keys) {
    const res = await getObject(env, role, key);
    if (!res.ok) continue;
    const text = await res.text();
    for (const p of phonesFromCsv(text)) phones.add(p);
  }
  return phones;
}

// --- run-log builder --------------------------------------------------------
export interface RunGroup {
  pac: string;
  destination: string;
  todayUnique: number;
  alreadyReported: number;
  newCount: number;
}
export interface ProjectRow {
  project: string;
  pac: string | null;
  destination: string | null;
  count: number; // total opt-outs pulled for this project
  newCount: number | null; // new vs already-reported (null when unmapped/quarantined)
  status: 'mapped' | 'unmapped';
  source: 'parser' | 'override';
}
export interface RunLog {
  ranAt: string;
  client: string;
  source: string;
  totalCount: number;
  inputOptOuts: number;
  groups: RunGroup[];
  quarantined: { project: string; count: number }[];
  projects: ProjectRow[];
}

/**
 * Build a dry-run run-log from pulled opt-outs. Reads S3 (read-only) to
 * compute new-vs-already-reported per (pac, destination). Writes nothing.
 */
export async function buildRunLog(
  env: Env,
  rows: RgopOptOut[],
  meta: { client: string; source: string; totalCount: number },
  onPhase?: (msg: string) => void | Promise<void>,
): Promise<RunLog> {
  const say = async (m: string) => { if (onPhase) await onPhase(m); };
  await say('Loading saved project mappings');
  const overrides: OverrideMap = await loadOverrides(env);
  const groups = new Map<string, Set<string>>(); // "pac|dest" -> phones
  const projectPhones = new Map<string, Set<string>>(); // project -> phones
  const quarantine = new Map<string, number>();
  const perProject = new Map<string, ProjectRow>();

  for (const r of rows) {
    const clean = cleanName(r.project) || '(unknown)';
    const parsed = parseProject(r.project);
    // Human override wins over the parser (per-field).
    const ov = overrides[clean];
    const pac = ov?.pac ?? parsed.pac;
    const destination = ov?.destination ?? parsed.destination;
    const usedOverride = !!ov && (ov.pac != null || ov.destination != null);
    const rec = perProject.get(clean) || {
      project: clean,
      pac,
      destination,
      count: 0,
      newCount: null,
      status: (pac && destination ? 'mapped' : 'unmapped') as 'mapped' | 'unmapped',
      source: (usedOverride ? 'override' : 'parser') as 'parser' | 'override',
    };
    rec.count += 1;
    perProject.set(clean, rec);

    if (!pac || !destination) {
      quarantine.set(clean, (quarantine.get(clean) || 0) + 1);
      continue;
    }
    const p = normalizePhone(r.phone);
    if (p) {
      const gk = `${pac}|${destination}`;
      (groups.get(gk) || groups.set(gk, new Set()).get(gk)!).add(p);
      (projectPhones.get(clean) || projectPhones.set(clean, new Set()).get(clean)!).add(p);
    }
  }

  // Read-back existing phones once per (pac, destination) folder (READ ONLY).
  const existingByKey = new Map<string, Set<string>>();
  const groupOut: RunGroup[] = [];
  const groupKeys = [...groups.entries()].sort();
  let gi = 0;
  for (const [gk, phones] of groupKeys) {
    const [pac, destination] = gk.split('|');
    gi += 1;
    await say(`Reading existing opt-outs from S3 (${gi}/${groupKeys.length}): ${pac} / ${destination}`);
    const existing = await readExistingPhones(env, destination, pac);
    existingByKey.set(gk, existing);
    let already = 0;
    for (const p of phones) if (existing.has(p)) already += 1;
    groupOut.push({
      pac,
      destination,
      todayUnique: phones.size,
      alreadyReported: already,
      newCount: phones.size - already,
    });
  }

  // Per-project new count against that project's (pac, destination) folder.
  for (const [project, phones] of projectPhones.entries()) {
    const rec = perProject.get(project);
    if (!rec || !rec.pac || !rec.destination) continue;
    const existing = existingByKey.get(`${rec.pac}|${rec.destination}`);
    if (!existing) continue;
    let n = 0;
    for (const p of phones) if (!existing.has(p)) n += 1;
    rec.newCount = n;
  }

  return {
    ranAt: new Date().toISOString(),
    client: meta.client,
    source: meta.source,
    totalCount: meta.totalCount,
    inputOptOuts: rows.length,
    groups: groupOut,
    quarantined: [...quarantine.entries()]
      .map(([project, count]) => ({ project, count }))
      .sort((a, b) => b.count - a.count),
    projects: [...perProject.values()].sort((a, b) => b.count - a.count),
  };
}

// Build the run-summary email (HTML + plain text) from a run log.
// appUrl is the base URL of the app; the flagged-project link points at the
// Run logs tab so a user can go assign the mapping.
export function buildRunEmail(
  log: RunLog,
  appUrl: string,
): { subject: string; html: string; text: string } {
  const newTotal = log.groups.reduce((s, g) => s + g.newCount, 0);
  const quarTotal = log.quarantined.reduce((s, q) => s + q.count, 0);
  const runLogsUrl = appUrl.replace(/\/$/, '') + '/#runlogs';
  const ranLocal = new Date(log.ranAt).toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const subject =
    `[Opt-Out Sync] ${log.client}: ${newTotal.toLocaleString()} new` +
    (quarTotal > 0 ? ` — ${log.quarantined.length} project(s) need mapping` : '');

  // --- plain text ---
  const t: string[] = [];
  t.push(`Opt-Out Sync run — ${log.client}`);
  t.push(`Ran: ${ranLocal} CT`);
  t.push('');
  t.push(`DRY RUN — nothing was written to S3.`);
  t.push('');
  t.push(`New opt-outs (would be uploaded): ${newTotal.toLocaleString()}`);
  t.push(`Pulled this run: ${log.inputOptOuts.toLocaleString()} of ${log.totalCount.toLocaleString()} total`);
  t.push('');
  if (log.groups.length) {
    t.push('By PAC / Destination:');
    for (const g of log.groups) {
      t.push(`  ${g.pac} / ${g.destination}: ${g.newCount.toLocaleString()} new (${g.alreadyReported.toLocaleString()} already reported)`);
    }
    t.push('');
  }
  if (log.quarantined.length) {
    t.push(`ACTION NEEDED — ${log.quarantined.length} project(s) not mapped, ${quarTotal.toLocaleString()} opt-outs held:`);
    for (const q of log.quarantined) {
      t.push(`  ${q.project} (${q.count.toLocaleString()})`);
    }
    t.push('');
    t.push(`Assign these here: ${runLogsUrl}`);
  } else {
    t.push('All projects mapped. No action needed.');
  }
  if (log.projects.length) {
    t.push('');
    t.push('Project breakdown (new / total):');
    for (const p of log.projects) {
      const nt = p.status === 'mapped' && p.newCount != null
        ? `${p.newCount.toLocaleString()} / ${p.count.toLocaleString()}`
        : `- / ${p.count.toLocaleString()}`;
      const map = p.pac && p.destination ? `${p.pac} / ${p.destination}` : 'UNMAPPED';
      t.push(`  ${p.project}: ${nt}  [${map}]`);
    }
  }

  // --- html ---
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const h: string[] = [];
  h.push(`<div style="font-family:Arial,Helvetica,sans-serif;color:#0a1628;max-width:640px">`);
  h.push(`<h2 style="margin:0 0 4px">Opt-Out Sync run — ${esc(log.client)}</h2>`);
  h.push(`<p style="color:#64748b;margin:0 0 14px;font-size:13px">${esc(ranLocal)} CT &middot; <b>DRY RUN</b> — nothing written to S3</p>`);
  h.push(`<div style="font-size:15px;margin:0 0 16px"><b style="color:#16a34a">${newTotal.toLocaleString()}</b> new opt-outs &nbsp;|&nbsp; ${log.inputOptOuts.toLocaleString()} pulled of ${log.totalCount.toLocaleString()} total</div>`);
  if (log.groups.length) {
    h.push(`<table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 18px"><thead><tr>`);
    h.push(`<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">PAC</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">Destination</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e2e8f0">New</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e2e8f0">Already reported</th></tr></thead><tbody>`);
    for (const g of log.groups) {
      h.push(`<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(g.pac)}</td><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(g.destination)}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;color:#16a34a;font-weight:600">${g.newCount.toLocaleString()}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;color:#64748b">${g.alreadyReported.toLocaleString()}</td></tr>`);
    }
    h.push(`</tbody></table>`);
  }
  if (log.quarantined.length) {
    h.push(`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:0 0 8px">`);
    h.push(`<div style="font-weight:700;color:#b91c1c;margin:0 0 8px">Action needed: ${log.quarantined.length} project(s) need mapping</div>`);
    h.push(`<div style="font-size:13px;color:#7f1d1d;margin:0 0 10px">${quarTotal.toLocaleString()} opt-outs are held and will NOT be uploaded until each project is assigned a PAC + Destination.</div>`);
    h.push(`<ul style="margin:0 0 12px;padding-left:18px;font-size:13px;color:#7f1d1d">`);
    for (const q of log.quarantined) h.push(`<li>${esc(q.project)} <span style="color:#b91c1c">(${q.count.toLocaleString()})</span></li>`);
    h.push(`</ul>`);
    h.push(`<a href="${esc(runLogsUrl)}" style="display:inline-block;background:#E27124;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600;font-size:13px">Assign mappings in Run logs</a>`);
    h.push(`</div>`);
  } else {
    h.push(`<div style="color:#16a34a;font-weight:600;font-size:13px">All projects mapped. No action needed.</div>`);
  }
  // Per-project breakdown
  if (log.projects.length) {
    h.push(`<h3 style="font-size:15px;margin:22px 0 6px">Project breakdown</h3>`);
    h.push(`<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>`);
    h.push(`<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">Project</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">PAC</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e2e8f0">Destination</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e2e8f0">New</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e2e8f0">Total</th></tr></thead><tbody>`);
    for (const p of log.projects) {
      const mapped = p.status === 'mapped';
      const newCell = mapped && p.newCount != null
        ? `<span style="color:#16a34a;font-weight:600">${p.newCount.toLocaleString()}</span>`
        : '<span style="color:#b91c1c">held</span>';
      const pacCell = p.pac ? esc(p.pac) : '<span style="color:#b91c1c">-</span>';
      const destCell = p.destination ? esc(p.destination) : '<span style="color:#b91c1c">-</span>';
      h.push(`<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${esc(p.project)}</td><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${pacCell}</td><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${destCell}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9">${newCell}</td><td style="padding:6px 8px;text-align:right;border-bottom:1px solid #f1f5f9;color:#64748b">${p.count.toLocaleString()}</td></tr>`);
    }
    h.push(`</tbody></table>`);
  }
  h.push(`</div>`);

  return { subject, html: h.join('\n'), text: t.join('\n') };
}
