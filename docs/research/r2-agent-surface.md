# R2 — Research: how a general agent consumes a CLI + artifact store

**Ticket:** [R-A — How a general agent consumes a CLI + artifact store (skills/tools)](https://github.com/bffs-wow/assignments/issues/38) · **Map:** [#37](https://github.com/bffs-wow/assignments/issues/37)
**Status:** resolved AFK · **Date:** 2026-08-22

## Question

How does a general agent harness (OpenHands / Claude Code / similar) most idiomatically consume a CLI + artifact-store application like this one? Three sub-questions: (1) skill docs vs MCP vs native tools, (2) is a CLI writing JSON artifacts to a state dir an adequate seam, (3) how agent-driven flows handle a human-confirm write gate.

## Grounding used

- **This repo's own convention** (primary, local): `AGENTS.md` routes agents to `docs/agents/*.md` skills (issue-tracker, triage-labels, domain) — the "Matt Pocock" model of repo-supplied agent instructions. The current working session proved the pattern end-to-end: a general agent drove `generate` / read `sheets-rows.json` errors / `refine` / reconcile against the reference sheet via CLI one-shots + artifact reads, with no MCP and no custom wrapper.
- **The general agent harness in use** (OpenHands / Agent Canvas): skills are freeform Markdown invoked by the agent (`.openhands/skills/`, repo `docs/agents/`, `AGENTS.md`); the agent has a terminal + file tools and shells out to CLIs naturally.
- **Reference conventions** (official/primary):
  - OpenHands CLI + skills model — https://docs.openhands.dev/ (skills are repo/user-supplied Markdown; the harness owns the conversational loop, memory, tool orchestration).
  - Anthropic Claude Agent Skills — the `SKILL.md`-in-`skills/` convention (front-matter description; progressive disclosure; freeform instructions, not code).
  - MCP spec — the Model Context Protocol for exposing *tools* (server-side RPC) when a harness should call operations as native tools rather than parse CLI output.

## Findings

### 1. Skill docs vs MCP vs native tools

The deciding factor is **who owns the conversational loop and tool orchestration**:

- **Skill doc (repo or user-supplied Markdown)**: the right default. The harness already *has* the loop, memory, file tools, and terminal. A skill doc teaches the agent *how to drive the app with its existing tools* (run this binary, read that artifact, interpret these errors). Zero infrastructure; matches this repo's existing `docs/agents/*.md` convention; the agent can chain operations and human-feedback turns ad hoc, which is exactly what the delivery loop (generate → review errors → refine → push) needs.
- **Native tools / direct shell**: the same thing without the documentation layer. Fine for a *single* well-known command, but a delivery flow with validation semantics, artifact grammar, and write gates needs the doc. The CLI is already a native tool surface; the skill doc is what makes it *usable* by an agent.
- **MCP tools**: only warranted when a harness should call operations as **typed, discoverable RPC endpoints** rather than shell out — i.e. when the *consumer* is an MCP client (an editor, a distinct harness) that wants schema-typed tools, or when an operation returns structured data that's painful to parse from stdout. Here the app already emits structured **artifacts** (JSON files), so stdout parsing isn't the bottleneck. MCP adds a server, transport, and auth for no gain in this shape.

**Conclusion (Q1):** Skill doc over the existing CLI + artifact store is idiomatic. MCP is downstream packaging only if a future consumer needs typed tools; not needed to make the app agent-driven.

### 2. Artifact contract

A CLI that writes JSON artifacts to a state dir is an **adequate and even ideal seam**, provided:

- The artifacts are the **source of truth for the agent's next step** (not log text). `committed.json`, `sheets-rows.json`, `rolemappings.json` already are: the agent reads `sheets-rows.json.errors` to decide whether to `refine`, reads `committed.json` to review, reads `rolemappings.json` to reason about roster drift.
- **Error semantics need to be machine-actionable.** Today validation failures are strings in `sheets-rows.json.errors` (e.g. "row 12: BOSS HEALTH / SPELL must be a known event"). An agent handles those fine, but the convention could be tightened cheaply: stable **error codes** (`ERR_UNKNOWN_EVENT`, `ERR_BAD_OCCURRENCE`, ...) + the affected row/field, so an agent matches on codes rather than prose. This is a *nice-to-have*, not a blocker.
- **Exit codes matter** (0 = success, non-zero = the operation failed *before* producing artifacts) so the agent can distinguish "no output" from "valid empty".
- The one gap: **schemas**. The artifacts are JSON but untyped. A cheap `src/data/*.schema.json` or TS type re-export (the app already has `assignments-schema.ts`) lets an agent validate what it reads. Again optional.

**Conclusion (Q2):** The artifact store is sufficient today. The only tightening worth doing (and worth a P-A/G-A mention) is stable error **codes** + documented exit-code convention — no new tool surface required.

### 3. Write gates

The working convention for agent-driven flows that hit a shared/external side effect:

- **Make the gate a flag, not a prompt.** A CLI that interactively prompts is hostile to an agent (a prompt can block a non-TTY/agent context). The app already has `push --yes`. An agent sets `--yes` **after it has satisfied the validation preconditions** (read `sheets-rows.json`, confirmed zero errors, shown the human a review). The flag encodes "the agent verified," not "the human clicked."
- **Separate the tiers.** Human-confirm belongs at the *irreversible/wide-audience* boundary: the **production** raid sheet. The app's existing philosophy (`CONTEXT.md` write-gate: test sheet is the operational destination, production never written until proven) is exactly right — keep `push --yes` for the **test** sheet, and make the **production** sheet require an explicit human step (a separate flag or a `--target production` that human types).
- **Precedent:** this is how agents handle destructive/irreversible ops generally — the harness shows the human the exact command + effect, the human authorizes it, and only then does the agent proceed. The app's `push` already backs up to `backups/` first, which is the right belt-and-suspenders.

**Conclusion (Q3):** `push --yes` (agent-verified) targeting the **test** sheet with backups is idiomatic; the **production** sheet stays a human-confirmed gate. No interactive prompt in the agent path.

## Recommendation for THIS app

> The idiomatic surface is a **repo-supplied skill doc** (`docs/agents/raid-cli.md`) over the **existing commander one-shots + artifact store**, with the current write-gate philosophy kept (test = `--yes`, production = human). No MCP server, no new wrapper, no `--json` duplication. Two optional cheap tightenings: stable validation **error codes** and an **exit-code convention** in the skill doc.

This is exactly the shape the current working session already exercised successfully, so the prototype (P-A) should capture it in writing and G-A should lock it as authoritative.

## Sources

- OpenHands docs — https://docs.openhands.dev/ (CLI mode; agent skills model).
- Anthropic Agent Skills / Claude Code — `SKILL.md` convention (progressive disclosure, freeform instructions).
- MCP specification — https://modelcontextprotocol.io/ (typed tool RPC; when to reach for it).
- This repo: `AGENTS.md`, `docs/agents/*.md`, `CONTEXT.md` (write-gate philosophy), `src/shared/assignments-schema.ts`, CLI surface in `src/cli.ts` + `src/index.ts` (one-shots + `.cache/cli/` artifacts).