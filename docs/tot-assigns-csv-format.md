# Siege of Orgrimmar — "Tot Assigns" import format (reference)

> Context for what the assignment agents (`AssignmentGenerator` / `AssignmentRefiner`) should
> emit. Source: `C:\Users\seanm\Downloads\AI BFFS SOO Assigns - SOO-Assigns-Import.csv` (the
> Google Sheet we will sync to). This is the "Translated Tot Assigns" / TotalAssignments
> WeakAura import schema, not the app's legacy `assignments_output*.tsv` columns.

## File / sheet shape

- Header row (row 2 of sheet): 13 columns
- One section per boss (all 14 SoO bosses), each with two blocks:
  1. **HEALTH %** block — health-threshold trigger slots (template rows `,1,Health % (IMM)`,
     …, `,15,Health % (IMM)`). Unfilled in this sheet today; NPC/boss name lives in a spare
     column. Future: assignments keyed to boss health %.
  2. **COUNT** block — the actual cooldown assignments.

## Columns (0-indexed)

| # | Header | Meaning | Notes |
|---|---|---|---|
| 0 | Player | actual player name | blank when the trigger is `ALL` |
| 1 | CD # | cooldown slot number | rarely used (`1`); mostly blank |
| 2 | BOSS HEALTH / SPELL | event / boss ability name | boss-specific events suffixed with a boss abbr, e.g. `Encounter Start (IMM)`, `Swelling Corruption`, `Split`, `Reave`, `Adds CD (NAZ)` |
| 3 | COUNT / HEALTH % | occurrence count | also `"1,4"` style paired counts appear; in HEALTH% blocks this is the trigger % |
| 4 | PLAYER / CLASS / ALL | role tag | 42 distinct tags (see below) |
| 5 | TIME | seconds relative to the event | **negative allowed** (`-20`..`-1` = before), `0`, up to `450`; fractional `0.1`/`0.5`/`1.5` seen |
| 6 | COOLDOWN SPELL | assigned spell | 22 known spells, **or** literal `Custom Spell Assignment` (see cols 11/12) |
| 7/8 | (reserved, blank) | | |
| 9 | ADDITIONAL TEXT | note/annotation | e.g. `STACK`, `PERSONALS`, `Small Personal`, `Big Personal`, `Healthstone to top`, `Stun Adds`, `Grip Gloom`, `Fear Ward`, `Check boss mob alive` |
| 10 | OVERRIDE TTS | custom text-to-speech | populated on 136 rows |
| 11 | CUSTOM NAME | real spell for a custom assignment | when `COOLDOWN SPELL = "Custom Spell Assignment"` (e.g. `Lay on Hands`, `Void Shift`, `Healthstone`, `Personal`) |
| 12 | CUSTOM ICON | spell id | e.g. `537079` (Void Shift), `538745` (Healthstone) |

## Known canonical spells (COOLDOWN SPELL)

`Ancestral Guidance, Anti-Magic Zone, Bloodlust, Demoralizing Banner, Devotion Aura,
Guardian of Ancient Kings, Hand of Protection, Hand of Sacrifice, Healing Tide Totem,
Pain Suppression, Power Word: Barrier, Rallying Cry, Revival, Shield Wall, Smoke Bomb,
Spirit Link Totem, Spirit Shell, Stampeding Roar, Tranquility, Vampiric Embrace, Vigilance`

## Role tags observed (42)

- Per-spec/rank: `DISC1-3, HPALA1-2, CDSHA1-3, RSHAM1-2, SPRIEST1-2, BOOMIE1-2, DPSWARR1-3,
  PROTPALA1, PROTWARR1, UHDK1, FERAL1, FROSTDK1, HOLYPRIEST1, MISTWEAVE1, RETPALA1, ROGUE1-2,
  RDRUID1, SURVIVAL2, LOCK1-6`
- Generic class: `DRUID, SHAMAN, PRIEST`
- Group: `ALL, MELEEDPS, RANGEDDPS`

## Boss abbreviations (event-name suffix)

