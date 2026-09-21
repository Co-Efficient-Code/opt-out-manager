# Backlog - opt-out-manager

Known issues and deferred work. Newest at top. Keep this on `main`.

## Open

### 3. No KV edit history / audit log (recurrence risk)
- **What:** Cloudflare KV keeps no per-key version history, no audit log, no deletion trace. When `project_overrides` is changed via the Run logs UI, there is no way to see the before/after or prove what an entry used to be.
- **Why it matters:** on 2026-09-21 a project (`261156 PA 01 Creative Direct 9.8`) was re-flagging every night. We could not prove or disprove whether its override had ever existed and been removed, because KV retains nothing. Diagnosis had to be reconstructed from `run_history` + live S3/ReadyGOP diffs.
- **Possible fixes (to evaluate):** lightweight append-only change-log key in the same KV (who/when/before/after on every `setOverride`), or mirror override writes to a git-tracked file / D1 table.
- **Status:** open, deferred. Flagged 2026-09-21. Enhancement, not blocking.

### 1. GitHub Actions deploys are failing
- **What:** the `deploy.yml` workflow (staging branch -> staging, main -> production) is red / does not successfully deploy.
- **Impact:** low. We deploy manually and reliably from local via wrangler:
  `npx wrangler deploy --env staging` / `--env production` (Cloudflare token sourced from a local env file). CI has never been the real deploy path.
- **Next step:** root-cause the workflow failure (likely secrets/token or wrangler action config). Not blocking; local deploy works.
- **Status:** open, not blocking. Flagged 2026-09-18.

## Resolved

### 2. Scrub uploads blocked by Cloudflare WAF (SQLi false positive) - FIXED 2026-09-21
- **Symptom:** scrubbing certain persuasion-cell files (`MAGA_MI_8_...`, `MAGA_NH_1_...`) returned `403` with a Cloudflare "Sorry, you have been blocked" page - blocked at the edge, never reached the Worker.
- **Root cause (proven on staging by bisecting):** the managed WAF SQLi ruleset scores the request body. Two independent triggers: (a) `--` tokens in dirty date fields (`1988--`, `-00-00`, `1976-03-00`) - collapsing `--`->`-` made the same file pass; (b) it is a scoring threshold across the whole body, so small slices passed while the full file did not. NOT one poisoned row.
- **What did NOT work:** gzip. Large gzip BINARY bodies get WAF-blocked on their own regardless of content (a benign large gz 403s; the same content as plain CSV passes). Gzip trades one false positive for another. Rejected after staging test.
- **Fix (Option A, base64):** client base64-encodes the CSV before upload (`.csv.b64`, `text/plain`). Base64 output is only `[A-Za-z0-9+/=]` - no `--`/quotes/SQL tokens, and stays plain text (not flagged-binary), so it passes the WAF at full size. Worker decodes transparently: buffered decode in `fileToCsv`, plus a streaming base64 decoder (`base64DecodeStream`) for the large-file `/scrub/drive` path so memory stays bounded on 100k-row files. Covers all upload paths: `/scrub`, `/scrub/drive`, `/preview`, `/push`.
- **Verified:** real NH file base64 -> 302 (past WAF) on staging AND prod; plain -> still 403. Decode round-trip byte-perfect (buffered + streaming, all chunk sizes). Human UI click-through on staging confirmed clean by Sally 2026-09-21 13:29 CDT.
- **Deployed:** staging (version 07018950) + production (version 02b9ab95), local wrangler.
- Files: `src/ui.ts` (toUploadFile -> base64), `src/parsefile.ts` (base64ToBytes + base64DecodeStream + fileToCsv .b64 detect), `src/index.ts` (/scrub/drive stream decode).


### PA 01 9.8 re-flagging every night (false "needs mapping") - FIXED 2026-09-21
- **Symptom:** nightly email kept flagging `261156 PA 01 Creative Direct 9.8` as unmapped (held 4,084 opt-outs), growing each night. Those opt-outs were already reported.
- **Root cause:** the project name ReadyGOP sends for 261156 has NO PAC token (no "SMP", no "MMS") so the parser cannot tag it. It relied on a KV override that was not present. The only override in prod/staging KV was for a DIFFERENT sibling project, `261207 PA 01 Creative Direct SMP MMS 9.19` (which the parser already auto-maps via its "SMP" token, so its override was redundant). Not a code regression - a mapping/coverage gap.
- **Proof (read-only diagnosis):** full ReadyGOP pull of client MAGA, Inc. = 4,084 unique phones for project 261156. Diffed against every file under S3 `optouts/strategic-majority-pac/` (Creative Direct bucket): ALL 4,084 already present (mostly in the 2026-09-11 manual seed file). 0 would be written. Pure false flag.
- **Timeline (from prod `run_history`):** Fri 9/19 21:15 CDT run was 100% clean (0 quarantined); project 261156 first appeared right after and quarantined from its first appearance. Weekend PAC-token work (commit 3497b5b) + the 9.19 KV assignment predated 261156's arrival, so it was never covered.
- **Fix:** replaced the KV `project_overrides` entry in BOTH prod (`c8cf8d1469094946beb41e22b77c22bd`) and staging (`c5678d4a97bd41f9b15feedabe68926c`):
  - removed `261207 PA 01 Creative Direct SMP MMS 9.19` (redundant; parser covers it)
  - added `261156 PA 01 Creative Direct 9.8` -> `strategic-majority-pac` / `Creative Direct` (key matches the exact ReadyGOP name, char-for-char)
- **Expected:** next nightly run resolves 261156, read-back finds all 4,084 already reported, 0 new, 0 written, no flag.
- **KV write only. No S3 or ReadyGOP writes.**

## Notes / non-issues (checked, no action needed)

- **Other 2 PAC tokens (maga-inc, strategic-majority-pac):** the name parser only auto-detects SAG and No Going Back. If a maga-inc or strategic-majority-pac project arrives with a name the parser cannot tag, it quarantines and flags in the nightly email; a human then assigns the PAC in the Run logs mapping UI (all four PACs are in the dropdown, validated by `PAC_SLUGS`, persisted to KV, override wins over parser). This is the designed safety net working as intended - same flow PA 01 already uses. Adding auto-detect tokens for those two PACs would be a convenience enhancement, not a defect fix. NOTE: a name with NO PAC token at all (e.g. `261156 PA 01 Creative Direct 9.8`) still depends entirely on a manual KV override - that is the gap that bit us 2026-09-21.
- **Region:** buckets are us-east-1. If `docs/bucket-inventory.md` says us-east-2 anywhere, that doc is wrong and should be corrected.
