# R1 — SOO-Assigns-Import live geometry + per-boss COUNT capacities

> Research ticket #20. Authoritative layout of the test raid sheet's
> **SOO-Assigns-Import** tab, captured 2026-09-01 from the live workbook
> ("AI BFFS SOO Assigns", spreadsheet id `GOOGLE_SHEET_ID`, tab sheetId
> `1945140668`) via the authenticated Sheets values API
> (`scripts/r1-dump-sheet.mjs`, full `A1:O1068` dump). The numbers below are
> the ground truth the writer tickets (B2/B3) and the paste gate (#16) consume.

## Tab geometry

| Property | Value |
|---|---|
| Tab title | `SOO-Assigns-Import` |
| sheetId | `1945140668` |
| Grid | 1068 rows × 15 columns |
| Frozen rows | 2 |

The tab is a 15-column grid (A..O). Columns N and O are unused by any content
(present but always blank) — the 13-column export grid maps to A..M. There are
**no merged cells** anywhere in the tab.

## Row 1 and 2 — the frozen top

- **Row 1** — the WeakAura import box: a single 28KB `*`-separated encoded
  payload in cell G1, with the literal label `<- COPY THIS BOX AFTER EXPORTING
  TOT ASSIGNS` in H1. **Never read-modify-written.**
- **Row 2** — the 13-column header (`Player`, `CD #`, `BOSS HEALTH / SPELL`,
  `COUNT / HEALTH %`, `PLAYER/CLASS/ALL`, `TIME`, `COOLDOWN SPELL`, blank,
  `NPC NAME`, `ADDITIONAL TEXT`, `OVERRIDE TTS`, `CUSTOM NAME`, `CUSTOM ICON`).
  `PLAYER/CLASS/ALL` is a two-line wrapped label (no merge).

## Per-boss sections (all 14 bosses, sheet order)

Each boss owns one contiguous section built from five parts, repeated
identically down the tab:

```
<HEALTH header row>          B = sheetName   D = "HEALTH %"   I = "NPC NAME"
15 × HEALTH template rows    B = 1..15       C = "Health % (ABBR)"   I = NPC name(s) (some bosses)
<COUNT header row>           B = sheetName   D = "COUNT"      I = "LEAVE BLANK"
COUNT data region            rows between the COUNT header and the next boss's HEALTH header
```

- The **HEALTH % block** is exactly **15 rows** for every boss, keyed on
  `Health % (<ABBR>)` in C, numbered 1..15 in B. Filled for only a few bosses
  (see NPC NAME below); never written by the pipeline.
- The **COUNT header row** carries `sheetName` in B, literal `COUNT` in D, and
  literal `LEAVE BLANK` in I. (This supersedes the earlier handoff note that
  the sheet lacked literal `COUNT` headers — they are present in column D on
  the section header row.)
- The **COUNT data region** is the app's only write surface for that boss.

## Per-boss COUNT capacities (baked constants)

Capacity = rows between the COUNT header row (exclusive) and the next boss's
HEALTH header row (exclusive), or the tab's last row for the final boss. These
are **static within a tier** (the sheet is frozen); no runtime scan. Column B
of the COUNT header row is the locator key (`sheetName`), which must equal the
baked `sheetName` from `src/data/soo-encounters.json`.

| Boss (sheetName) | COUNT header row | Data rows (inclusive..exclusive) | Capacity |
|---|---|---|---|
| IMMERSEUS | 19 | 20 .. 74 | 54 |
| THE FALLEN PROTECTORS | 90 | 91 .. 143 | 52 |
| NORUSHEN | 159 | 160 .. 209 | 49 |
| SHA OF PRIDE | 225 | 226 .. 280 | 54 |
| GALAKRAS | 296 | 297 .. 348 | 51 |
| IRON JUGGERNAUT | 364 | 365 .. 416 | 51 |
| KOR'KRON DARK SHAMAN | 432 | 433 .. 484 | 51 |
| GENERAL NAZGRIM | 500 | 501 .. 552 | 51 |
| MALKOROK | 568 | 569 .. 620 | 51 |
| SPOILS OF PANDAREN | 636 | 637 .. 688 | 51 |
| THOK THE BLOODTHIRSTY | 704 | 705 .. 769 | 64 |
| SIEGECRAFTER BLACKFUSE | 785 | 786 .. 837 | 51 |
| PARAGONS OF THE KLAXXI | 853 | 854 .. 928 | 74 |
| GARROSH HELLSCREAM | 944 | 945 .. 1067 | 122 |

Header rows are 1-based sheet rows. Data region indices are 1-based inclusive
of the first data row and exclusive of the end.

**Robust locator (survives edits):** the section boundary is defined by
"a row whose B-column value equals the baked `sheetName` **and** whose D-column
value is exactly `HEALTH %` or `COUNT`". No fixed row indices — a human adding
a data row (as they have: e.g. a stray row inside SPOILS) shifts nothing, as
long as the header rows stay intact.

## Column semantics (observed rows)

| Col | Header | Content in data rows |
|---|---|---|
| A | Player | **Explicit player names on some rows** (e.g. `Applepi`, `Hexdaddy`, `Crànker`, `Money`); blank where the row's role is `ALL` or a group tag. The serializer leaves Player blank (auto-resolved by the sheet's role-name bindings); the live sheet carries names on individual rows — this is a paste-gate reconciliation item, not a write dependency. |
| B | CD # | Mostly blank; `1` sometimes. |
| C | BOSS HEALTH / SPELL | The event display name (verbatim vocabulary). |
| D | COUNT / HEALTH % | Single count or comma list (`1,4`), or the health trigger in HEALTH blocks. |
| E | PLAYER/CLASS/ALL | The role tag (`DISC1`, `ALL`, `MELEEDPS`, …). |
| F | TIME | Signed seconds; fractional (`0.1`, `1.5`) and negative (pre-trigger) values observed. |
| G | COOLDOWN SPELL | Canonical spell name, or literal `Custom Spell Assignment`. |
| H | (blank) | Always blank in data rows. |
| I | NPC NAME | Scaffold label on header rows (`NPC NAME` / `LEAVE BLANK`); data rows blank. |
| J | ADDITIONAL TEXT | Note text (e.g. `Check boss mob alive`, `STACK`). |
| K | OVERRIDE TTS | Custom row real spell name / TTS; also carries notes text on custom rows (e.g. `Do not use 3 min CD`). |
| L | CUSTOM NAME | Unused in practice (blank). |
| M | CUSTOM ICON | Spell id (e.g. `537079`, `538745`). |