| Boss | Abbr | Boss | Abbr |
|---|---|---|---|
| Immerseus | IMM | General Nazgrim | NAZ |
| The Fallen Protectors | FAL | Malkorok | MAL |
| Norushen | NOR | Spoils of Pandaren | SPO |
| Sha of Pride | SHA | Thok the Bloodthirsty | THO |
| Galakras | GAL | Siegecrafter Blackfuse | BLA |
| Iron Juggernaut | JUG | Paragons of the Klaxxi | PAR |
| Kor'kron Dark Shaman | KOR | Garrosh Hellscream | GAR |

## Per-boss event vocabulary (canonical assignment list)

The complete set of valid `BOSS HEALTH / SPELL` values per encounter. This is a **closed
vocabulary** — agent output for a boss should come from (and be validated against) this list.
Kept verbatim from the sheet owner:

```
SOO_IMMERSEUS
Encounter Start (IMM)  Health % (IMM)  Corrosive Blast  Swirl  Swelling Corruption
Reform  Split  Sha Bolt

SOO_FALLEN
Encounter Start (FAL)  Health % (FAL)  Vengeful Strikes  Corrupted Brew  Clash
Defiled Ground  Inferno Strike  Gouge (FAL)  Garrote  Shadow Word: Bane  Calamity
Desperate Measures Rook  Desperate Measures He  Desperate Measures Sun  Mark of Anguish

SOO_NORUSHEN
Encounter Start (NOR)  Health % (NOR)  Unleashed Anger  Blind Hatred  Disheartening Laugh
Lingering Corruption  Titanic Smash  Piercing Corruption  Hurl Corruption  Manifestation
Self Doubt

SOO_SHAPRIDE
Encounter Start (SHA)  Health % (SHA)  Mark of Arrogance  Self-Reflection  Wounded Pride
Banishment  Corrupted Prison  Swelling Pride  Unleashed  Manifestation of Pride
Phase 2 Start (SHA)

SOO_GALAKRAS
Encounter Start (GAL)  Health % (GAL)  Shattering Cleave  Crusher's Call  Phase 2 Start (GAL)
Flames of Galakrond  Pulsing Flames  Adds CD (GAL)  Tower Grunt CD  Demolisher CD

SOO_JUGGERNAUT
Encounter Start (JUG)  Health % (JUG)  Assault Mode  Ignite Armor  Borer Drill  Crawler Mine
Ricochet  Deploy Siege Mode  Cutter Laser Target  Shock Pulse  Explosive Tar

SOO_KORKRON
Encounter Start (KOR)  Health % (KOR)  Toxic Mist  Foul Stream  Ashen Wall  Iron Tomb
Toxic Storm  Foul Geyser  Falling Ash  Iron Prison  Phase 1 Start (KOR)
Phase 2 Start (KOR)  Phase 3 Start (KOR)  Phase 4 Start (KOR)

SOO_NAZGRIM
Encounter Start (NAZ)  Health % (NAZ)  Sundering Blow  Execute  Bonecracker  Battle Stance
Berserker Stance  Defensive Stance  Heroic Shockwave  War Song  Ravager  Banner
Rage Ability  Adds CD (NAZ)

SOO_MALKOROK
Encounter Start (MAL)  Health % (MAL)  Blood Rage  Displaced Energy  Arcing Smash
Imploding Energy  Seismic Slam  Breath of Y'Shaarj  Expel Miasma

SOO_SPOILS
Encounter Start (SPO)  Health % (SPO)  Phase 2 Start (SPO)  Set to Blow  Matter Scramble
Crimson Reconstitution  Mantid Swarm  Residue  Windstorm  Rage of the Empress
Gusting Bomb  Gusting Crane Kick  Path of Blossoms  Return to Stone

SOO_THOK
Encounter Start (THO)  Health % (THO)  Deafening Screech 1  Blood Frenzy  Acid Breath
Freezing Breath  Scorching Breath  Burning Blood  Fearsome Roar  Phase 1 Akolik
Phase 1 Gorai  Phase 1 Montak  Phase 2 Start (THO)  Deafening Screech 2  Deafening Screech 3
Deafening Screech 4  Yeti  Bats

SOO_BLACKFUSE
Encounter Start (BLA)  Health % (BLA)  Protective Frenzy  Electrostatic Charge  Launch Sawblade
Shredder  Mines  Death From Above (BLA)  Assembly Line CD  Magnetic Crush
Shockwave Missile  Overcharge Mine  Overcharge Missile  Overcharge Turret
Overcharge Electro  Overcharge Laser  Overload 1..10

SOO_PARAGONS
Encounter Start (PAR)  Health % (PAR)  Kil'ruk  Gouge (PAR)  Reave  Death from Above (PAR)
Xaril  Toxic Catalyst CD  Toxic Injection  Kaz'tik  Mesmerize  Korven  Shield Bash
Encase in Amber  Iyyokuk  Insane Calculation: Fiery Edge  Ka'roz  Whirling  Hurl Amber
Skeer  Bloodletting  Rik'kal  Mutate  Injection  Hisek  Aim  Rapid Fire

SOO_GARROSH
Encounter Start (GAR)  Health % (GAR)  Desecrate P1  Desecrate P2  Desecrate P3
Hellscream's Warsong  Warbringers  Farseer Wolf Rider CD  Siege Engineer CD
Power Iron Star  Enter Realm of Y'Shaarj  Y'Shaarj's Protection  Whirling Corruption P2
Whirling Corruption P3  Touch of Y'Shaarj P2  Touch of Y'Shaarj P3  Malice
Call Bombardment  Clump Check  Fixate  Intermission  Phase 2 Start  Phase 3 Start
Phase 4 Start  Annihilate 1  Annihilate 2  Annihilate 3  Manifest Rage
```

