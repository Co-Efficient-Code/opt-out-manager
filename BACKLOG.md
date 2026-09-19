# Backlog - opt-out-manager

Known issues and deferred work. Newest at top. Keep this on `main`.

## Open

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

## Notes / non-issues (checked, no action needed)

- **Other 2 PAC tokens (maga-inc, strategic-majority-pac):** the name parser only auto-detects SAG and No Going Back. If a maga-inc or strategic-majority-pac project arrives with a name the parser cannot tag, it quarantines and flags in the nightly email; a human then assigns the PAC in the Run logs mapping UI (all four PACs are in the dropdown, validated by `PAC_SLUGS`, persisted to KV, override wins over parser). This is the designed safety net working as intended - same flow PA 01 already uses. Adding auto-detect tokens for those two PACs would be a convenience enhancement, not a defect fix.
- **Region:** buckets are us-east-1. If `docs/bucket-inventory.md` says us-east-2 anywhere, that doc is wrong and should be corrected.
