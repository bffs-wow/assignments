# R1 — wow:forever in-game addon policy and the Fojji/TotAssignments model

**Ticket:** [R1 — Research: wow:forever in-game addon policy and WeakAura in-combat restrictions](https://github.com/bffs-wow/assignments/issues/48) · **Map:** [#47](https://github.com/bffs-wow/assignments/issues/47) (gates G1 #50)
**Status:** research → findings · **Date:** 2026-09-23

---

## TL;DR

- **wow:forever is not a sandbox**: it runs on the same "Midnight-era" retail client codebase (interface 16001) and shares the retail addon/API restrictions wholesale. Blizzard confirmed this repeatedly; the wow:forever design team (Tim Jones, Mike Nuthals) said at BlizzCon they are *bringing over the retail in-combat restrictions*.
- **The retail (Midnight) policy kills exactly the Fojji/TotAssignments model's active surface.** The three pillars — assignment callouts (chat/TTS), boss-state-driven icon alerts, and raid-mark coordination — are what the changes target:
  - Real-time combat state ("secret values") is a black box: addons can *display* it but cannot *read/compute* on it. Anything that fires on "boss at X %, Y soaks" cannot exist.
  - Automated outbound chat (the WA pack's callout channel, and the Liquid-style chat-sync trick) is throttled in encounters by the live macro/chat rules.
  - Custom TTS on combat state is not available; the only TTS left is Blizzard's own accessibility TTS (health/resources/target-name events), not arbitrary assignment callouts.
  - Raid-mark setting is restricted (macro raids-marker throttle); the WA platform that drew overlays is unmaintained on this API.
- **WeakAuras itself is dead on this client.** The WeakAuras2 team hard-disabled the addon on Midnight (build ≥ 12.0) with an in-game shutdown gate, citing the API. Mainline was later reverted to working-without-combat-support, but the team still refuses to maintain the combat API. It survives only as unofficial forks (e.g. ForeverAuras for wow:forever, Anoniomouse/WeakAuras2, "WeakAuras2-for-Midnight"), which work outside instanced combat.
- **Consequence for the redesign: the on-screen-grid-survival question resolves to NO.** A live in-combat WeakAura reading the import box cannot survive on wow:forever — the platform is dead and the inputs it would need (in-combat state) are black-boxed. The output surface is off-screen: the per-tier Google Sheet read live on a second monitor (the map issue's standing preference), plus printed/memorized. The import-box-zone of the project (SOO-Assigns-Import tab, RAIDLEAD WA pack) is a SoO-era artifact, as the map already suspected.
- **One caveat to track:** the retail API situation is *unstable*. Blizzard launched Midnight maximally strict, then loosened ("reverted a large number of API restrictions") during beta and again in 12.1. If they keep walking back restrictions, a reduced read-only grid could eventually become legal again. That is a "re-check before committing" item, not a design premise.

---

## 1. Terminology and terrain

- **Midnight** = the current retail expansion (12.0), launched spring 2026 after an alpha/beta during fall 2025. It is the client platform this policy exists on.
- **wow:forever** (Blizzard official: "WoW Forever" / "World of Warcraft: Forever") = the new evergreen legacy mode launching ~November 2026, announced at BlizzCon; Wowhead tags it `newsTypeName: Forever`. Runs the modern Midnight-era client (TOC "interface 16001" — see SavedVariables repro report naming `Interface: 16001, 11509`), with classic-vanilla-style content. In beta since August 2026 (client `1.60.1 Build 69977` / build `69913`).
- **"The Great Addon Purge" / "addon disarmament"** = the community name for Blizzard's Midnight addon-API overhaul. Preceded by one year of negotiation (2025): restriction-by-restriction removals such as the classic `SetRaidTarget` protected-function limits.

**Sources**
- Blizzard official policy articles (primary): "Combat Philosophy and Addon Disarmament in Midnight" (Blizzard, Ion Hazzikostas, 2025-11-13, https://worldofwarcraft.com/en-us/news/24246290, forum mirror https://us.forums.blizzard.com/en/wow/t/combat-philosophy-and-addon-disarmament-in-midnight/2199207) and its predecessor "How Midnight's Upcoming Game Changes Will Impact Combat Addons" (https://worldofwarcraft.com/en-us/news/24244638, forum thread https://us.forums.blizzard.com/en/wow/t/how-midnights-upcoming-game-changes-will-impact-combat-addons/2189426).
- wow:forever running the same client: forum thread "WoW Forever will share the addon and API restrictions of retail" (2026-09-16, https://us.forums.blizzard.com/en/wow/t/2350682); "PSA on how addons will work for 4ever!" quoting MSUF author Mapko — "Midnight and Forever share the same codebase" (https://us.forums.blizzard.com/en/wow/t/2351479); "Can confirm Forever is actually Retail Minus" (https://us.forums.blizzard.com/en/wow/t/2355794).
- wow:forever inherits the restrictions deliberately, per BlizzCon interview (Kotaku, relayed in https://us.forums.blizzard.com/en/wow/t/addons-weakauras-restricted/2350657): lead Classic designer **Tim Jones** and lead encounter designer **Mike Nuthals** — "they will bring over the in-combat restrictions so players will not have access to computational addons that automate marking or communication during fights".

---

## 2. What the retail client actually removes mid-combat (API level)

The policy's own words (Hazzikostas, 24246290):
> "The guiding philosophy … Addons should no longer offer a competitive advantage in WoW combat. They should remain as robust tools for aesthetic customization and personalized presentation of information, but they should not be able to make a player more likely to succeed in combat."

Mechanism = the **"secret value" black box**:
> "Information about the current combat state is designated as a 'secret value' that can be displayed by addons, but not 'known' by them. In essence, combat events are in a black box; addons can change the size or shape of the box, and they can paint it a different color, but what they can't do is look inside the box… But they can't 'know' with certainty whether you or your target have a specific debuff currently active, or what the cooldown of a given ability is."

Companion article (24244638):
> "If the UI displays a piece of combat information, addons will, in most cases, be able to present that information to you in a different way. However, addons will no longer be able to use that combat information to drive custom logic or make decisions for you."

Concrete symptom observed by addon devs (thread 2243547 "Development clarification: Maintaining UI accuracy vs. 'Secret Value' obfuscation in Midnight", https://us.forums.blizzard.com/en/wow/t/2243547):
```
AddOnName.lua:31: attempt to compare local 'percent' (a secret value)
```
— i.e. reading `UnitHealth`/`UnitHealthMax` on bosses returns a value that cannot be compared, assigned, or math'd on. The thread confirms this is the intended state for all "protected" combat units, and asks (unanswered except by a wiki link) whether *any* sanctioned read path exists for view-only use. ADDON_ACTION_FORBIDDEN / taint cascades still fire when addons try to backfill from combat-log reconstruction.

**What survived the purge** (devs' own summaries, cross-checked in #2215896 "New API changes announced in WoW UI Discord", #2243547, #2184210 "Updates on what we know so far about the Great Addon Purge of 2026", #2190711):
- Addons may still **present** information the base UI presents: raid frames, nameplates, action bars, unit-frame reskinning; custom *display* of the new Boss Warning timeline; class power/resource values (Blizzard made "all class secondary resources fully non-secret").
- Blizzard is building native replacements: interactive click-casting with macro hooks (visible in wow:forever client), a **Cooldown Manager (CDM)** with "no macros, no custom anything, no trinkets" per #2184627 ("What is the actual point of the CD Manager?"), boss timeline, and a restricted accessibility **TTS**.
- Blizzard walked back *some* restrictions as they went: beta loosening ("revert[ing] a large number of API restrictions", #2215896), overabsorb-value reading restored for raid-frame addons, damage-meter hooks debated (#2323036 "Request for a Player-Only Damage Event API").

**What stayed dead**:
- Real-time **combat-event computation** (buffs/debuffs/cooldown math on boss state). "damage meters… boss ability timers… tools that make the game accessible" are acknowledged casualties, to be replaced by native UI.
- **Custom TTS/sounds on combat state**. Blizzard's TTS is "for various important combat events," listed examples: "announce when combat begins and ends, …your health and resources at regular intervals, …when you gain or lose a secondary resource (e.g., combo points), …your target's name and health" (24244638). No API for arbitrary assignment text. Community summary (2336977 "Message to Devs - Addon War"): "Custom sounds and text-to-speech triggers no longer work for many protected combat states."
- **Auto-outbound chat in encounters.** Official live patch: "Macro Changes Now Live: Target Markers and Chat Messages" (Linxy/Blizzard, 2026-03-01, https://us.forums.blizzard.com/en/wow/t/2261956):
  1. Macros may not set a target marker on more than 3 units within a very short time.
  2. In an active encounter: macros cannot send chat to non-group-exclusive channels (custom channels, guild, communities).
  3. Group channels (/raid, /party, /rw…) still allowed but rate-throttled ("prevented from sending multiple messages … within a very short time"), and only if the whole group is inside the instance.
  4. Whispers allowed but target must also be in the instance; also throttled.
- **Raid-marker automation.** The 3-unit macro cap plus protected `SetRaidTarget` history; addons can no longer auto-mark assignment targets at combat speed. (This is the "automate marking" half of the Nuthals quote in §1.)

---

## 3. WeakAuras (WeakAuras2) state on this client

**Current addon on main branch (2026-09-21):** retail flavor detection is `IsRetail()` on `flavor == 10`; there is **no** Midnight secret-value handling. The Midnight shutdown gate that briefly existed in main has been reverted.

History (WeakAuras2 GitHub, primary):
- 2026-01-09: issue #6126 "Add a warning to the WeakAuras window about Midnight".
- 2026-01-28: PR/issue #6143 "Update for Midnight compatibility" (community attempt wrapping secret-value reads, adding a restriction-state load option) — **rejected** by Stanzilla/InfusOnWoW: "We have no interest in maintaining that jank", "we had decided to not maintain WA for Midnight." Team invites forks instead: "WA is open source, you can absolutely fork WA and maintain a midnight compatible version… we'd ask you to rename it."
- Commit `4bade526` "Midnight: Disable WeakAuras with an message" (Jan 2026): adds `WeakAuras.IsMidnight() = BuildInfo >= 120000`, then
  ```lua
  if WeakAuras.IsMidnight() then
    C_Timer.After(1, function()
      WeakAuras.prettyPrint("WeakAuras does not support Midnight due to Blizzard restricting addons...")
    end)
    libsAreOk = false   -- shutdown gate
  end
  ```
  → on Midnight/WoWF, WeakAuras printed the message and refused to load at all.
- 2026-08-30: PR #6301 fresh revert ("remove Midnight warnings and disable gate") merged into main. wipes the warning, the options banner, `WeakAuras.IsMidnight()`, and the `libsAreOk = false` gate. It explicitly keeps a later Wrath warning untouched. Net: mainline WeakAuras can *load* on the modern client again but still has zero secret-value support (i.e. no combat triggers), and the maintainers still decline to build it.
- Current open dev workstreams (#6317, #6316 etc.) are Classic-Era/Cata/Mists fixes + timer internals — no Midnight roadmap.

**Restricted-zone / combat-state rules in WeakAuras itself** (from the code and its fork lineage): auras are trigger/load-condition-driven; auras gated on combat-state secrets simply never fire under the Midnight API. The Midnight forks are explicit about which pillars survive:
- **ForeverAuras** (Tulkas22, pushed 2026-09-23 — the wow:forever-targeted fork, default branch `forever`): "keeps the parts of WeakAuras that can still work (**regions, textures, animations, groups, the options UI, import/export, and out-of-combat triggers**) and removes or reworks the parts that can't." Status "early development. **Expect errors, especially in combat**." Import strings compatible for out-of-combat triggers.
- **Anoniomouse/WeakAuras2**: "updated for Midnight. **Currently works outside of instanced combat**" — features list shows `combat events` struck through.
- **WeakAuras2-for-Midnight** forks (BuloZB push 2026-07-20, Djiro0, TheQuibbler, Xineyu123): same claim — works outside instanced combat.

**So "WeakAura banned?" — no. WeakAura as a platform is dead because it refuses the new API — yes.** The difference matters for forecasting: the platform is survivable via fork (ForeverAuras), but a fork still cannot resurrect combat-state triggers because *the underlying API data is black-boxed* (§2). User-facing state on wow:forever per the forums: "Nope. The platform that all auras are built on is being shut down" (#2224792), "weak aurA's… out, as the dev won't update it" (#2350001), and "Your custom sounds and text-to-speech triggers no longer work for many protected combat states" (#2336977).

---

## 4. Retail terrain vs. what the current pipeline assumes

The current pipeline (CONTEXT.md) assumes an in-game consumer: a RAIDLEAD WeakAura pack reading the `SOO-Assigns-Import` import box (cell G1) and driving the Fojji/TotAssignments-style model — per-boss **callouts**, **OVERRIDE TTS**, **CUSTOM ICON** alerts, and raid-mark overlays.

Per-element outcome on wow:forever:

| Present-pipeline element | wow:forever status | Why (primary source) |
|---|---|---|
| Live on-screen assignment grid (read-only sheet data via WA) | Dead at combat time; runs out-of-combat only | WA mainline refuses the API; forks work "outside instanced combat" only; combat-state triggers impossible (§2, §3) |
| Callout / announcement on combat trigger | Dead | Secret-value black box on boss state; encounter chat throttling (2261956) |
| OVERRIDE TTS (custom per-assignment voice) | Dead | No API for arbitrary combat TTS; only Blizzard accessibility TTS (24244638; #2336977) |
| CUSTOM ICON alerts driven by combat state | Dead | Icon *display* allowed but state to trigger it is secret; platform unmaintained (#6143, 24244638) |
| Raid-mark overlays / auto-marking | Dead | Raid-marker macro cap 3/very-short-time; idea "automate marking" explicitly named by Nuthals (2350657) |
| Sheet/import-box architecture (off-screen source of truth) | Survives as *documentation*, not a runtime feed | Sheets are outside the client; nothing in the policy touches them |
| Out-of-combat WA use (pre-pull map, mouseover info, out-of-combat triggers) | Survives via forks | ForeverAuras etc. (§3) |

vs. the map's working premise (#47): "no in-game WeakAura dependency; a per-tier Google Sheet written directly by the tool; raiders open it live on a second monitor during pulls." The research confirms that premise is the *only* live surface left — and that #50's G1 tension (column sets legible in a mid-pull glance) is the real design constraint that replaces the WA output.

---

## 5. What raiders/guilds actually do on retail now (and for wow:forever)

**Top-end retail guilds (RWF):** private, guild-written addons working inside the *allowed* surface, plus chat-sync back-channels. Liquid's L'ura memory-game assist "sends and receives messages using chat to update, in real time, to every member of the raid, the position where they should go" — Blizzard acknowledged it was within rules (wowhead #381097 "Positioning Addons Make L'ura's Memory Game Much Easier in the Race to World First"). Community crypto conclusion: the purge killed *public* WeakAura distribution, not private computation smuggled through allowed APIs (#2285445). Note the macro-chat throttling (2261956) directly targets this trick — it landed in March 2026, between the beta and 12.1.

**General population:** Blizzard-native tools replaced the fight-coordination ones — Boss Warning timeline, Cooldown Manager, click-cast, edit mode, three raid-frame layouts with dispel/major-defensive emphasis (24244638, #2184627, #2224165). UI reskin ecosystem survived via rewrite: ElvUI (12.0 release, cross-version, with restricted features removed even on non-retail versions — #2231437), EllesmereUI ("de-throned ElvUI… announced he will be supporting Forever", #2350001), Plater "has a Midnight friendly version… nowhere near the same functionality" (#2224792). Assignment coordination specifically: no surviving public framework; guilds coordinate via voice + base-UI markers + sheets secondary-monitor, which matches the map's redesign direction. Accessibility groups lost the most: "visual assignments and automatic text announcements that replaced spoken raid calls" are gone (#2336977).

**wow:forever guilds (beta, Sep 2026):** recruiting threads emphasize voice + UI/edit-mode, not addon packs; healers report the client's native click-cast/healer-assist as the expected baseline ("with the removal of addons from this classic client, the default system shouldn't feel like a downgrade from tools like HealBot" — #2355387; counterpoint "Addons weren't removed for Forever. It's following the same ruleset as retail … Give the addon authors time."). No guild on wow:forever is running a Fojji/TotAssignments-style in-game pack — nothing to run it on.

---

## 6. Verdict for the ticket

- **Fojji model on wow:forever: dead, not reduced.** Callouts, custom TTS, combat-state icons, and raid-mark coordination are individually removed; the WeakAura platform carrying them is unmaintained on this API. A "WeakAura reading the sheet" survives only as an out-of-combat display (pre-pull reference), not as an "audio + popups" coordinator.
- **Informational read-only grids: not a legal category on this client.** The client only distinguishes *display-of-what-the-UI-already-shows* (allowed) from *computation* (blocked). A rule-driven assignment grid driven by combat state computes → blocked. A static pre-pull reference card (no combat state) is merely presentation → would be legal, but the platform to run the current pack on is gone regardless.
- **Design recommendation for the map:** the output surface is off-screen — per-tier Google Sheet on a second monitor (already the map's standing preference), printed, memorized. Keep the analysis lane (WCL, roster mapping, canonical vocabulary) fully; drop the import-box/RAIDLEAD-pack lane as a SoO-era artifact (map already ruled this out-of-scope). The one live, defensible in-client surface is *static* pre-pull reference data via a fork (ForeverAuras) driven by manual/out-of-combat triggers — a v1.1+ option, not a dependency.
- **Re-check trigger:** Blizzard has shown willingness to loosen (beta reverts, 12.1 overabsorb readdition, 12.1 "gigabuffed" fights that forced policy loosening per #2313062). If the secret-value rulebook keeps eroding, re-evaluate "combat-state grid" legality before each retail tier. Until then, do not design around it.

---

## Primary-source index

| # | Source | Type | Used for |
|---|---|---|---|
| 1 | Blizzard, "Combat Philosophy and Addon Disarmament in Midnight" — worldofwarcraft.com/en-us/news/24246290 (forum 2199207) | Official blue article | Philosophy; secret-value black box; enabling/replacement work |
| 2 | Blizzard, "How Midnight's Upcoming Game Changes Will Impact Combat Addons" — worldofwarcraft.com/en-us/news/24244638 (forum 2189426) | Official blue article | Display vs. compute rule; TTS accessibility scope; raid frames |
| 3 | Linxy, "Macro Changes Now Live: Target Markers and Chat Messages" — forum 2261956 | Official blue post | Encounter chat throttling; raid-marker macro cap; whisper rules |
| 4 | WeakAuras2 GitHub: commit 4bade526 (disable gate), PR/issue #6143 (rejected compat), #6301 (revert), #6126 | Primary repo | WA team decision; IsMidnight gate; fork permission |
| 5 | ForeverAuras (Tulkas22) README; Anoniomouse/WeakAuras2; WeakAuras2-for-Midnight | Primary repo (forks) | What survives in forks; out-of-combat-only claim |
| 6 | Forum 2350657 (Tim Jones/Mike Nuthals BlizzCon quote) | Community relay of interview | woW:forever in-combat restrictions intent |
| 7 | Forum 2350682, 2351479, 2355794 | Community | woW:forever shares retail client/restrictions |
| 8 | Forum 2261956 companion #2285445 (Liquid chat-sync; Hazzikostas L'ura quote, wowhead 380532/381097) | Community + linked wowhead | RWF workaround; what stays possible |
| 9 | Forum 2184210, 2215896, 2243547, 2323036, 2336977, 2190711, 2224792, 2350001, 2231437 | Community + dev reports | API symptom ("secret value" error), revert history, TTS/accessibility losses |
| 10 | Forum 2184627, 2224165, 2355387 | Community | Native CD Manager/click-cast; wow:forever guild baseline |
| 11 | Wowhead Forever tag (newsTypeName "Forever"), "WoW: Forever Legacy System" (24307383, wowhead 383067) | News | wow:forever product framing; launch cadence |

Primary sources outweigh secondary here: the two Blizzard articles are the rulebook; the WeakAuras repo history is the platform fact; the live macro post is current hard law; the BlizzCon/devo quotes tie both to wow:forever. Forum threads (esp. 2350657, 2215896, 2243547) are community relays and are labeled as such; where a claim rests on them alone (e.g. exact WoWF beta interface 16001, "addons weren't removed for Forever"), it is marked accordingly.