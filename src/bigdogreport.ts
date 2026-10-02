import type { Env } from './types';
import { pullOptOuts, MAGA_CLIENT } from './rgop';
import { pullConnectOptOuts, connectConfigured } from './connect';
import { buildOptOutSet } from './scrub';
import { driveList, driveDownloadText } from './drive';
import { MAGA_LOGO, BIGDOG_LOGO, COEFF_LOGO } from './bigdogassets';

/**
 * BIG DOG MMS REPORT (by Race & PAC) - automated port of the local
 * ~/Desktop/bigdog-dual-report Python pipeline (scripts 1, 6, 10).
 *
 * One-for-one method ("option b"): for each wave we take its SEND LIST phones
 * (from the Big Dog Drive scrub folder) and count how many appear in the UNION
 * of that PAC's provider opt-outs (ReadyGOP for SAG, co/nnect for NGB) AND the
 * client P2P S3 bucket (sag-pac / no-going-back-pac). This catches opt-outs that
 * arrived via OTHER vendors (present only in P2P), which a raw provider count
 * would miss.
 *
 * Texts Sent + Remaining render as "-" until the Sales Tracker (invoicing source
 * of truth) is wired. NO email, NO S3 write - reporting/download only.
 *
 * Race display names + sort order come from a KV table (editable in the UI), with
 * an auto-generated default for any race key not yet named.
 */

const PACS = {
  SAG: { label: 'SAG', marker: 'SAG', p2pOrg: 'sag-pac' },
  NGB: { label: 'No Going Back', marker: 'No Going Back', p2pOrg: 'no-going-back-pac' },
} as const;

const PAC_ORDER: Array<keyof typeof PACS> = ['SAG', 'NGB'];

// ---------------------------------------------------------------------------
// Phone + name normalization (ports norm_phone / norm_ws / race_key / parse)
// ---------------------------------------------------------------------------

export function normPhone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s.endsWith('.0')) s = s.slice(0, -2); // xlsx/float artifact
  const d = s.replace(/\D/g, '');
  let x = d;
  if (x.length === 11 && x.startsWith('1')) x = x.slice(1);
  return x.length === 10 ? x : null;
}

