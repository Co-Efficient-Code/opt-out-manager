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
  count: number;
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
): Promise<RunLog> {
  const overrides: OverrideMap = await loadOverrides(env);
  const groups = new Map<string, Set<string>>(); // "pac|dest" -> phones
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
    }
  }

  const groupOut: RunGroup[] = [];
  for (const [gk, phones] of [...groups.entries()].sort()) {
    const [pac, destination] = gk.split('|');
    const existing = await readExistingPhones(env, destination, pac);
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
