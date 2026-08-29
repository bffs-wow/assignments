# SOO encounter spell database — source notes

`src/data/soo-spells.json` cross-references the baked event vocabulary
(`src/data/soo-encounters.json`) with the real spells behind it, for every
Siege of Orgrimmar boss.

## Content

Per boss, every enemy ability observed as a cast in one full clear of Siege of
Orgrimmar (report `RTF3CwNmBYQA97cz`, kill fights; fetched through the app's own
WCL service, `getWCLService().executeQuery`):

- **spellId** — the WCL ability gameID (same id space as Wowhead).
- **name** — WCL's ability name.
- **event** — the sheet's vocabulary display name when the ability maps to one
  (curated; aggregates like `Deafening Screech 1..4`, `Overload 1..10`,
  `Annihilate 1..3` collapse several vocabulary entries).
- **wowheadUrl** — `https://www.wowhead.com/mop-classic/spell=<id>`.
- **description** — short description from the **live** Wowhead page
  (`wowhead.com/mop-classic/spell=<id>`, Mists of Pandaria Classic data),
  falling back to Internet Archive snapshots when the live page misses. Full
  coverage: 219 of 219 entries.
- **cadence** — real inter-cast gaps (seconds) from the kill: `casts`,
  `firstSec`/`lastSec` (relative to pull), and `gapMinSec`/`gapMedSec`/
  `gapMaxSec`. A single sample — treat min/max as indicative, not a guarantee.

## Fetching Wowhead programmatically

The live site fingerprint-blocks certain user agents (a Windows-Chrome UA gets
HTTP 403 from CloudFront). A Linux-Firefox UA works — use that for scrapes.

## What the log did not show

Several vocabulary events had no casts in this kill — either they are markers
(Health %, Phase/Encounter Start), paragon *actor* labels (Kil'ruk, Xaril, …),
or abilities this particular kill never triggered (e.g. most of Iron
Juggernaut's repertoire, `War Song`/`Banner`, `Magnetic Crush`, Immerseus's
`Swelling Corruption`, which is a debuff applied to attackers, not a boss
cast). Absence here does not mean the event is invalid; the vocabulary remains
the authoritative list.

## Refreshing

1. Fetch enemy casts per kill fight (see `getEncounterEvents` in
   `src/services/wcl.ts`).
2. Re-resolve descriptions from `https://www.wowhead.com/mop-classic/spell=<id>`
   (Firefox UA; archive snapshots of `wowhead.com/spell=<id>` as fallback).
3. Rebuild `src/data/soo-spells.json` in the same shape; update `source.fetchedAt`.