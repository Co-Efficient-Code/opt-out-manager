# Feature Plan: CSV opt-out upload (non-ReadyGOP source)

Status: PLANNING ONLY. No code changed. Documented 2026-09-22.

## The goal (from Jacob, 2026-09-22)

All texts so far went out on ReadyGOP, so every opt-out uploaded by the nightly
batch comes straight from ReadyGOP's API. Now some PAC projects are being texted
on an **additional texting platform**. We need a second way to get *those*
opt-outs into the same pipeline.

- For now, those opt-outs arrive as a **CSV file** (an API connection to the new
  platform is planned but NOT ready).
- Ideal UX: on the **Run logs** page, **drop a CSV in**, and it processes **only
  those** opt-outs and pushes them through the **same pipe** as ReadyGOP.
- We should **not** have to re-run the full ReadyGOP pull to do this.
- Project names in the CSV will match the **same names we already use for
  PAC/Destination mapping**, so mapping/quarantine works unchanged.

## Why this is a good fit (current architecture)

The pipeline is already cleanly staged and source-agnostic AFTER the pull:

```
ReadyGOP pull  ->  rows: RgopOptOut[]  ->  buildRunLog()  ->  RunLog
                     {phone, project,        (parse pac/dest, override,
                      createdAt}              read-back S3, new-vs-reported,
                                              quarantine)
                                                     |
                                          buildOutputFiles()  ->  OutputFile[]
                                                     |
                                          putObjectNoOverwrite() -> client S3
                                                     |
                                          buildRunEmail() -> summary email
```

Key fact: **everything downstream of the pull operates on a generic
`RgopOptOut[]` array** (`src/rgop.ts`: `{ phone, project, createdAt }`). Nothing
in `buildRunLog` / `buildOutputFiles` / the S3 write / the email cares that the
rows came from ReadyGOP. So a CSV upload only needs to **produce the same
`RgopOptOut[]` shape**, then it rides the identical rails:

- `parseProject(name)` -> pac/destination tokens (SAG/SMP/MAGA/No Going Back x Big Dog/Creative Direct)
- human overrides from KV win per-field (same mapping UI)
- unmapped -> quarantine (same "action needed" flow)
- `normalizePhone()` -> 10-digit dedupe (same)
- S3 read-back per (pac,dest) -> new-vs-already-reported (same)
- `buildOutputFiles()` -> `optouts/<pac>/optouts_<pac>_<stamp>.csv`, schema `organization,phone` (same, byte-for-byte)
- `putObjectNoOverwrite` to the real bucket (same, gated by `ALLOW_S3_WRITES`)
- summary email (same)

This is exactly the "same pipe" Jacob asked for.

## What changes (the pipes)

Only ONE new thing is really needed: **a source adapter that turns an uploaded
CSV into `RgopOptOut[]`**, plus a route + UI to feed it in. The rest is reuse.

