# Player cooldown data (mop_skills.json) — sources and caveats

`src/data/mop_skills.json` now carries a **duration** seconds per skill and
**cooldown** seconds verified against live Wowhead (Mists of Pandaria Classic),
cross-checked against real usage in a Siege of Orgrimmar kill (`RTF3CwNmBYQA97cz`
fight 45, Garrosh, 457s; same-player inter-cast gaps via the app's WCL service).

The assignment generator should use `cooldown` (and `duration`) when scheduling
so the same player is never assigned a spell that will still be on cooldown.

## Corrections applied (live Wowhead vs. previous values)

| Spell | old | new | note |
|---|---|---|---|
| Bloodlust (2825) | 600s | 300s | MoP Classic is 5 min, not 10 |
| Tranquility (740) | 180s | 480s | 8 min (MoP 5.4) |
| Hymn of Hope (64901) | 180s | 360s | 6 min |
| Ironbark (102342) | 90s | 60s | 1 min |

Everything else matched the Wowhead cooldown already.

## Usage anomalies seen in the log (worth knowing, not silent-fixed)

- **Hand of Sacrifice (6940)** — tooltip/DB cooldown is 120s, but both holy
  paladins cast it every ~30s in the Garrosh kill. Apparent cause: the MoP
  Classic **Absolve** talent path removes/swaps HoS's cooldown behavior (the
  Wowhead tooltip lists glyph/talent variants). The DB keeps the 120s baseline;
  a generator should not hard-gate HoS on 120s for paladins with Absolve.
- **Shield Wall (871)** — one warrior showed a 143s gap vs 180s tooltip; treat
  the tooltip value as authoritative unless classic charges are confirmed.
- **Anti-Magic Zone (51052)** — Wowhead Classic lists duration 3s (DB stored);
  verify in game if it models 5s.

## How to verify a cooldown from WCL

Query `Casts` for the spell's abilityID on a kill fight, group by source player,
and check the minimum inter-cast gap: it must be ≥ the cooldown (holding optional).
See the throwaway workflow used here: `/tmp/wcl_check_cd.mjs` (fetched via the
app's `getWCLService().executeQuery`).