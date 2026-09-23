# Siege of Orgrimmar — SOO-Assigns-Import export grid format (reference)

> Context for what the assignment agents (`AssignmentGenerator` / `AssignmentRefiner`) and serializer
> (`renderSooAssigns` / `renderCountRows`) emit and validate.
>
> Source: The `SOO-Assigns-Import` tab of the guild's shared Google Sheets workbook ("AI BFFS SOO Assigns"),
> which feeds the in-game RAIDLEAD WeakAura pack (formerly referred to by legacy names like "Tot Assigns"
> or TotalAssignments). This document defines the 13-column export grid schema used by the pipeline's
> `assignments.csv` artifact.

## File / sheet shape

- **Header row** (row 2 of sheet): 13 columns (export grid)
- **One section per boss** (all 14 SoO bosses in sheet order), each containing two blocks:
  1. **HEALTH % block** — health-threshold trigger slots: 15 numbered template rows (`Health % (<abbr>)`, CD # 1..15) with the boss/NPC display name in the `NPC NAME` column on row 1, followed by a `LEAVE BLANK` separator row.
  2. **COUNT block** — the actual cooldown assignments, placed beneath the `COUNT` block header row.

## Columns (0-indexed)

| # | Header | Meaning | Notes |
|---|---|---|---|
| 0 | Player | Actual player name | Bound from role-name mappings; blank for group tags (`ALL`, `MELEEDPS`, `RANGEDDPS`, class tags) or unmapped roles |
| 1 | CD # | Cooldown slot number | Optional numeric index; mostly blank in data rows |
| 2 | BOSS HEALTH / SPELL | Event display name | From the closed canonical event vocabulary, suffixed with boss abbr where ambiguous (e.g. `Encounter Start (IMM)`, `Swelling Corruption`, `Reave`, `Death from Above (PAR)`) |
| 3 | COUNT / HEALTH % | Occurrence count | Single number (e.g. `1`), comma-list (e.g. `"1,4"`), or lone `-1` countdown/pre-event sentinel; trigger % in HEALTH % blocks |
| 4 | PLAYER/CLASS/ALL | Role tag | Abstract roster slot (e.g. `PROTPALA1`, `DISC1`, `ALL`, `MELEEDPS`, `TANKS`, `HEALERS`, class tags) |
| 5 | TIME | Timing offset (seconds) | Relative to event; negative allowed for pre-casts (`-20`..`-1`), `0`, or positive up to `450`; fractional allowed (`0.1`, `0.5`, `1.5`) |
| 6 | COOLDOWN SPELL | Assigned spell | One of 21 canonical spells, **or** the literal `Custom Spell Assignment` |
| 7 | (reserved) | Blank column | Blank in data rows; header cell carries copy-direction label |
| 8 | NPC NAME | Scaffold markers | Boss display name on row 1 of HEALTH % block, `LEAVE BLANK` on separator row; blank on assignment data rows |
| 9 | ADDITIONAL TEXT | Note/annotation | Optional text/instruction (e.g. `STACK`, `tank external`, `bop priest`, `Pop SLT`) |
| 10 | OVERRIDE TTS | Text-to-speech / Custom spell | Explicit TTS override for canonical spells; for custom assignments (`Custom Spell Assignment`), carries the real spell name (e.g. `Lay on Hands`, `Void Shift`, `Life Cocoon on tank`) per live sheet convention |
| 11 | CUSTOM NAME | (Unused) | Kept blank by convention in live sheet |
| 12 | CUSTOM ICON | Spell ID | Spell ID for custom assignments (e.g. `633`, `135739`, `538745`); blank for canonical spells or unknown IDs |

## Known canonical spells (COOLDOWN SPELL)

The live sheet recognizes 21 canonical cooldown spells:

```
Ancestral Guidance, Anti-Magic Zone, Bloodlust, Demoralizing Banner, Devotion Aura,
Guardian of Ancient Kings, Hand of Protection, Hand of Sacrifice, Healing Tide Totem,
Pain Suppression, Power Word: Barrier, Rallying Cry, Revival, Shield Wall, Smoke Bomb,
Spirit Link Totem, Spirit Shell, Stampeding Roar, Tranquility, Vampiric Embrace, Vigilance
```

Any spell outside this set is rendered as a **custom assignment**:
- `COOLDOWN SPELL`: Literal `"Custom Spell Assignment"`
- `OVERRIDE TTS`: The real spell name (or explicit TTS override)
- `CUSTOM ICON`: Numeric spell ID (if known)
- `CUSTOM NAME`: Kept blank

## Allowed role tags

- **Per-spec/rank**: `DISC1-3, HPALA1-2, CDSHA1-3, RSHAM1-2, SPRIEST1-2, BOOMIE1-2, DPSWARR1-3, PROTPALA1, PROTWARR1, UHDK1, FERAL1, FROSTDK1, HOLYPRIEST1, MISTWEAVE1, RETPALA1, ROGUE1-2, RDRUID1, SURVIVAL2, LOCK1-6`
- **Group tags**: `ALL, MELEEDPS, RANGEDDPS, TANKS, HEALERS`
- **Class tags**: `DEATHKNIGHT, DRUID, HUNTER, MAGE, MONK, PALADIN, PRIEST, ROGUE, SHAMAN, WARLOCK, WARRIOR`

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
vocabulary** — agent output and serializer input are validated against this list:

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

## Schema & Serializer Contract

The canonical `Assignment` schema (`src/shared/assignments-schema.ts`) is:

```ts
export const assignmentSchema = v.object({
  event: v.string(),
  occurrence: v.union([
    v.number(),
    v.pipe(
      v.string(),
      v.regex(/^-?\d+(?:\s*,\s*\d+)*$/, 'occurrence must be a number or comma-separated list of numbers'),
    ),
  ]),
  roleTag: v.string(),
  timingOffset: v.number(),
  spellName: v.string(),
  notes: v.optional(v.string(), ''),
  spellId: v.optional(v.string(), ''),
  tts: v.optional(v.string(), ''),
  cd: v.optional(v.number()),
});
```

The serializer (`renderSooAssigns`) validates every plan against the target boss's canonical event list and allowed role tags before generating the CSV. Validation failures are surfaced loudly with grouped errors and abort CSV creation.
