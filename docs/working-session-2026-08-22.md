# Working session 2026-08-22: BLA/PAR reference reconciliation + WCL pull analysis

Status: findings captured. Improvements below are candidates for GitHub issues
(`bffs-wow/assignments`), filed per `docs/agents/issue-tracker.md`.

## Sources

| Source | Description |
| --- | --- |
| Reference kill set | Read-only sheet `1mfRwq54y-3AZO4JgmvYitW6JW83YsAPycwigZYswR8Y`, serialized payload cell `'SOO-Assigns-Import'!G1` (491 segments, all SOO bosses). Captured → `ref/ref-payload.txt`, parsed → `ref/ref-payload-parsed.json`. **DO NOT TOUCH the sheet.** |
| Live repo sheet | `1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms` (writable). Roster bindings at `'MoP-Data-Assigns'!F:G`. |
| WCL pull | `cBkxGRQCq4fKXYMv` fight 25 (Blackfuse, 0.85%, zone 1054 SoO). Boss cast timeline → `/tmp/wcl-bla25-timeline.json`. |

## What the real pull shows (fight 25)

| Ability | Count | Timing (s) |
| --- | --- | --- |
| Electrostatic Charge (tank debuff) | 27 | 0.9, 18.4, 34.6, ... 426.6 (~16s cadence) |
| Launch Sawblade | 27 | 12.3, 28.5, ... |
| Overload (Shredder burst AoE) | 11 | 41.2, 52.6, 63.9, 102.8, 162, 222, 281, 342, 402, 423, 434 |
| Protective Frenzy (tank external window) | 14 | 19.9, 64, 68.8, 114.6, 117.3, 142.9, 170.6, 185.1, 230.4, 232.1, 264.8, 284.5, 346.7, 348.3 |
| Overcharge | 13 | 46, 86, 126, 166, 205, 246, 286, 326, 366, 406 |
| Shockwave Missile | 5 | 333, 346, 359, 412.9, 426 |
| Death From Above | 2 | 59.2, 418.9 |
| **Magnetic Crush** | **0** | **never cast** |

## Confirmed problems

1. **Magnetic Crush is NOT cast on real kills.** The generator/dump aimed ~20 raid CDs
   at Magnetic Crush; the actual pull never triggers it. Raid CDs belong on
   **Overload** and **Protective Frenzy** (the events that actually deal damage).
2. **Shredder `-16s` calls invalid past the first.** Shredder spawn gaps are ~11s
   early (41→52→63s), then much larger. Only the 1st shredder supports a stable
   16s lead-in. Reference correctly only assigns shredder CDs at **occurrences 4 & 5**
   (`BLACKFUSE_SHREDDER/4/PROTPALA1/16`, `5/DISC1/16`).
3. **Roster drift between reference and live sheet.** Reference binds `DISC1=Marenjok,
   UHDK1=Emofive, BOOMIE1=Pwndruid, BOOMIE2=?, LOCK2=Miyokan`; live sheet binds
   `DISC1=unfilled, UHDK1=Zurrash, BOOMIE1=Shiftyz, BOOMIE2=Pwndruid, LOCK2=Sloptard`.
   Plans must re-resolve reference roles to the live roster (DISC* → HOLYPRIEST1, etc.).
4. **Occurrence `-1` is a real pre-event sentinel** in the reference
   (`PARAGONS_INSANE_CALCULATION/-1/SHAMAN`, `PARAGONS_INSANE_CALCULATION/-1/...`).
   Validator previously rejected it. **Fixed** in commit `bc52b83`
   (lone `-1` allowed; `-1,3` and other negatives still rejected).

## Deliverables produced this session

- `tonight/blackfuse-committed.json` (35 rows, pull-accurate cadence) + CSV.
- `tonight/paragons-committed.json` (61 rows, reference min-max structure) + CSV.
- `ref/ref-payload.txt`, `ref/ref-payload-parsed.json` (reference kill set capture).
- Validator: `src/serializer/validate.ts` accepts lone `-1` occurrence.
- Tests: 75/75 unit + 11/11 integration green.

## Candidate improvements (file as GitHub issues)

### A. Generator: source event cadence from the reference kill set / WCL
The generator should build BLA plans from the actual boss ability timeline (overload /
protective-frenzy / electrostatic), not from a hardcoded "Magnetic Crush dump" template.
Use the WCL service (`getEncounterEvents`) to validate event cadence before emitting.

### B. Generator: shredder pre-call only for the first shredder
Drop `-16s` on shredder occurrences > 1; use real spawn gaps.

### C. Role re-resolution helper
Reference kill set role tags (DISC1/2/3, CDSHA3, DPSWARR2/3, RSHAM2, BOOMIE2) must map
onto the live roster's bound roles. Add a `resolveToLiveRoster(roleTag)` helper + tests.

### D. Validator: pre-event sentinel `-1`
Done (`bc52b83`). Add release-gate docs note.

### E. Group-tag expansion
`GROUP_TAGS` expanded to the full sheet vocabulary (ALL/MELEEDPS/RANGEDDPS/TANKS/HEALERS
+ 12 class tags) so PRIEST-class Fear-Ward rows and RANGEDDPS/SHAMAN group rows validate.
Commit on `fix/generator-canonical-events`.