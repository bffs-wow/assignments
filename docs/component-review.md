# Component review — Raid Assignment Automation

Full component-by-component review and documentation round. Date: 2025-08-25.
Sources of truth: the codebase (`src/`, `scripts/`, `test/`), the domain
glossary (`CONTEXT.md`), the plan/spec docs, and the live raid sheets.

## Target sheets (write gate)

| Copy | Google Sheets doc id | Visibility | Role |
|---|---|---|---|
| **Production raid sheet** ("AI BFFS SOO Assigns") | `1mfRwq54y-3AZO4JgmvYitW6JW83YsAPycwigZYswR8Y` | public (exportable) | live, raid-leader-facing — **never written** until validation is proven |
| **Test raid sheet** | `1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms` | private (export 401s without auth) | integration testing + initial release — all automated writes go here |

**Write gate**: the sheet writer must point at the test raid sheet
(`GOOGLE_SHEET_ID` = the test doc) for testing and initial release. Only after
output is proven functional and trustworthy is the gate lifted and
production made a target.

The gid `654454159` in both URLs is the **SOO ASSIGNS** tab (the live raid
plan) — a human deep-link, not something the app targets. The app's sheet
writer addresses tabs by name (**SOO-Assigns-Import**), never by gid.

## At a glance

| Component | Status | Notes |
|---|---|---|
| CLI (`src/cli.ts`) | ✅ implemented | 8 subcommands, injected handlers, fresh Options per command |
| Interactive orchestration (`src/interactive.ts`) | ✅ implemented | menu + review/commit, `io`-injected for scriptable tests |
| `WCLService` (`src/services/wcl.ts`) | ✅ implemented, live | OAuth client-creds, disk cache + TTLs, quota guard, paginated events; **exercised with real logs this session** |
| `RaidHelperService` (`src/services/raidhelper.ts`) | ✅ implemented, live | v4 REST; needs a real event id to run |
| Role mapping (`src/shared/roster-roles.ts`) | ✅ implemented | RaidHelper → sheet role-tag layers (rule tuples + spec rules + overrides) |
| Agents (Flue: `CommunityAnalyst`, `AssignmentGenerator`, `AssignmentRefiner`, `WCLExplorer`) | ✅ implemented, live | model-routed via env; tools: `submit_assignments`, `execute_wcl_query` |
| Assignment schema (`src/shared/assignments-schema.ts`) | ⚠️ pre-#2 | `{ event, occurrence, roleTag, timingOffset, spellName, notes, spellId }` — the sheet-compliant contract (#2) extends it |
| `CSVFormatter` (`src/utils/csv_formatter.ts`) | ⚠️ legacy | 8-column TSV; **not** the sheet's 13-column layout — slated for replacement by #2 |
| Artifact store (`src/state.ts`) | ✅ implemented | timeline/rolemappings/community/assignments/tsv artifacts + `commitAssignments` |
| Data: `mop_skills.json` | ✅ amended | 43 skills; cooldowns verified vs live Wowhead (MoP Classic); durations added; caveats in `docs/player-cooldowns.md` |
| Data: `soo-encounters.json` | ✅ new (ADR-0001) | baked per-boss event vocabulary (`sheetName`, `abbr`, events) |
| Data: `soo-spells.json` | ✅ new | per-boss encounter spells: spellId, live Wowhead description, real WCL cast cadence |
| One-shot planner (`scripts/plan-encounter.ts`) | ✅ implemented | bypasses the CLI handler layer; writes TSV directly |
| Tests | ✅ unit + live integration | unit: cli/interactive/state; integration: real APIs/models, skip-when-key-absent |
| Sheet push (writer) | 🔲 planned, spec #9 | not implemented; one tested module seam + push wiring |

## Execution flow

