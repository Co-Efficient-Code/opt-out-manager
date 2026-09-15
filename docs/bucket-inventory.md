# Opt-Out Buckets — Inventory

_Snapshot: 2026-09-15, region us-east-1. AWS account 337462095720._

## Buckets & Roles

- **datadash-p2p** — SOURCE (pull). Vendors drop opt-outs here. 26 files.
- **datadash-bigdogstrategies** — DEST (push). 1 file.
- **datadash-creativedirect** — DEST (push). 3 files (1 manual/off-format).

## Path Structure

```
optouts/<org>/<filename>.csv
```

- Common prefix: `optouts/`
- One folder per org
- Filename (standard): `optouts_<org>_<YYYYMMDD>_<HHMMSS>.csv`

## Orgs seen

- maga-inc
- no-going-back-pac
- sag-pac
- strategic-majority-pac

## File Schema

**Standard (all auto-generated files):**
```
organization,phone
sag-pac,9179071810
```
- 2 cols: `organization`, `phone` (10-digit, no formatting)

**Non-standard (1 manual upload only):**
`creativedirect/optouts/strategic-majority-pac/Strategic Majority PAC - SMS Opt-Outs - 2026-09-11.csv`
```
Phone number,Text body,Opt Out Type,Organization
(201) 213-9986,STOP,Auto,Strategic Majority PAC
```
- 4 cols, different names/order, phone formatted `(xxx) xxx-xxxx`

---

## datadash-p2p (SOURCE)

```
optouts/
├── maga-inc/                 13 files  (2026-09-04 → 09-15)
├── no-going-back-pac/         8 files  (2026-09-08 → 09-15)
├── sag-pac/                   4 files  (2026-09-04 → 09-12)
└── strategic-majority-pac/    1 file   (2026-09-15)
```
- Cadence: mostly daily ~02:03 (nightly job)
- Sizes range 38 B → 56.7 MiB (sag-pac 09-04)

## datadash-bigdogstrategies (DEST)

```
optouts/
└── sag-pac/
    └── optouts_sag-pac_20260915_125300.csv   116.1 KiB
```
- Only sag-pac pushed so far

## datadash-creativedirect (DEST)

```
optouts/                                          (empty marker)
├── no-going-back-pac/
│   └── optouts_no-going-back-pac_20260915_155452.csv   317.7 KiB
└── strategic-majority-pac/
    ├── optouts_strategic-majority-pac_20260915_155452.csv    9.4 KiB   [standard]
    └── Strategic Majority PAC - SMS Opt-Outs - 2026-09-11.csv 184.4 KiB [NON-STANDARD]
```
- Has empty `0-byte` folder markers (`optouts/`, `.../no-going-back-pac/`, etc.)

---

## Flags / Things to Note

- **Org mismatch across buckets:** p2p has 4 orgs; bigdog has only sag-pac; cd has no-going-back + strategic-majority. Destinations are NOT simple mirrors of source.
- **One off-format file** in cd (different columns, formatted phones). Not from the auto pipeline.
- **Empty folder markers** exist in cd (0-byte keys ending in `/`).
- **Same path carries across buckets:** `optouts/<org>/<file>.csv` is identical shape in source and dests.
- **Filename timestamp differs from upload time** (e.g. `_125300` in name vs 09:42 upload) — name likely = source generation time.
