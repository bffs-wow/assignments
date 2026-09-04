# Community Analysis Engine — design (agreed)

Status: **agreed design** (2026-09-02 grilling session). Not yet built.
Companion research ticket: [R3 (#41)](https://github.com/bffs-wow/assignments/issues/41) — statistician-agent personas, tools & analysis patterns.

## Motivation

Tonight's generated Immerseus assignments were **well-formed but unevidenced**: no `timeline.json`, no `community.json`, so the generator planned from a bare canonical-event whitelist. We want a **learned community-knowledge engine** that accumulates mid-tier 25H kill evidence per boss and derives raid-cooldown strategy that improves over time.

## Decisions (all confirmed by the operator)

### Scope / inputs
- **Single-report / single-pull analysis stays in scope as a runtime input only** — never a hard-coded config value. Today `timeline -r <code> -f <fight>` already does this. No R2-style seeded report ID in code.
- **Community lane is the default evidence source**: rank-band sampling of *mid-tier 25H kills* (not world-first), deduped by report+fight.

### Corpus / persistence
- **SQLite** under `.cache/community/community.db` (`.cache/` already gitignored). One corpus across bosses.
- Tables:
  - `pulls` — id, boss, code, fightID, date, deaths, duration, guild, server, rankBand, pulledAt; UNIQUE(boss, code, fightID) (INSERT OR REPLACE → idempotent re-pulls)
  - `events` — id, pullId, timestamp, abilityName, context (aligned boss ability), eventName
  - `strategies` — id, boss, eventName, occurrence, primaryCd, altCd, confidence, sampleSize, deathsAvg, generatedAt
  - `aggregates` — id, boss, metric, value, computedAt
  - `pull_results` — pullId, kill, deaths, wipe, duration, committedSnapshot, notes (outcome tracking → enables "strategies proven on clean nights" weighting)

### Pull filters
- `--deaths-max <n>` (**default 2**, `0` available): hard-skip a pull when its Deaths event-stream count exceeds the cap; log the skip.
- **"Alive at kill" sanity flag** recorded (not gating) for later learning.
- **Recency**: `--recent 7d` default; **fallback to 30d then all-time** when < 2 distinct band pulls within the window; always record `windowUsed` + `sparse` flag.

### Analysis / aggregation (deterministic anchor + agent prose pass)
- **Deterministic layer** (testable, no model drift):
  - **Time-window modes** primary: per boss-event occurrence (from baked cadence / actual cast timestamps), count cooldown casts in `[cast ± window]`; top-2 = primary/alt with `confidence = share`, `sampleSize = #pulls using any CD that occurrence`.
  - **Context-string modes** fallback when occurrence data missing.
  - **Distinct strategies**: the 2–3 assignments whose shares sum > 0.8.
- **`CommunityAnalyst` agent** provides the human-readable prose on top of computed aggregates (single-shot today; may become richer with R3 findings).
- **Generator input**: keep prose `communityStrategy` **and** add structured `communityModes` into `initialData` (`{boss, event, occurrence, primaryCd, altCd, confidence, sampleSize}`).
- **Confidence floor**: don't feed a mode to `generate` if `sampleSize < 3`; mark `lowConfidence`.

### Learning / optimization over time
- **Recompute on every community run** (deterministic, idempotent): re-aggregate all stored pulls for the boss, update `strategies` + `aggregates`. Modes/confidence shift as good pulls accumulate.
- **Outcome weighting**: `pull_results` lets future aggregation weight strategies by "killed / clean night."
- **No auto-`generate`** — the cron collects + recomputes + writes an advisory report; it never silently mutates committed assignments (raid-night-critical).

### Scheduled automation (Agent Canvas prompt-cron)
- Cron runs `community` for the 14 SOO bosses (collect + recompute, deterministic) **plus an agent pass** that reads the corpus + last pushed sheet rows + `committed.json`, validates against learned modes, and files a report / updates the map with "what changed, what to try, what's low-confidence."
- Deterministic collection is a **custom script** (no LLM per-run); the agent pass is a **prompt preset** (`/api/automation/v1/preset/prompt`, cron trigger, timezone). Respect WCL rate limits (service already has backoff + page caches).
- Local deployment → cron (polling) is correct; no inbound webhooks.

## Authored-as-files

- Research ticket: `#41` (R3). Map #17 updated: R3 added to Research (now), Frontier = T3/T4/R2/R3.
- This doc is the durable record of the agreed design (replace `docs/plans/community-analysis-engine.md` as it evolves).

## Next steps

1. **R3 (#41)** — research the statistician-agent patterns (prompt/persona, tools, correlation/clustering/small-sample methods, agent-loop design) → lands findings in `docs/research/statistician-agent-research.md` + resolution comment with build recommendations.
2. **R2 (#21)** — close out (log + comment), per the frontier.
3. **Build tickets** (new, to be created): SQLite schema + collection run; `--deaths-max`/`--recent` filters; deterministic aggregation + `communityModes` → `generate`; `pull_results` outcome tracking; Agent Canvas prompt-cron (collector script + agent pass).
4. **Prune the hard-coded report anchor** — already none in code; keep it that way (R2's `vhLNKJTwtq2ydgVm` stays a doc/issue reference only).

## Open (next frontier, post-R3)

- Exact cron schedule / timezone for the collector + agent pass.
- Report/issue delivery channel for the agent pass.
- "1-line rationale for a mode change" format.
- R3 findings → finalize the aggregation algorithm + small-sample confidence rule + correlation/clustering methods.