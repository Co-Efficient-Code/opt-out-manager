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

### 2. Michigan scrub file blocked by Cloudflare WAF (SQL-injection false positive)
- **What:** scrubbing `MAGA_MI_8_Persuasion_Cells_20260913.csv` fails. Cloudflare WAF managed ruleset flags the request as SQL injection and blocks it before it reaches the Worker.
- **Impact:** medium. That specific list cannot be scrubbed through the UI right now.
- **Likely cause:** some cell content in the upload trips a managed WAF SQLi rule. Common with names/values containing SQL-like tokens (quotes, `--`, `OR`, etc.).
- **Possible fixes (to evaluate):**
  - WAF exception / skip rule scoped to the scrub upload path on `optouts.coefficient.org` (narrow as possible).
  - Send the upload in a way the WAF does not inspect as a query (e.g. ensure multipart body, not URL-encoded query params).
  - Client-side pre-encode the file before POST and decode in the Worker.
- **Status:** open, deferred. Flagged 2026-09-18.

## Resolved

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