function normWs(s: string | null | undefined): string {
  return (s || '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Canonicalize a race fragment to a stable key (CD/District variants collapse). */
export function raceKey(rawRace: string): string {
  let s = normWs(rawRace).toUpperCase();
  s = s.replace(/ CD /g, ' ').replace(/ DISTRICT/g, '');
  s = s.replace(/\bCD0?(\d+)/g, '$1'); // CD09 -> 9
  s = s.replace(/\b0*(\d+)\b/g, (_m, n) => String(parseInt(n, 10)).padStart(2, '0')); // zero-pad -> 02
  return normWs(s);
}

interface ParsedProject {
  key: string;
  raceRaw: string;
  date: string; // "M.D"
}

/** Parse "<num> <RACE...> Big Dog <marker> MMS <M.D>". Returns null on no match. */
function parseProject(name: string, marker: string): ParsedProject | null {
  const n = normWs(name);
  const re = new RegExp(
    `^\\d+\\s+(.*?)\\s+Big Dog ${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} MMS\\s+([\\d.]+)\\s*$`,
    'i',
  );
  const m = re.exec(n);
  if (!m) return null;
  return { key: raceKey(m[1]), raceRaw: m[1], date: m[2] };
}

function projectNumber(name: string): string | null {
  const m = /^(\d+)/.exec(normWs(name));
  return m ? m[1] : null;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d: string): string {
  const [mm, dd] = d.split('.');
  const mi = parseInt(mm, 10);
  return `${MONTHS[mi] || mm} ${parseInt(dd, 10)}`;
}
function sortKey(d: string): number {
  const [mm, dd] = (d + '.0').split('.');
  return parseInt(mm, 10) * 100 + parseInt(dd || '0', 10);
}

// ---------------------------------------------------------------------------
// Default race display name (auto-discover fallback)
// ---------------------------------------------------------------------------

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Auto default: "FL 22" -> "Florida 22nd District"; "GA SENATE" -> "Georgia Senate". */
export function defaultRaceName(key: string): string {
  const parts = key.split(' ');
  const st = STATE_NAMES[parts[0]] || parts[0];
  const rest = parts.slice(1).join(' ');
  if (/SENATE/i.test(rest)) return `${st} Senate`;
  const num = parseInt(rest, 10);
  if (!Number.isNaN(num)) return `${st} ${ordinal(num)} District`;
  return normWs(`${st} ${rest}`);
}

// ---------------------------------------------------------------------------
// Race-name table (KV): key -> { name, order }
// ---------------------------------------------------------------------------

const RACE_TABLE_KEY = 'bigdog:race_names';

export interface RaceNameEntry { name: string; order: number }
export type RaceNameTable = Record<string, RaceNameEntry>;

export async function loadRaceTable(env: Env): Promise<RaceNameTable> {
  if (!env.OPTOUT_MAPPING) return {};
  const raw = await env.OPTOUT_MAPPING.get(RACE_TABLE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RaceNameTable;
  } catch {
    return {};
  }
}

export async function saveRaceTable(env: Env, table: RaceNameTable): Promise<void> {
  if (!env.OPTOUT_MAPPING) throw new Error('OPTOUT_MAPPING KV namespace is not bound');
  await env.OPTOUT_MAPPING.put(RACE_TABLE_KEY, JSON.stringify(table));
}

export async function setRaceName(
  env: Env,
  key: string,
  name: string,
  order: number | null,
): Promise<RaceNameTable> {
  const k = raceKey(key);
  const table = await loadRaceTable(env);
  const cur = table[k];
  table[k] = {
    name: normWs(name) || defaultRaceName(k),
    order: order ?? cur?.order ?? 900,
  };
  await saveRaceTable(env, table);
  return table;
}

// ---------------------------------------------------------------------------
// Build the registry (ports build_registry + build_final_registry)
// ---------------------------------------------------------------------------

type ProgressFn = (phase: string, message: string) => void | Promise<void>;

interface Wave {
  date: string;
  dateSort: number;
  project: string;
  projectNumber: string | null;
  optOuts: number | null; // union hits on the send list; null if no send list
  tested: number | null; // send-list size we scrubbed
  providerOptOuts: number; // provider-only count for this project (floor fallback)
}

interface PacBlock {
  waves: Wave[];
  potential?: boolean;
  universe?: number;
  potentialOptOuts?: number;
  remaining?: number;
}

interface RaceOut {
  key: string;
  name: string;
  order: number;
  pacs: Partial<Record<keyof typeof PACS, PacBlock>>;
}

export interface BuildResult {
  title: string;
  updated: string;
  generatedAt: string;
  races: RaceOut[];
  unknownRaceKeys: string[];
  stats: {
    optOutsTotal: number;
    racesCount: number;
    sagProviderOptOuts: number;
    ngbProviderOptOuts: number;
    p2pSag: number;
    p2pNgb: number;
    sendListsFound: number;
    sendListsMissing: number;
  };
  warnings: string[];
}

/** Read a scrubbed send-list CSV's CellPhone column into a normalized phone set. */
function sendPhonesFromCsv(text: string): Set<string> {
  const phones = new Set<string>();
  // strip BOM
  const body = text.replace(/^\uFEFF/, '');
  const lines = body.split(/\r?\n/);
  if (!lines.length) return phones;
  const header = splitCsv(lines[0]);
  // find CellPhone (ignore whitespace/case), else any column containing "phone"/"cell"
  let idx = header.findIndex((h) => h.replace(/\s+/g, '').toLowerCase() === 'cellphone');
  if (idx < 0) idx = header.findIndex((h) => /phone|cell|mobile/i.test(h));
  if (idx < 0) return phones;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsv(lines[i]);
    const p = normPhone(cols[idx]);
    if (p) phones.add(p);
  }
  return phones;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function buildBigDogReport(
  env: Env,
  opts: { updated?: string; onProgress?: ProgressFn } = {},
): Promise<BuildResult> {
  const prog = async (phase: string, msg: string) => {
    if (opts.onProgress) await opts.onProgress(phase, msg);
  };
  const warnings: string[] = [];

  // 1. ReadyGOP opt-outs (SAG provider) ------------------------------------
  await prog('pull', 'Pulling opt-outs from ReadyGOP...');
  const { rows: rgopRows } = await pullOptOuts(env, MAGA_CLIENT.id, {
    onProgress: (p) =>
      prog('pull', `ReadyGOP: ${p.pulled.toLocaleString()}${p.totalCount ? ' of ' + p.totalCount.toLocaleString() : ''} opt-outs`),
  });
  const sagProvider = new Set<string>();
  const sagOptCountByProject = new Map<string, number>();
  for (const r of rgopRows) {
    const nm = normWs(r.project);
    if (!/Big Dog SAG MMS/i.test(nm)) continue;
    const p = normPhone(r.phone);
    if (p) sagProvider.add(p);
    sagOptCountByProject.set(nm, (sagOptCountByProject.get(nm) || 0) + 1);
  }

  // 2. co/nnect opt-outs (NGB provider) ------------------------------------
  const ngbProvider = new Set<string>();
  const ngbOptCountByProject = new Map<string, number>();
  if (connectConfigured(env)) {
    await prog('pull', 'Pulling opt-outs from co/nnect...');
    const c = await pullConnectOptOuts(env);
    for (const r of c.rows) {
      const nm = normWs(r.project);
      if (!/Big Dog No Going Back MMS/i.test(nm)) continue;
      const p = normPhone(r.phone);
      if (p) ngbProvider.add(p);
      ngbOptCountByProject.set(nm, (ngbOptCountByProject.get(nm) || 0) + 1);
    }
  } else {
    warnings.push('co/nnect not configured; NGB provider opt-outs skipped.');
  }

  // 3. P2P S3 bucket unions ------------------------------------------------
  await prog('pull', 'Reading P2P opt-out bucket (SAG)...');
  const p2pSag = await buildOptOutSet(env, PACS.SAG.p2pOrg).catch((e) => {
    warnings.push(`P2P sag-pac read failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Set<string>();
  });
  await prog('pull', 'Reading P2P opt-out bucket (No Going Back)...');
  const p2pNgb = await buildOptOutSet(env, PACS.NGB.p2pOrg).catch((e) => {
    warnings.push(`P2P no-going-back-pac read failed: ${e instanceof Error ? e.message : String(e)}`);
    return new Set<string>();
  });

  const union: Record<keyof typeof PACS, Set<string>> = {
    SAG: new Set<string>([...sagProvider, ...p2pSag]),
    NGB: new Set<string>([...ngbProvider, ...p2pNgb]),
  };

  // 4. Drive send lists: list folder once, index by project number ----------
  await prog('pull', 'Listing Big Dog send lists from Drive...');
  const driveFolder = env.DRIVE_FOLDER_BIGDOG;
  const sendListByNum = new Map<string, { id: string; name: string }>();
  if (driveFolder) {
    try {
      const files = await driveList(env, driveFolder);
      for (const f of files) {
        const num = projectNumber(f.name);
        if (num && /\.csv$/i.test(f.name)) {
          // Prefer a _scrubbed file if multiple share a number.
          const existing = sendListByNum.get(num);
          if (!existing || /_scrubbed/i.test(f.name)) {
            sendListByNum.set(num, { id: f.id, name: f.name });
          }
        }
      }
    } catch (e) {
      warnings.push(`Drive list failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    warnings.push('DRIVE_FOLDER_BIGDOG not configured; send lists unavailable.');
  }

  const sendPhoneCache = new Map<string, Set<string>>();
  let sendListsFound = 0;
  let sendListsMissing = 0;
  const getSendPhones = async (num: string | null): Promise<Set<string> | null> => {
    if (!num) return null;
    if (sendPhoneCache.has(num)) return sendPhoneCache.get(num)!;
    const f = sendListByNum.get(num);
    if (!f) { sendListsMissing++; return null; }
    try {
      const text = await driveDownloadText(env, f.id);
      const phones = sendPhonesFromCsv(text);
      sendPhoneCache.set(num, phones);
      sendListsFound++;
      return phones;
    } catch (e) {
      warnings.push(`send list ${num} download failed: ${e instanceof Error ? e.message : String(e)}`);
      sendListsMissing++;
      return null;
    }
  };

  // 5. Assemble waves per race/PAC -----------------------------------------
  await prog('build', 'Matching send lists and counting opt-outs...');

  // Collect project names seen per PAC (from provider opt-out projects).
  const sagProjects = new Set<string>([...sagOptCountByProject.keys()]);
  const ngbProjects = new Set<string>([...ngbOptCountByProject.keys()]);

  const races = new Map<string, RaceOut>();
  const ensureRace = (key: string): RaceOut => {
    let r = races.get(key);
    if (!r) { r = { key, name: '', order: 900, pacs: {} }; races.set(key, r); }
    return r;
  };

  const addWaves = async (
    pacKey: keyof typeof PACS,
    projects: Set<string>,
    optCountByProject: Map<string, number>,
  ) => {
    const marker = PACS[pacKey].marker;
    const byRace = new Map<string, Wave[]>();
    for (const nm of projects) {
      const parsed = parseProject(nm, marker);
      if (!parsed) continue;
      const num = projectNumber(nm);
      const phones = await getSendPhones(num);
      let optOuts: number | null;
      let tested: number | null;
      const providerCount = optCountByProject.get(nm) || 0;
      if (phones && phones.size) {
        let hits = 0;
        for (const p of phones) if (union[pacKey].has(p)) hits++;
        optOuts = hits;
        tested = phones.size;
      } else {
        // No send list -> fall back to provider opt-out count (floor).
        optOuts = providerCount;
        tested = null;
      }
      const w: Wave = {
        date: fmtDate(parsed.date),
        dateSort: sortKey(parsed.date),
        project: nm,
        projectNumber: num,
        optOuts,
        tested,
        providerOptOuts: providerCount,
      };
      const arr = byRace.get(parsed.key) || [];
      arr.push(w);
      byRace.set(parsed.key, arr);
    }
    for (const [key, waves] of byRace) {
      waves.sort((a, b) => a.dateSort - b.dateSort);
      ensureRace(key).pacs[pacKey] = { waves };
    }
  };

  await addWaves('SAG', sagProjects, sagOptCountByProject);
  await addWaves('NGB', ngbProjects, ngbOptCountByProject);

  // 6. Single-PAC races: add a "potential" block for the missing PAC --------
  for (const race of races.values()) {
    const present = PAC_ORDER.filter((k) => race.pacs[k]);
    if (present.length !== 1) continue;
    const have = present[0];
    const missing: keyof typeof PACS = have === 'SAG' ? 'NGB' : 'SAG';
    const w1 = race.pacs[have]!.waves[0];
    const universe = await getSendPhones(w1?.projectNumber || null);
    if (universe && universe.size) {
      let miss = 0;
      const p2pMissing = missing === 'SAG' ? p2pSag : p2pNgb;
      for (const p of universe) if (p2pMissing.has(p)) miss++;
      race.pacs[missing] = {
        potential: true,
        universe: universe.size,
        potentialOptOuts: miss,
        remaining: universe.size - miss,
        waves: [],
      };
    }
  }

  // 7. Apply race-name table (names + order) --------------------------------
  const table = await loadRaceTable(env);
  const unknownRaceKeys: string[] = [];
  for (const race of races.values()) {
    const e = table[race.key];
    if (e) {
      race.name = e.name;
      race.order = e.order;
    } else {
      race.name = defaultRaceName(race.key);
      race.order = 900;
      unknownRaceKeys.push(race.key);
    }
  }

  const racesArr = [...races.values()].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );

  // Stats
  let optOutsTotal = 0;
  for (const r of racesArr) {
    for (const k of PAC_ORDER) {
      const pac = r.pacs[k];
      if (!pac) continue;
      if (pac.potential) { optOutsTotal += pac.potentialOptOuts || 0; continue; }
      for (const w of pac.waves) optOutsTotal += w.optOuts || 0;
    }
  }

  const now = new Date();
  const updated =
    opts.updated ||
    now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

  return {
    title: 'Big Dog MMS Report by Race & PAC',
    updated,
    generatedAt: now.toISOString(),
    races: racesArr,
    unknownRaceKeys,
    stats: {
      optOutsTotal,
      racesCount: racesArr.length,
      sagProviderOptOuts: sagProvider.size,
      ngbProviderOptOuts: ngbProvider.size,
      p2pSag: p2pSag.size,
      p2pNgb: p2pNgb.size,
      sendListsFound,
      sendListsMissing,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Render HTML (ports 10_build_billing_report.py, texts = "-")
// ---------------------------------------------------------------------------

function fmt(n: number | null): string {
  return typeof n === 'number' ? n.toLocaleString('en-US') : '-';
}

function pacBlockHtml(pacName: string, pac: PacBlock | undefined, maxRows: number): string {
  if (!pac) return '';
  const blank =
    '<div class="wave"><div class="date">&nbsp;</div><div class="n"></div><div class="n"></div></div>\n';
  if (pac.potential) {
    const pad = blank.repeat(maxRows);
    return (
      `<div class="pac"><div class="pachead"><div class="pacname">${pacName} ` +
      `<span class="tag">not yet texted</span></div>` +
      `<div class="n">0</div><div class="n"></div></div>\n` +
      `${pad}` +
      `<div class="remrow"><div class="lbl">Remaining contacts</div>` +
      `<div class="val">${fmt(pac.remaining ?? null)}</div><div class="n"></div></div></div>\n`
    );
  }
  // Texts Sent = "-" for every wave (sales tracker not wired yet).
  let wv = '';
  let optTotal = 0;
  for (const w of pac.waves) {
    optTotal += w.optOuts || 0;
    wv +=
      `<div class="wave"><div class="date">${w.date}</div>` +
      `<div class="n">-</div><div class="n">${fmt(w.optOuts)}</div></div>\n`;
  }
  wv += blank.repeat(Math.max(0, maxRows - pac.waves.length));
  // Remaining = "-" until sales tracker provides texts_sent.
  return (
    `<div class="pac"><div class="pachead"><div class="pacname">${pacName}</div>` +
    `<div class="n">-</div><div class="n">${fmt(optTotal)}</div></div>\n` +
    `${wv}` +
    `<div class="remrow"><div class="lbl">Remaining contacts</div>` +
    `<div class="val">-</div><div class="n"></div></div></div>\n`
  );
}

function waveCount(pac: PacBlock | undefined): number {
  if (!pac || pac.potential) return 0;
  return pac.waves.length;
}

export function renderBigDogHtml(result: BuildResult): string {
  const sections: string[] = [];
  for (const r of result.races) {
    const sag = r.pacs.SAG;
    const ngb = r.pacs.NGB;
    const maxRows = Math.max(waveCount(sag), waveCount(ngb));
    const left = pacBlockHtml('SAG', sag, maxRows);
    const right = pacBlockHtml('No Going Back', ngb, maxRows);
    sections.push(
      `<section class="race"><div class="head"><div class="name">${escapeHtml(r.name)}</div></div>\n` +
        `<div class="paccols"><div class="paccol">${left}</div>` +
        `<div class="paccol">${right}</div></div></section>`,
    );
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(result.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:letter portrait;margin:0.35in;}
:root{color-scheme:only light;}html{background:#fff !important;}*{box-sizing:border-box;}
body{margin:0;background:#fff;overflow-x:hidden;max-width:100%;color:#111827;font-family:'Inter',system-ui,sans-serif;font-feature-settings:"tnum" 1;-webkit-font-smoothing:antialiased;}
.wrap{max-width:860px;width:100%;margin:0 auto;padding:18px 16px 20px;}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:0 0 14px;}
.title h1{font-size:19px;font-weight:700;letter-spacing:-0.01em;margin:0 0 3px;}
.title .updated{font-size:12px;color:#6b7280;margin:0;}
.logos{display:flex;align-items:center;gap:10px;flex-shrink:0;}
.logos img{height:34px;width:auto;max-width:120px;object-fit:contain;display:block;}
.cols,.head,.pachead,.wave,.remrow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(64px,1fr) minmax(56px,0.9fr);gap:8px;align-items:baseline;}
.collabels{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:2px;}
.collabels .colhdr{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(64px,1fr) minmax(56px,0.9fr);gap:8px;padding-left:12px;}
.collabels .colhdr div{font-size:9px;letter-spacing:0.04em;text-transform:uppercase;color:#9ca3af;font-weight:600;}
.collabels .colhdr .n{text-align:right;}
.race{padding:6px 0 6px;border-bottom:1px solid #e5e7eb;break-inside:avoid;}.race:last-of-type{border-bottom:none;}
.head .name{font-size:15px;font-weight:700;}.head .n{font-size:14px;font-weight:600;color:#374151;}
.paccols{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
.paccol{min-width:0;}
.pac{margin-top:4px;padding-left:10px;margin-left:2px;}
.pachead{margin-top:2px;}
.pachead .pacname{font-size:13px;font-weight:600;color:#1f2937;}
.pachead .n{font-size:13px;font-weight:600;}
.wave{margin-top:1px;}.wave .date{font-size:12px;color:#6b7280;padding-left:12px;line-height:1.35;}.wave .n{font-size:12px;color:#4b5563;line-height:1.35;}
.remrow{margin-top:3px;}
.remrow .lbl{font-size:12px;font-weight:600;color:#16a34a;padding-left:12px;}
.remrow .val{font-size:13px;font-weight:700;color:#16a34a;text-align:right;font-variant-numeric:tabular-nums;}
.pac .tag{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#9ca3af;border:1px solid #e5e7eb;border-radius:3px;padding:1px 5px;margin-left:6px;vertical-align:middle;}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.footer{margin-top:26px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;gap:8px;}
.footer span{font-size:11px;color:#9ca3af;letter-spacing:0.03em;}
.footer img{height:16px;width:auto;display:block;opacity:0.85;}
@media (max-width:520px){.wrap{padding:16px 14px 28px;}.logos img{height:24px;max-width:96px;}.paccols{grid-template-columns:1fr;gap:0;}}
</style></head><body><div class="wrap">
<div class="topbar">
 <div class="title"><h1>${escapeHtml(result.title)}</h1><p class="updated">Last updated ${escapeHtml(result.updated)}</p></div>
 <div class="logos"><img src="${MAGA_LOGO}" alt="MAGA Inc"><img src="${BIGDOG_LOGO}" alt="Big Dog Strategies"></div>
</div>
<div class="collabels">
 <div class="colhdr"><div>Race / PAC</div><div class="n">Texts Sent</div><div class="n">Opt Outs</div></div>
 <div class="colhdr"><div>Race / PAC</div><div class="n">Texts Sent</div><div class="n">Opt Outs</div></div>
</div>
${sections.join('\n')}
<div class="footer"><span>Powered by</span><img src="${COEFF_LOGO}" alt="co/efficient"></div>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
