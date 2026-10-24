/**
 * Detect the US state (and, if present, congressional district) from a project
 * name or filename, so the early-vote scrub knows which state's already-voted
 * universe to pull.
 *
 * This is DETECT + CONFIRM: the UI pre-selects the detected state but the user
 * confirms (or overrides) before the EV scrub runs. So this never has to be
 * perfect; it has to be right in the common case and honest about ambiguity.
 *
 * We pull the state statewide (not by district) by design: better to over-pull
 * the whole state's early voters than miss anyone. District is detected only for
 * display / audit.
 */

export const STATE_CODES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Full name -> code, for matching spelled-out states ("Arizona's 6th District").
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([c, n]) => [n.toLowerCase(), c]),
);

// Tokens that are two uppercase letters but are NOT states in our naming, so we
// don't mistake them for a state code. (Common noise in list names.)
const NOT_STATE = new Set([
  'CD', 'SD', // "CD 04" = congressional district (SD collides with South Dakota: handled by position)
  'HD', 'SEN', 'MMS', 'SMS', 'SAG', 'NGB', 'SM', 'PAC', 'HML', 'GOTV',
  'US', 'ID', 'OR', 'IN', // ID/OR/IN are real states but also common words; require stronger evidence (handled below)
]);
// Real state codes that are also common English words / abbreviations. We only
// accept these when they appear in a clearly state-shaped position.
const AMBIGUOUS = new Set(['ID', 'OR', 'IN', 'OH', 'OK', 'HI', 'ME', 'DE', 'PA', 'MA', 'MD', 'MO', 'MT', 'MS', 'AL', 'MN', 'MI', 'CO', 'CA', 'LA']);

export type Confidence = 'high' | 'low' | 'none';

export interface StateDetection {
  code: string | null; // USPS code, or null
  name: string | null; // full state name
  district: string | null; // e.g. '06' when a CD is present (display only)
  confidence: Confidence; // high = safe to pre-select; low = pre-select but flag; none = ask
  reason: string; // short human note for the UI / logs
}

/**
 * Detect the state from the combined signal of a project name and a filename.
 * Project name is the stronger signal (users type it deliberately); filename is
 * the fallback.
 */
export function detectState(projectName: string, fileName?: string): StateDetection {
  const primary = detectFromText(projectName || '');
  if (primary.code && primary.confidence === 'high') return primary;

  const secondary = fileName ? detectFromText(stripExt(fileName)) : empty('no filename');
  // Prefer a high-confidence filename hit over a low-confidence project hit.
  if (secondary.code && secondary.confidence === 'high') return secondary;
  // Otherwise take whichever found something, project first.
  if (primary.code) return primary;
  if (secondary.code) return secondary;
  return empty('no state found in project name or filename');
}

function detectFromText(text: string): StateDetection {
  if (!text.trim()) return empty('empty');
  const lower = text.toLowerCase();

  // 1) Spelled-out state name (strongest). "Arizona's 6th District", "New York".
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (lower.includes(name)) {
      return { code, name: STATE_CODES[code], district: findDistrict(text), confidence: 'high', reason: `matched name "${STATE_CODES[code]}"` };
    }
  }

  // 2) Tokenized code match. Split on spaces, underscores, and digit boundaries
  //    so "MAGA_AZ_6", "261184 NY CD 04", "NH_Sen" all yield clean tokens.
  const tokens = text.split(/[\s_\-]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/).map((t) => t.trim()).filter(Boolean);
  const upper = tokens.map((t) => t.toUpperCase());

  const hits: { code: string; idx: number; strong: boolean }[] = [];
  for (let i = 0; i < upper.length; i++) {
    const t = upper[i];
    if (t.length !== 2 || !(t in STATE_CODES)) continue;
    if (NOT_STATE.has(t) && t !== 'SD') continue; // SD kept (real state); others are noise words
    // A state token is "strong" when it is preceded by a known prefix (client /
    // project id number) or sits at the front, and is followed by a district or
    // office word. That shape is what every real list name uses.
    const prev = upper[i - 1] || '';
    const next = upper[i + 1] || '';
    const afterPrefix = i === 0 || /^\d{4,}$/.test(prev) || prev === 'MAGA' || prev === 'BIGDOG' || /^[A-Z]{3,}$/.test(prev);
    const beforeDistrict = /^\d{1,2}$/.test(next) || next === 'CD' || next === 'HD' || next === 'SEN' || next === 'SENATE' || next === 'GOV' || next === 'STATEWIDE';
    const strong = afterPrefix || beforeDistrict;
    hits.push({ code: t, idx: i, strong });
  }

  // Disambiguate: a strong-position hit wins. An ambiguous code (ID/OR/IN/etc.)
  // is only accepted when it is in a strong position.
  const strongHits = hits.filter((h) => h.strong && !(AMBIGUOUS.has(h.code) && !h.strong));
  const chosen = strongHits[0] || hits.find((h) => !AMBIGUOUS.has(h.code)) || hits[0];

  if (!chosen) return empty('no recognizable state code or name');

  const confidence: Confidence = chosen.strong && hits.filter((h) => h.strong).length <= 1 ? 'high' : 'low';
  return {
    code: chosen.code,
    name: STATE_CODES[chosen.code],
    district: findDistrict(text),
    confidence,
    reason:
      confidence === 'high'
        ? `matched "${chosen.code}" in a project-name position`
        : `found "${chosen.code}" but the name is ambiguous - please confirm`,
  };
}

/** Pull a congressional-district number if the name clearly carries one. */
function findDistrict(text: string): string | null {
  // "CD 04", "CD-6", "_6_", "6th District"
  let m = /\bCD[\s_\-]?0*(\d{1,2})\b/i.exec(text);
  if (m) return m[1].padStart(2, '0');
  m = /\b0*(\d{1,2})(?:st|nd|rd|th)\s+District\b/i.exec(text);
  if (m) return m[1].padStart(2, '0');
  // MAGA_AZ_6_ style: state code immediately followed by _<n>_
  m = /\b([A-Z]{2})[\s_\-]0*(\d{1,2})[\s_\-]/.exec(text.toUpperCase() + ' ');
  if (m && m[1] in STATE_CODES) return m[2].padStart(2, '0');
  return null;
}

function stripExt(fn: string): string {
  return fn.replace(/\.(csv|xlsx?|b64)$/i, '').replace(/_scrubbed$/i, '');
}

function empty(reason: string): StateDetection {
  return { code: null, name: null, district: null, confidence: 'none', reason };
}
