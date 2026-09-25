# Feature: co/nnect API integration (second opt-out source)

Status: SHIPPED to staging + production 2026-09-25. First real prod run: the
9pm CDT nightly on 2026-09-25.

## The goal

Texts now go out on TWO platforms: ReadyGOP and co/nnect (txt.coefficient.org,
our other texting vendor). Previously the nightly batch only pulled ReadyGOP
opt-outs automatically; co/nnect opt-outs were pulled by hand (a CSV downloaded
from the co/nnect API and dropped into the manual-drop UI), producing a SECOND,
manual email.

This feature folds co/nnect into the automated nightly so BOTH sources are
pulled, merged, and reported in ONE email. No more manual drop for co/nnect.

## The co/nnect API

Single endpoint, read-only, returns ALL co/nnect opt-outs as CSV:

```
GET https://txt.coefficient.org/api/v1/opt-outs/export.csv
    Authorization: Bearer <CONNECT_API_TOKEN>
```

- Responds **302 -> a short-lived presigned S3 URL** (the vendor's own export
  bucket, us-east-2). The fetch MUST follow the redirect (`redirect: 'follow'`).
  The Bearer header is only sent to txt.coefficient.org; S3 uses its own signed
  query params, so dropping the header on the redirect hop is correct.
- CSV columns (note: file has a UTF-8 BOM, which our parser strips):
  `Phone,Source,Keyword,Project,Opted Out At (UTC),Status,Reinstated At (UTC),Opt-In Source`
- ~62k opt-out rows as of 2026-09-25, ~24 projects, all "No Going Back" so far.

## How it plugs in (architecture)

The pipeline was already source-agnostic after the pull: any `RgopOptOut[]`
(phone, project, createdAt) flows through `buildRunLog` -> S3 read-back/diff ->
quarantine -> commit. So co/nnect just adds a second source of those rows.

```
ReadyGOP pull ─┐
               ├─ concat + dedup(by phone, via buildRunLog's per-group Set)
co/nnect pull ─┘        │
                        v
                   buildRunLog()  (unchanged)  -> RunLog -> commit (S3 + email)
```

Files:
- **`src/connect.ts`** (new): `pullConnectOptOuts(env)` fetches export.csv,
  follows the 302, parses via the existing `parseUploadCsv` (header-based column
  detection, drops reinstated / non-"Opted Out" rows, normalizes phones), tags
  each row `platform: 'co/nnect'`. `connectConfigured(env)` gates the pull.
- **`src/rgop.ts`**: `RgopOptOut` gained an optional `platform` field; ReadyGOP
  rows are tagged `platform: 'ReadyGOP'`.
- **`src/runner.ts`**: after the ReadyGOP pull, `runOptOutSync` pulls co/nnect
  (NON-FATAL - see below), concatenates the rows, and feeds the merged set to
  `buildRunLog`. Also computes a `SourceBreakdown` (kept internally; only the
  failure note surfaces in the email now).
- **`src/runlogs.ts`**: `ProjectRow` gained `platform`; the email project
  breakdown shows a "Texting Platform" column. Email label changes (below).

Projects are unique to one platform, so "Texting Platform" is a clean 1:1 label
per project - no phone can make a project ambiguous.

## De-dup / per-PAC scoping

`buildRunLog` groups phones into a Set per `(pac, destination)`, so merging is
just `rgopRows.concat(connectRows)` - duplicates collapse automatically. NOTE:
opt-outs are scoped PER PAC. The same phone can legitimately opt out under two
different PACs (allowed to text them from PAC B even after they opt out of
PAC A). That is NOT double-counting; each (PAC, phone) is its own opt-out. This
is why we do NOT show a cross-source "overlap" number - it was misleading.

## Failure handling (non-fatal)

If `CONNECT_API_TOKEN` is unset, or the co/nnect pull errors, the run logs it
and proceeds with **ReadyGOP only**. A co/nnect outage never blocks the
ReadyGOP sync or the S3 writes. The email shows a one-line red note only when
co/nnect actually failed.

## Email changes (display only - no logic changed)

- "Destination" column renamed to **"Client"** (audience-facing; the S3 folder
  is still internally called destination).
- Added **"Texting Platform"** column after Client on the project breakdown.
- Standardized counts to **New / Total** everywhere (top line, PAC/Client table,
  project breakdown). Dropped the "Already reported" column (Total - New).
- Removed the "Sources (merged, de-duped)" box (the overlap number confused).
- Subject dropped the ", N project(s) need mapping" suffix.
- The "awaiting mapping" notice moved to the BOTTOM of the email as a small
  muted line (it is a routine awaiting-assignment state, not an error). A better
  mapping workflow is deferred (see BACKLOG).

## Config

- **Var** `CONNECT_API_URL` = the export endpoint (staging + prod wrangler.toml).
  If unset, `connect.ts` falls back to the known default URL.
- **Secret** `CONNECT_API_TOKEN` = *** Bearer token. Set via
  `wrangler secret put CONNECT_API_TOKEN --env staging|production`. If unset,
  co/nnect is skipped (non-fatal).

## Safety verification (2026-09-25)

- Local read-only pull: HTTP 200, ~62.5k usable unique opt-outs, 24 projects,
  1 reinstated row correctly dropped. BOM handled.
- Staging is `ALLOW_S3_WRITES=false` (no writes) and forces email to Jacob only.
- Prod deployed with token + URL; first real run is the nightly. Prod writes
  new co/nnect opt-outs to the real client buckets (intended).

## Deferred / follow-ups

- Improve the project->(PAC, Client) mapping workflow so held projects feel like
  a normal state, not an error. (Discussed; not yet built.)
- co/nnect token lifetime is unknown; if it rotates/expires the nightly silently
  loses co/nnect. Ties into the BACKLOG dead-man-alert item (warn if a source
  returns 0 / errors, or if no successful sync in >26h).