Observations:
- The vocabulary is broader than the current sheet — many events are valid but not yet assigned
  (e.g. `Corrosive Blast`, `Sha Bolt`, `Sundering Blow`, `Breath of Y'Shaarj`, `Set to Blow`).
- Ambiguous names carry a boss suffix: `Encounter Start (X)`, `Health % (X)`, `Gouge (FAL/PAR)`,
  `Death From Above (BLA)` / `Death from Above (PAR)` (note: case differs in the source).
- Some labels are heuristic, not raw timeline abilities: `Split`, `Adds CD (X)`, `Clump Check`,
  `Fixate`, `Intermission`, `Rage Ability`, `Banner`, `Overload 1..10`, `Deafening Screech 1..4`.

## Implications for agent output (proposed contract)

The current Valibot `assignmentSchema` is `{ event, occurrence, roleTag, timingOffset,
spellName, notes, spellId }`. To map cleanly onto this sheet later, extend it with the fields
the sheet actually carries, and let the agent populate them:

```ts
const assignmentSchema = v.object({
  event: v.string(),            // -> BOSS HEALTH / SPELL (boss-abbr suffix added by the caller)
  occurrence: v.number(),       // -> COUNT
  roleTag: v.string(),          // -> PLAYER/CLASS/ALL
  timingOffset: v.number(),     // -> TIME (allow negatives/fractional)
  spellName: v.string(),        // -> COOLDOWN SPELL, or the real spell when custom
  notes: v.string(),            // -> ADDITIONAL TEXT
  spellId: v.string(),          // -> CUSTOM ICON
  customName: v.optional(v.string()),   // -> CUSTOM NAME (when custom assignment)
  tts: v.optional(v.string()),          // -> OVERRIDE TTS
  player: v.optional(v.string()),       // -> Player (resolved from roleMappings by the caller)
});
```

3. The **event** field is validate against the per-boss vocabulary above: use a per-boss Valibot
   `v.picklist(...)` (the strictest option) or a post-hoc check that rejects/differs off-list
   events. The agent currently fabricates event names from the live timeline; prefer
   canonical vocabulary names where they exist (e.g. emit `Calamity` / `Reave`, not a raw
   timeline paraphrase). The caller decides the boss mapping and adds the abbreviation suffix.

Decisions for the Sheets thread: whether the agent should emit `customName`+`spellId` itself vs.
the caller canonicalizing "spellName not in the canonical list" into a `Custom Spell Assignment`
row; whether `timingOffset` stays integer-only or allows the sheet's fractional/negative values;
and where the boss-abbreviation suffix and the HEALTH% blocks are applied (caller, not agent).