## Header-spelling reconciliation vs the baked catalog

All 14 section sheetNames in the live tab match `src/data/soo-encounters.json`
`sheetName` values **exactly** (verified `SPOILS OF PANDAREN` ↔ WCL "Spoils of
Pandaria" discrepancy, `KOR'KRON DARK SHAMAN`, `THOK THE BLOODTHIRSTY`,
`PARAGONS OF THE KLAXXI`, etc.). No baked catalog entry needs updating for R1.

## Notes for B2/B3 and the paste gate

- B2's read-back backup should capture the COUNT data region only (the rows
  identified above), preserving blank rows; a timestamped CSV per boss lands in
  `backups/` (gitignored).
- B3's clear+replace targets the same region; capacity is the baked constant
  above (never a runtime scan).
- The renderer (`renderSooAssigns`) and the live sheet differ in **two
  structural ways** to reconcile at the paste gate (#16): (1) the renderer's
  per-boss scaffold emits 15 HEALTH rows + LEAVE BLANK + COUNT header directly,
  while the live sheet additionally places an **HEALTH header row** (B=sheetName,
  D=`HEALTH %`, I=`NPC NAME`) above those 15 rows; (2) the renderer's COUNT
  header row sets only D=`COUNT`, while the live sheet also sets B=sheetName and
  I=`LEAVE BLANK`. The writer must therefore **locate regions from the live
  sheet's header rows**, not from the renderer's CSV, and the paste gate should
  compare writer output to the live-sheet structure (the renderer's CSV is the
  artifact for the operator's paste, not the region map).