# Proposal: Ignore specific opt-outs that must never map to a bucket

Status: DRAFT for Sally's review. Nothing implemented. No code changed. No S3 touched.
Date: 2026-09-18

## Problem

The nightly email has a good safeguard: when a project can't be mapped to a
(PAC, Destination), its opt-outs are "quarantined" (held, not uploaded) and the
email raises a red "Action needed: N project(s) need mapping" flag.

Right now there are **356 opt-outs** that trip this flag every single night. Sally
says these 356 SHOULD NOT be mapped to any bucket (there is a real contextual
reason, not documented here). So they are a **permanent false-positive**: the
safeguard keeps screaming about opt-outs we have already decided to exclude.

Goal: suppress the false flag for these specific 356 indefinitely, WITHOUT
weakening the safeguard for genuinely new/unknown projects that DO need mapping.

## What the 356 actually are (verified, read-only)

Source: `last_run_log` KV (prod), run 2026-09-18T02:15:39Z, 56,537 total opt-outs.

- The quarantine has exactly ONE group: project name `(unknown)`, count **356**.
- `(unknown)` is a synthetic label. Code: `const clean = cleanName(r.project) || '(unknown)'`
  (src/runlogs.ts:149). So these 356 rows have a **blank / null project name**
  coming out of ReadyGOP.
- Every other project (20 of them) has a real name like
  `261181 GA Senate Big Dog SAG MMS 9.15` and parses cleanly to a PAC + Dest.
- Current `project_overrides` KV holds only one entry (PA 01). No ignore concept exists yet.

So the identifier for the 356 is: **project name is empty/blank** -> bucketed as
`(unknown)`. They are the only nameless opt-outs in the client.

## How quarantine works today (refresher)

`buildRunLog` (src/runlogs.ts):
1. Pull all opt-outs from ReadyGOP (read-only).
2. For each row: `parseProject(name)` extracts PAC token (SAG, No Going Back) and
   Dest token (Big Dog, Creative Direct). A human `override` in KV can supply
   either field.
3. If BOTH pac and dest resolve -> row joins a (pac|dest) group, gets written.
   If EITHER is missing -> row is quarantined under its project name, held, and
   counted into the email's "need mapping" flag.

There is no third state. Today a project is either mapped or flagged. We need a
third state: **intentionally ignored** (held, but NOT flagged).

## Options considered

### Option A - Map (unknown) to a real bucket. REJECTED.
Violates Sally's hard rule: these must never go to any client bucket.

### Option B - Filter blank-name rows out at pull time. REJECTED (too broad).
Dropping "all nameless rows" silently means if a NEW batch of nameless opt-outs
appears later for a different reason, we would auto-hide them too and lose the
safeguard. We want to ignore THESE, not "anything nameless forever, unaudited."

### Option C - Explicit ignore-list in KV, matched deliberately. RECOMMENDED.
Add an "ignore" concept parallel to the existing override concept. A project (or
specific rule) on the ignore-list is: held (never written to S3) AND excluded
from the "need mapping" flag. It shows in the email under a separate, neutral
"Intentionally excluded" line so it stays auditable, not invisible.

## Recommended solution (Option C) - detail

### Data model
New KV key in the existing OPTOUT_MAPPING namespace: `ignore_list`.
Value: JSON array of ignore rules. Start with a single rule for the 356.

Two ways to identify them; pick per Sally's context reason:

- **By project name** (simplest, matches today's reality): ignore the blank/`(unknown)`
  project group. Rule: `{ "match": "unmapped-blank", "reason": "<why>", "addedBy": "...", "addedAt": "..." }`.
  This ignores rows whose project name is empty. Clean because they are the ONLY
  nameless rows today.

- **By exact phone list** (most surgical, most robust): freeze the exact 356
  phone numbers into the ignore-list. Rule:
  `{ "match": "phones", "phones": ["5551234567", ...356...], "reason": "...", "addedAt": "..." }`.
  This ignores ONLY those exact 356 numbers. If a NEW nameless opt-out appears
  tomorrow, it is NOT auto-ignored - it will correctly flag as new/unknown, so the
  safeguard still works for future surprises.

RECOMMENDATION: **by exact phone list (surgical)**, because it honors "ignore
THESE specific 356" precisely and keeps the safeguard live for anything new.
Trade-off: if any of the 356 legitimately re-classify later, we would edit the
list. That is a feature (deliberate), not a bug.

Optionally combine: match blank-name AND cross-check against the frozen 356 so
drift is visible ("362 blank now, 356 on ignore-list, 6 NEW nameless -> flag those 6").

### Logic change (src/runlogs.ts, buildRunLog)
Add a third classification before the mapped/quarantined split:
1. Load `ignore_list` (like we load overrides today).
2. For each row, if it matches an ignore rule -> put it in a new `excluded`
   bucket. Do NOT add to any (pac|dest) group (never written). Do NOT add to
   `quarantine` (never flagged).
3. Keep the rest of the flow identical.

`RunLog` gains an `excluded: { reason, count }[]` field.

### Email change (src/runlogs.ts, buildRunEmail)
- The red "Action needed" flag counts ONLY true `quarantined`, so the 356 stop
  triggering it. If nothing else is unmapped, the email shows the green
  "All projects mapped. No action needed."
- Add a small neutral line: "Intentionally excluded: 356 opt-outs (reason)."
  Neutral styling, NOT the red warning box. Keeps it auditable without alarming.
- Subject line stops appending ", 1 project(s) need mapping" for the 356.

### How to set the rule (one-time, deliberate)
Either a tiny admin endpoint (`POST /api/ignore`, OAuth-guarded, mirrors the
existing mapping override endpoint) or a one-off KV write. Given this is rare,
an OAuth-guarded endpoint + a small UI control on the Run logs tab is cleanest
and keeps humans in the loop. A one-off `wrangler kv key put` also works to seed it.

### Safeguard integrity (why this is still robust)
- New unknown projects: still flagged. Ignore-list only silences explicit matches.
- Audit trail: each ignore rule carries reason + who + when; excluded count is
  shown every night, so nothing is truly hidden.
- Reversible: delete the rule -> the 356 flag again immediately.
- No S3 behavior change: excluded rows are simply never added to any write group.

## What I still need from Sally before building
1. The contextual reason (for the `reason` field + docs). One line is fine.
2. Match strategy: exact 356 phones (recommended, surgical) vs blank-name group
   (simplest) vs both (blank-name minus frozen-356 = flags future surprises).
3. Whether to build the OAuth-guarded ignore endpoint + UI, or just seed KV once.

## Explicit non-actions taken
- Did NOT pull ReadyGOP anew, did NOT run the nightly workflow, did NOT read or
  write S3, did NOT change code or config. All findings came from the existing
  `last_run_log` / `project_overrides` KV records (read-only) and source review.