### 1. New: CSV -> RgopOptOut[] adapter  (small, new function)
- Parse the uploaded CSV into `{ phone, project, createdAt }[]`.
- Needs a **phone column** and a **project column**. Detection options:
  - auto-detect header containing "phone" and "project" (mirror
    `phonesFromCsv()` header logic already in `runlogs.ts`), or
  - let the user pick columns in the UI (mirror the Scrub tab's phone-col picker).
- `createdAt` can be null or "now" (only used for display; not required for output).
- Reuse `normalizePhone()` (already in `runlogs.ts`) for consistency.
- Decision needed: what if project column is missing? -> either require it, or
  let the user type a single project name that applies to the whole file
  (useful if the new platform exports one file per project).

### 2. New route: `POST /api/runlogs/upload`  (parallels `/api/runlogs/dry-run`)
- Accept multipart file upload (reuse the `.b64` WAF-bypass + `base64DecodeStream`
  already built for the Scrub tab in `parsefile.ts` / `index.ts`).
- Decode -> CSV adapter -> `RgopOptOut[]`.
- Call the **existing** `runOptOutSync()` BUT skip the ReadyGOP pull. Two ways:
  - **Option A (cleanest):** refactor `runOptOutSync` to accept pre-fetched
    `rows` (e.g. `opts.rows?: RgopOptOut[]`); when present, skip `pullOptOuts`.
    Then CSV upload and ReadyGOP pull share 100% of the downstream code.
  - Option B: a thin parallel runner that calls `buildRunLog` + write + email
    directly with the CSV rows. More duplicate code; less ideal.
  - **Recommend Option A.**
- Stream NDJSON progress exactly like `/runlogs/dry-run` so the same UI status
  bar + silent-recovery logic works.
- Set `source: 'csv-upload'` (vs 'readygop-live'/'readygop-cron') so run history
  and the email clearly show where these came from.

### 3. UI: add a drop zone to the Run logs tab
- Run logs tab currently has: "Refresh Optouts" button + status + results.
- Add a second control: "Upload opt-out CSV" drop zone (reuse the Scrub tab's
  green drop-zone UX at `ui.ts` ~line 502, and `toUploadFile()` base64 encoder).
- On drop -> POST to `/api/runlogs/upload` -> render the SAME run-result view
  (`renderRunResult`) and refresh history. Quarantine/assign works unchanged.
- Make it visually clear this processes ONLY the uploaded file (not a full pull).

### 4. Nothing else changes
- Mapping (`mapping.ts`), quarantine, S3 read-back, `buildOutputFiles`, email,
  run history, `ALLOW_S3_WRITES` gating: all reused as-is.
- No change to the nightly cron or ReadyGOP path.

## REVISED DIRECTION (Jacob, 2026-09-22 11:23 CDT): new tab, map BEFORE commit

### The problem with reusing the Run logs flow
Today's Run logs "Refresh Optouts" button is **commit-first**: it processes,
emails, and (in prod) writes to S3 in one shot, THEN shows unmapped projects for
you to assign, so you map and **run again** -> a SECOND email + second write.
That double-email / commit-then-fix flow is fine for the nightly cron and the
manual push button, and Jacob wants those **left exactly as they are**.

For **manual CSV drops** Jacob wants the opposite order:
**upload -> preview + map everything -> THEN one email + one S3 dump.**
Mapping happens BEFORE anything leaves the system. No double email.

### Decision: build a SEPARATE new tab ("Upload opt-outs" / "Manual drop")
- Do NOT modify the Run logs tab, the nightly cron, or the manual push button.
- New tab = same underlying pipeline, but a **two-phase, map-before-commit** UX.
- Also captures the immediate ask: for THIS file, all `(no match found)` /
  unmapped rows should go to **no-going-back-pac** — but that may not hold for
  future unknowns, so it must be a **per-drop choice a human makes in the
  preview**, not a hardcoded rule.

### Two-phase design (leverages existing dry-run/write split)
The pipeline already separates compute from commit:
- `buildRunLog()` = parse + map + quarantine + S3 read-back + new-vs-reported.
  **Reads only, writes nothing.** This IS the preview.
- S3 write (`buildOutputFiles` + `putObjectNoOverwrite`) + email happen AFTER,
  gated separately (`ALLOW_S3_WRITES`).

So the new tab is:

**Phase 1 - PREVIEW (no write, no email):**
1. User drops CSV on the new tab.
2. Server parses CSV -> `RgopOptOut[]`, runs `buildRunLog()` ONLY (read-only).
3. Return the run-log to the UI: per (pac,dest) new counts, per-project rows,
   and the list of **unmapped/quarantined** projects (incl. `(no match found)`).
4. UI shows the result with inline PAC+Destination pickers for every unmapped
   project (reuse existing `assignCell`/`wireAssigns`). User maps them. For this
   file: set the unmapped -> no-going-back-pac / Big Dog.
   - Mapping choices here persist via existing `POST /api/mapping` (KV override),
     OR be applied as a one-off for THIS drop only (see open q #A below).
5. After each map, re-preview (recompute buildRunLog) so counts update live and
   the user SEES the final state before committing. Nothing written yet.

**Phase 2 - COMMIT (write + email), explicit button:**
6. Once the user is satisfied (ideally zero unmapped, or they accept remaining
   quarantine), they click **"Confirm & upload"**.
7. Server recomputes buildRunLog with the now-applied mappings, then does the
   S3 write (same `buildOutputFiles` + `putObjectNoOverwrite`) and sends ONE
   summary email (source = 'csv-upload'), and records run history.
8. Single email, single dump. Done.

### Handling "these go to no-going-back-pac, but maybe not future ones"
- The preview shows unmapped rows and lets the human choose the PAC/dest THIS
  time. Optionally offer a one-click "assign all unmapped -> [pick PAC/dest]"
  bulk action so 262 `(no match found)` rows can be routed in one move without a
  permanent KV rule.
- **Open q #A:** should mapping in this tab be a **one-off for this drop**
  (in-memory, applied to phase-2 commit only) or a **persistent KV override**
  (affects all future ReadyGOP + CSV runs)? Jacob's note ("might not be true for
  all unknown texts going forward") implies **one-off per drop is safer default**
  for `(no match found)`, with an option to "also save as permanent mapping" for
  real, stable project names. Recommend: per-drop by default, opt-in to persist.

### What this needs (vs the earlier single-phase plan)
- New tab UI (drop zone + preview + inline mapping + Confirm button). Medium.
- `POST /api/manualdrop/preview` -> parse CSV, buildRunLog only, return log. Small-med.
- `POST /api/manualdrop/commit` -> re-run buildRunLog with applied mappings,
  write S3 + email + history. Small (reuses runner write/email blocks).
- Refactor: extract the write+email+history block from `runOptOutSync` so both
  the ReadyGOP runner and the commit route call the SAME commit logic. Or add
  `opts.rows` + `opts.skipEmail/skipWrite` phases to runner. Keep ReadyGOP path
  byte-identical.
- CSV->rows adapter: as before (auto-detect Phone/Project).
- One-off vs persistent mapping application (open q #A).

## User flow (proposed)

1. User goes to **Run logs** tab.
2. Under a new "Upload from other platform (CSV)" section, drops the CSV.
3. (If columns can't be auto-detected) picks the phone + project columns, or
   confirms a single project name for the whole file.
4. Clicks process. Live status streams (parsing -> read-back -> write).
5. Same result view: New opt-outs by PAC/Destination, quarantined projects to
   assign, per-project breakdown. Same email (source labeled "CSV upload").
6. New opt-outs land in the same `optouts/<pac>/` client buckets, deduped
   against what's already reported. No ReadyGOP re-run.

## SAMPLE FILE ANALYSIS (optouts-no-going-back-pac.csv, 2026-09-22)

Real export from the new platform. 33,293 data rows, 4.1 MB, 9 columns.

**Header (exact):**
`Phone,Project,Source,Keyword,Opted Out At (UTC),Status,Reinstated At (UTC),Opt-In Source,Match Confidence (seconds gap)`

What we only need: **Phone** and **Project**. The rest is metadata we can ignore
(but Status/Reinstated may matter, see below).

### Findings (all verified against the real file)

- **Phone format:** 100% `+1XXXXXXXXXX` (E.164). `normalizePhone()` already
  strips non-digits and drops a leading 11-digit `1`, so `+14782623145` -> `4782623145`.
  **Works as-is, no change needed.**
- **Project names:** match our mapping keys char-for-char, e.g.
  `261215 GA Senate Big Dog No Going Back MMS 9.21`. Our `parseProject()` tags
  all 7 real projects correctly: **pac=`no-going-back-pac`, dest=`Big Dog`** via
  the existing "No Going Back" + "Big Dog" tokens. **No new tokens needed.**
- **TAB inside project names:** 7,241 rows have a literal TAB in the Project
  field (same quirk as ReadyGOP). `cleanName()`/`parseProject()` already replace
  `\t` with space. **Handled.**
- **Dedupe:** 0 duplicate phones within the file. Cross-run dedupe still handled
  by the existing S3 read-back + `putObjectNoOverwrite`. **No change.**
- **Status:** every row is `Status='Opted Out'`, `Source='Inbound_Stop'`,
  `Reinstated At` empty. Clean opt-outs.
- **One project per file?** This file is ALL No Going Back / Big Dog, but the
  Project COLUMN varies per row (7 different project numbers). So it is
  **project-per-row**, not one-project-per-file. Good: we read the Project
  column per row exactly like ReadyGOP; no single-project-name input needed.
- **`(no match found)`:** 262 rows have Project = literal `(no match found)`.
  These are opt-outs the platform could not attribute to a project. Our parser
  tags them pac=None/dest=None -> they land in **QUARANTINE** (held, flagged
  in email for a human to assign or ignore). This is the correct, safe default
  behavior and matches how ReadyGOP unmapped projects are handled.

### Resolved decisions from the sample

- **Column contract:** auto-detect `Phone` and `Project` headers (case-insensitive
  exact match), no picker needed for this format. Keep a fallback picker only if
  a future file lacks clear headers.
- **createdAt:** use `Opted Out At (UTC)` if present (display only), else null.
- **Project matching:** confirmed identical to mapping keys. No per-source
  override layer needed.
- **Filtering:** optionally only ingest rows where `Status == 'Opted Out'` and
  `Reinstated At` is empty (defensive; this file is 100% that already).

### Remaining questions (smaller now)

1. **`(no match found)` policy:** quarantine (current safe default) is fine, but
   confirm we do NOT want to auto-drop them. Recommend: quarantine + surface
   count in email, same as ReadyGOP.
2. **Re-upload safety:** if the same file is dropped twice, read-back +
   no-overwrite prevents duplicate PHONES landing, but a 2nd run creates a new
   timestamped file containing 0 new rows (skipped by buildOutputFiles since
   newPhones is empty). So re-upload is naturally idempotent. Confirm acceptable.
3. **Will other platforms use the SAME header?** This adapter is written for THIS
   platform's schema. If a 3rd platform appears with different headers, we widen
   auto-detection then. For now, code to this contract + graceful error if
   Phone/Project columns are absent.

## Open questions to resolve before building

1. **CSV format contract:** exact columns the new platform exports. Header
   names? One project per file or a project column per row? Phone format
   (10-digit, +1, dashes)? Get 1-2 real sample files.
2. **Project name match:** confirm the platform's project names match our
   mapping keys char-for-char (same as ReadyGOP `cleanName` output). If not,
   we may need per-source overrides.
3. **Column selection:** auto-detect vs explicit picker vs single-project-name
   input. Depends on #1.
4. **Dedupe scope:** dedupe only against S3 read-back (same as ReadyGOP), or
   also guard against re-uploading the same CSV twice? (read-back +
   `putObjectNoOverwrite` already prevents duplicate *phones* landing, but a
   re-upload would create a new timestamped file with any genuinely-new rows.)
5. **createdAt / audit:** do we want the output/email to note these came from
   the other platform (source tag) for traceability? Recommend yes.
6. **Writes:** confirm CSV uploads should write to the SAME real client buckets
   under `ALLOW_S3_WRITES` (prod), i.e. treated identically to ReadyGOP opt-outs.

## Effort estimate (rough)

- CSV->rows adapter: small (mirror existing `phonesFromCsv` + `normalizePhone`).
- `runOptOutSync` refactor to accept pre-fetched rows: small, low-risk.
- `/api/runlogs/upload` route (reuse scrub upload plumbing): small-medium.
- UI drop zone + wiring (reuse scrub drop zone + result renderer): medium.
- Total: modest, because ~80% is reusing existing, tested code paths.

## Risk notes

- Reusing `putObjectNoOverwrite` + read-back means CSV uploads inherit the same
  no-clobber, dedupe safety as ReadyGOP. Good.
- Main risk is the **CSV format assumptions** (column names, project-name
  matching). Nail the format contract (#1, #2) before coding.
- Keep the ReadyGOP path untouched; add CSV as a parallel entry so a bad upload
  can never affect the nightly batch.
```