1. **mappings** — `RaidHelperService.getEventRoster` → `resolveRoleMappings` →
   `rolemappings.json` (role-name bindings — the sheet's role tags).
2. **timeline** — `WCLService.getEncounterEvents(report, fight)` → `timeline.json`
   (encounter start + boss casts with estimated damage).
3. **community** — `WCLService.getCommunityPulls(encounter)` → CommunityAnalyst
   summary → `community.json` (community strategy).
4. **generate** — AssignmentGenerator (timeline + role mappings + skills + strategy
   + baked event vocabulary) → `submit_assignments` (Valibot-validated) →
   `committed.json` / `assignments.json` + `assignments.tsv`.
5. **review** (TTY) — render table; accept → commit.
6. **refine** — AssignmentRefiner applies feedback, rewrites the committed set.
7. **explore** — WCLExplorer answers ad-hoc log questions via `execute_wcl_query`.
8. (Planned) **push** — SheetAssignmentsWriter pushes the committed set into the
   test raid sheet's SOO-Assigns-Import COUNT block after generate + each refine.

`run` composes mappings + timeline + community + generate in one shot;
`scripts/plan-encounter.ts` does the same single-shot outside the handler layer.

## Components in detail

### CLI surface (`src/cli.ts`)
Commander program; each subcommand declares exactly its options; handlers are
injected (so unit tests spy on dispatch). Strict integer coercion for fight ids.
Commands: `timeline`, `mappings`, `community`, `generate`, `run`, `review`,
`refine`, `explore`. Bare invocation = menu. **Gaps**: no `push` command yet
(spec #9), no `--login` Google option yet.

### Interactive orchestration (`src/interactive.ts`)
Menu + review/commit flow; all I/O via injected `io` ({ print, prompt, isTTY })
— piped (non-TTY) runs commit directly so CI never hangs. `renderTable` is the
human review view.

### WCLService (`src/services/wcl.ts`)
Client-credentials OAuth, token auto-refresh, per-instance endpoints
(classic/retail/…), disk cache keyed on (instance, query, variables) with TTLs,
quota tracking at 80%/95%, retry/backoff, paginated event streams following
`nextPageTimestamp`, damage attribution onto boss casts. **Validated this
session**: cached real report probes and live cast streams used successfully to
build the encounter-spell cadence data.

### RaidHelperService (`src/services/raidhelper.ts`)
v4 REST, `Authorization: <key>` header, timeout, class errors with hints.
`getEventRoster` + `getRoleMappings`. Integration test skips without
`RAID_HELPER_EVENT_ID`.

### Role mapping (`src/shared/roster-roles.ts`)
Name-agnostic mapping: `ROSTER_RULE_TUPLES` (combinational pins for
guild-specific/ambiguous labels) → `SPEC_RULES` fallback; emits the sheet's
role tags (e.g. `PROTPALA1`, `DISC3`) and `ALL`/`MELEEDPS`/`RANGEDDPS` group
tags. **Gaps**: unmapped players reported for manual pins.

### Flue agents (`src/agents/`)
`'use agent'` + `useModel(env)` + runtime tool loop. Model defaults:
`opencode-go/deepseek-v4-flash` (generate/explorer) — cheap, 1M context;
`hello.ts` is a toy. `AssignmentGenerator`/`AssignmentRefiner` submit via
`submit_assignments` (Valibot-validated array) → `reply.data.assignments`;
`WCLExplorer` calls the real WCL GraphQL and self-corrects on errors.
**Gap**: generator prompt does not yet receive the baked `soo-encounters.json`
vocabulary or the `soo-spells.json` descriptions (both are ready to feed it).

### Assignment schema (`src/shared/assignments-schema.ts`)
Valibot: `{ event, occurrence, roleTag, timingOffset, spellName, notes, spellId }`.
Pre-#2: lacks `customName`/`tts`/`player` and per-boss `v.picklist` validation
planned in the sheet-compliant contract.

### CSVFormatter + state (`src/utils/csv_formatter.ts`, `src/state.ts`)
CSVFormatter emits a legacy 8-column TSV that does **not** match the sheet's
13-column export grid (that was the pre-integration hand-paste format).
`state.ts` persists artifacts (JSON + TSV) and `commitAssignments` keeps disk
consistent with what was accepted. The planner writes TSV directly.

### Data files
- `mop_skills.json` — role → skills { name, description, cooldown, spellId,
  duration? }; cooldowns verified vs live Wowhead, durations added, four
  corrections (Bloodlust 300s, Tranquility 480s, Hymn of Hope 360s, Ironbark
  60s); custom/utility entries carry null ids (Mass Dispel, Healthstone…).
- `soo-encounters.json` — baked SOO per-boss event vocabulary (ADR-0001):
  id, wclName, abbr, sheetName, events (sheet order). `sheetName` is the
  block-detection key (e.g. "SPOILS OF PANDAREN" ≠ WCL "Spoils of Pandaria").
- `soo-spells.json` — per-boss observed abilities: spellId, name, mapped
  vocabulary event, live Wowhead description, WCL cadence
  (first/last sec, gap min/med/max). Source + refresh in
  `docs/soo-encounter-spells.md`.

### Tests
- Unit (`test/unit/`): cli dispatch, interactive conversation, state artifacts.
- Integration (`test/integration/`): **live** — real WCL / RaidHelper /
  model calls, skip-when-key-absent, consume real quota. Prior art for the
  sheet writer's stubbed-adapter tests: the agent tests exercise the real
  tool loop; the writer's tests mock the Sheets adapter instead.

### Docs / model artifacts
`CONTEXT.md` (glossary), `docs/adr/0001-baked-soo-event-vocabulary.md`,
`docs/plans/google-sheets-integration.md` (plan), `docs/tot-assigns-csv-format.md`
(reference — **known discrepancy**: it maps custom-spell real name to CUSTOM
NAME; the live sheet uses OVERRIDE TTS + CUSTOM ICON), `docs/soo-encounter-spells.md`,
`docs/player-cooldowns.md`, tracker issues #2 (contract + serializer,
`ready-for-agent`) and #9 (sheet push, `ready-for-agent`, Blocked by #2).

## Sheet push (planned — spec #9)

Not yet implemented. One tested seam (`SheetAssignmentsWriter`) + thin wiring
(after generate/refine commits + a `push` command). Personal Google OAuth
(`--login`), tab by name, COUNT-block clear+replace, backup, capacity warning,
TSV fallback, import box untouched. **Validation target = test raid sheet.**

## Validation path to initial release

1. Point `GOOGLE_SHEET_ID` at the **test raid sheet**; run the live integration
   suite; inspect writer results in the test sheet.
2. Test sheet is currently **private to an unauthenticated requester** — the
   OAuth identity used by the writer needs edit access; if public export is
   wanted for inspection, share "Anyone with the link".
3. Once outputs are proven (block placement, formula columns intact, custom
   assignments via K/M, ordering, capacity warnings, TSV fallback), lift the
   write gate and target the production raid sheet.

## Gaps & risks

- CSVFormatter's 8-column TSV ≠ sheet grid (handled by #2).
- Custom-spell column convention: live sheet is K (OVERRIDE TTS) + M (CUSTOM
  ICON); `docs/tot-assigns-csv-format.md` still says L (CUSTOM NAME) — fix the
  doc when touch.
- Generator does not yet consume the baked vocabulary / spell DB.
- Test sheet visibility + OAuth setup blocks live end-to-end validation.
- `RAID_HELPER_EVENT_ID` absent → roster mapping untested live.
- Import box regeneration is sheet-side: any write that breaks rows breaks the
  box until the sheet recomputes it.
- Trash/add abilities in soo-spells.json are per-log observations, not a
  guaranteed boss-cooldown model.