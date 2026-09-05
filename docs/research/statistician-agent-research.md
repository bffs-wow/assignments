# R3 — Research: statistician-agent personas, tools & analysis patterns for the community-corpus engine

**Ticket:** [R3 — Research: statistician-agent personas, tools & analysis patterns for the community-corpus engine (learned knowledge base)](https://github.com/bffs-wow/assignments/issues/41) · **Map:** [#17](https://github.com/bffs-wow/assignments/issues/17)
**Status:** research → findings · **Date:** 2026-08-22
**Companion design:** `docs/plans/community-analysis-engine.md` (agreed) — SQLite corpus (pulls/events/strategies/aggregates/pull_results), deterministic time-window modes + agent prose pass, sample-size floor 3, outcome weighting, Agent Canvas prompt-cron.

---

## Scope

Find the state of the art for each of the R3 questions, matching the agreed engine's shapes:

| R3 ask | Matching engine shape |
|---|---|
| 1. Statistician-agent prompting / personas | `CommunityAnalyst` prose pass + cron agent pass |
| 2. Tooling | deterministic aggregation layer (testable, no model drift) |
| 3. Correlation/co-occurrence | "is a CD cast correlated with a boss event within a window" |
| 4. Multiple-comparison control | scanning many event×CD cells for modes |
| 5. Small-sample confidence | `sampleSize` 3–10 pushes |
| 6. Outcome weighting | `pull_results` (kill / clean night) → strategy weighting |
| 7. Agentic analysis-loop | collect → aggregate → summarize → propose → validate |

---

## 1. Statistician-agent personas & prompting

**Well-established pattern: the "data analyst / statistician" persona agent.** Rather than one giant LLM prompt, the effective pattern is a **structured reasoning loop with explicit statistical framing**:

- **Persona = "tabular/data analyst"**: instructs the model to: (1) state the question as a testable claim, (2) compute from the data (not prose), (3) report effect size + uncertainty (not just significance), (4) state assumptions/limits, (5) recommend action. This is the "statistician agent" persona: rigorous, quantifies uncertainty, never asserts a pattern without a measure.
- **Key anti-hallucination rule**: the agent must **call a deterministic tool for every number it cites** — no computed-from-memory. This is the direct answer to the ticket's "hallucinated stats" failure mode.
- **"Charting-driven analysis loop"**: the analyst alternates compute → inspect → hypothesize → compute, with the authority to slice the data. For our engine the "chart" is the *deterministic mode table* — the agent reads it, doesn't re-derive it.

**Primary sources**
- Statistical "data analyst agent" prompt patterns are documented in the LLM-agent tooling literature; the durable principle is *numbers come from tools, not the model*. See the OpenHands/agent-skills tooling model (https://docs.openhands.dev/) and the statistical-reasoning guidance in modern data-science agent toolkits. The "statistician persona" also maps to the **EPP (Enumerate-Possibilities-Plan)** and "thought → action → observation" ReAct pattern — the model toggles between tool calls and reasoning.
- When the persona is a *domain* analyst (raid cooldowns), the strongest practice is: **ground the persona in the domain's event vocabulary** (here: the baked SOO vocabulary, ADR-0001) so "correlation" always means *these events×CDs*, never free-form ability names.

**For this engine**: the persona pattern to adopt is **"automated statistician"**: the `CommunityAnalyst` (prose) is *fed* the deterministic aggregates and instructed to interpret them under small-sample rules, never to invent a statistic. The cron agent pass reads the corpus + aggregates and files advisory findings, citing computed numbers only.

---

## 2. Tooling

The ticket asks for established deterministic, code-based statistical tooling. Grounding for a **typescript/Node** codebase (no heavy Python runtime required):

- **SQL is a statistical query tool.** Our corpus is SQLite. Deterministic modes are expressible as SQL aggregates (`GROUP BY event, occurrence, cd`, windowed `WHERE` on timestamps) — this is the "pandas/SQL-based patterns" the ticket names, and keeps the layer testable (the agreed design's "deterministic anchor").
- **If/when heavier stats are needed**: the established suites are **pandas + scipy/statsmodels** (Python ecosystem) and **R**. For a Node repo, `simple-statistics` / `jstat` cover bootstrap, percentiles, chi-square, t-tests without a Python dependency. The agreed design says *deterministic, testable, code-based* — SQL + a small math lib in the app's language is the minimal, idiomatic fit.
- **"Tabular reasoning" toolset for a sub-agent**: a sub-agent handed a dataset benefits from being able to run **SQL against the corpus** (deterministic) rather than eyeballing JSON. If the cron agent pass needs live querying, giving it a `query_corpus(sql)` tool (the WCL-Explorer pattern already in this repo) is the established shape.

**For this engine**: keep aggregation in **SQL + app-typed code** (testable, matches the agreed design). No Python service. Optionally add a `simple-statistics`-style dependency for bootstrap/CIs if small-sample confidence needs beyond simple proportions. The deterministic layer stays the single source of numbers; the agent prose pass consumes it.

---

## 3. Correlation / co-occurrence of events (CD × boss event in a window)

The agreed engine's deterministic mode is already a **co-occurrence count** (CD cast inside `[event_cast ± window]`). The mathematical upgrades established for this "market-basket" shape (the ticket's explicit analogy):

- **The market-basket/association-rule frame is exactly right.** CD×event co-occurrence = itemset analysis. The standard measures:
  - **Support** = P(CD and event co-occur) = count(co-occurring pushes)/N. *Fragile at small N — drives the small-sample rule below.*
  - **Confidence** = P(CD | event) = count(CD and event together)/count(event). **This is already `confidence = share` in the agreed design** — the primary/alt CD shares sum toward 1.0.
  - **Lift** = P(CD|event)/P(CD) — whether a CD is *more likely given the event than its base rate*. **The key missing measure**: a CD used "whenever any hard thing happens" (high base rate) will have high confidence for *every* event; lift discounts that and surfaces *specific* CD×event pairings. **Recommendation: add lift alongside confidence** to distinguish "the staple CD" from "the CD that specifically answers this event."
  - **(Pointwise) Mutual Information (PMI)** = log(P(CD,event)/(P(CD)P(event))) — the information-theoretic sibling of lift; ranks pairs by how much more they co-occur than chance. Lift and PMI are monotone-equivalent for the same marginals; pick lift (interpretable: "2.1× as likely") and/or PMI as a ranking.
  - **Chi-square / significance** of a CD×event cell = whether the observed co-occurrence exceeds expected under independence. Useful as a *filter* (only report cells that can't be explained by chance given other CDs), but **see §4/§5 for the multiple-comparison + small-sample caveats**.

**For this engine**: keep `confidence = share` as the headline, **add `lift`** (and optionally PMI) computed deterministically, and treat **chi-square as an optional significance filter with the FDR guard from §4**, not a hard gate at small N.

---

## 4. Multiple-comparison / false-discovery control when scanning many event×CD cells

The engine scans *many* (event × occurrence × CD) cells for "modes." Naively reporting the highest-confidence cells **overfits** — with enough cells, some look great by chance.

- **The established correction families**:
  - **Bonferroni** (FWER): adjusted p = p × (#cells). Simple but *very* conservative — at small N it erases everything. Bad fit here.
  - **Benjamini–Hochberg (BH) FDR** (the standard for exploratory many-cell scans): controls the *expected proportion of false discoveries* among the cells you call significant. **This is the right frame** for "which CD×event cells are real modes."
- **Practical consequence for this engine**: with tiny sample sizes (3–10), formal FDR on raw p-values is usually impossible to meet. So the **guard is two-layered**:
  1. **Structural**: only scan cells for *events that actually occur* in the corpus (the agreed design already keys on baked occurrences) — collapses the cell count to what the data supports.
  2. **Reporting**: use BH-FDR to *rank/report* (only surface cells passing FDR when N is large enough to support it), and otherwise fall back to the §5 small-sample rule. Never report "p < 0.05" from a 4-push scan.
- **Anti-p-hacking structural guard**: **pre-register the aggregation** (fixed window, fixed occurrence set, fixed method) and make it *idempotent* (recompute = same result). The agreed design's "deterministic, idempotent recompute" is exactly this.

**For this engine**: use **BH-FDR** as the many-cell reporting rule when N supports it; otherwise the small-sample rule of §5 governs. Do NOT use Bonferroni. Keep the cell universe fixed by the baked occurrence vocabulary (ADR-0001) — that's the pre-registration.

---

## 5. Small-sample statistics (sampleSize 3–10)

The engine's confidence floor is `sampleSize < 3 → don't feed generate`; R3 asks how to *report confidence when sampleSize is 3–10 without overclaiming*. The established methods, in ascending rigor:

- **Exact methods over asymptotics** when N is tiny:
  - **Binomial proportion + exact CI (Clopper–Pearson)** reports `confidence = share` with a correct small-sample interval, e.g. 6/8 → share 0.75, 95% CI [0.35, 0.97]. Wide interval = the honest signal. **This is the headline recommendation** — a simple, exact, defensible interval, easy to compute (no Python; a small function or `simple-statistics`).
  - **Fisher's exact test** for CD×event 2×2 tables — the small-sample replacement for chi-square (chi-square is asymptotic and invalid at N<5 per cell).
- **Bayesian shrinkage / smoothing**: instead of a raw proportion, shrink toward a prior (e.g. add a pseudo-count, or a Beta-binomial with a neutral prior). Prevents "2/2 = 100% confident" absurdities. **Use a mild Beta-binomial (or Laplace/Jeffreys add-α/2 pseudo-counts) so a 1-of-1 cell isn't reported as share 1.0.** The agreed design's "don't feed if N<3" already prevents the worst case; shrinkage makes the 3–10 range honest.
- **Bootstrap**: resample the observed pushes to get a CI for the share. Fine once N is ≥ ~10; at N<5 it's noisy and the exact Clopper–Pearson is better. **Defer bootstrap to N≥10.**
- **Reporting language**: replace "73% confidence" with "5/7 pushes used Devotion Aura here; exact 95% CI 0.35–0.97". An agent/reader can't over-read a CI.

**For this engine — the confidence rule to adopt:**
- N < 3: **do not feed to generate** (existing floor), mark `lowConfidence`.
- 3 ≤ N < 10: report `share` + **Clopper–Pearson exact 95% CI** (or Beta-binomial shrink with a weak prior to avoid 100%/0% cells), *no* chi-square.
- N ≥ 10: can add bootstrap CI + optional BH-FDR over cells.
- Never report a bare p-value at N<10.

---

## 6. Outcome weighting (strategies "proven on clean kills")

`pull_results` tracks kill/wipe/deaths/duration → "weight strategies by clean-night outcomes." The established frame is **survival/outcome-adjusted analysis**, but the *simple* correct version needs no survival machinery:

- **The survival-analysis analog** (Kaplan–Meier, Cox) is overkill for "did tonight's kill use CD X on event Y." Those models answer *time-to-event* questions.
- **The simpler, established pattern is outcome-subgroup / propensity-lite weighting**:
  - **Stratified reporting**: report mode shares **separately for kill vs wipe** and prefer the kill-stratum when its N is sufficient (the "proven on clean nights" intent, exactly).
  - **Outcome-weighting (inverse-variance / precision-weighted)**: weight each push's contribution by a function of outcome (clean kill = highest, wipe-with-many-deaths = lowest) — a deterministic scalar, not a model. This is the "simpler outcome-weighted stats" the ticket anticipates.
  - **Don't over-wheel**: with N 3–10, building a weighted estimator from 8 pushes adds noise; stratified reporting (kill vs wipe) is more honest than a single precision-weighted number at tiny N.
- **"Alive at kill" sanity flag** (in `pull_results`) supports a *quality gate*: exclude pushes where the CD caster died before the recorded cast window (a CD "used" by a dead player isn't evidence).

**For this engine — the outcome rule:**
- Primary: report **kill-stratum modes** as the headline when N_kill ≥ 3, wipe-stratum as secondary context.
- As a secondary cross-check once N grows: precision/outcome-weighting (simple scalar), not a full survival model.
- Use the "alive at kill" flag to drop casts that can't be evidence.

---

## 7. Agentic analysis-loop design (collect → aggregate → summarize → propose → validate)

The agreed cron does deterministic collection + recompute + an agent pass. The established agent-loop pattern for a growing dataset:

- **The loop**: `collect → aggregate (deterministic) → summarize (agent) → propose (agent) → validate (deterministic re-check + human/operator confirm)`. The key discipline: **the deterministic steps decide, the agent narrates.** Never let the prose agent's summary alter the numbers (they come from a deterministic recompute).
- **Tool handoff for the agent pass**: the range options are (a) feed it the recompute output as static context (simplest, idempotent), or (b) give it a `query_corpus(sql)` tool for live lookups (the WCL-Explorer pattern already in this repo). For a *cron advisor*, (a) static recompute output is enough and avoids the agent inventing numbers; (b) becomes worthwhile only when the pass must answer ad-hoc questions.
- **Failure modes** (the ticket names them) and their guards:
  | Failure | Guard |
  |---|---|
  | **Hallucinated stats** | agent only cites numbers produced by the deterministic layer; no arithmetic in prose |
  | **Overfitting small N** | Clopper–Pearson CIs + don't-feed <3 (§5); report width, not just point |
  | **p-hacking across cells** | fixed cell universe (baked vocabulary) + BH-FDR only when N supports (§4); recompute is idempotent |
  | **Confirmation/recency bias** | window fallback (7d→30d→all) logged as `windowUsed` + `sparse` flag; never silently drop older evidence |
  | **Silent mode drift** | "1-line rationale for a mode change" (already an open next-step in the design) — the agent pass always explains *why* a mode changed vs last recompute |
- **Human-in-the-loop**: the cron *never* auto-`generate`s (agreed) — it writes an advisory report. That is the correct loop: the agent proposes, a human (or a deterministic gate) validates. The proposed report fields map: what changed, what to try, what's low-confidence — each backed by a computed number.

**For this engine**: keep the loop shape `collect → aggregate → summarize → propose → validate`, give the agent pass the static recompute output (option a), and route the advisory report through a per-mode-change rationale line. Add `query_corpus(sql)` only if ad-hoc exploration becomes a need.

---

## Concrete build recommendations (for the resolution comment / implementation)

1. **Persona**: an "automated statistician" persona for `CommunityAnalyst` + the cron agent pass — cite computed numbers only, state CI + sample size, never do arithmetic in prose.
2. **Tools**: SQL aggregation in the app (no Python service); add a tiny stats lib (`simple-statistics` or a hand-rolled Clopper–Pearson/Beta-binomial) only for §5.
3. ** Correlation:** keep `confidence = share` as headline; add **lift** (+ optional PMI) computed deterministically; treat chi-square as an optional, FDR-guarded filter.
4. **Multiple comparisons**: **Benjamini–Hochberg FDR** is the reporting rule when N supports it; Bonferroni is out; the cell universe is fixed by the baked vocabulary (ADR-0001) as pre-registration.
5. **Small sample**: N<3 → don't feed (existing); 3≤N<10 → `share` + Clopper–Pearson exact 95% CI (or Beta-binomial shrink), no chi-square; N≥10 → may add bootstrap + FDR. Never a bare p at N<10.
6. **Outcome weighting**: headline = **kill-stratum modes** when N_kill≥3; wipe-stratum as context; precision-weighting only when N grows; use "alive at kill" to drop dead-caster evidence.
7. **Agent loop**: `collect → aggregate → summarize → propose → validate`; agent pass reads static recompute output (option a); per-mode-change rationale line; no auto-generate.

---

## Sources

- Agreed engine design — `docs/plans/community-analysis-engine.md` (companion).
- Market-basket / association rules (support, confidence, lift): classic itemset-mining literature (Agrawal–Srikant); the standard treatment in data-mining textbooks (e.g. Han, Kamber, Pei, *Data Mining: Concepts and Techniques*).
- Pointwise mutual information: standard NLP/information-theory references (Church–Hanks).
- Multiple comparisons: Benjamini–Hochberg (1995) FDR; Bonferroni FWER.
- Exact small-sample CIs: Clopper–Pearson (1934), exact binomial confidence interval; Fisher's exact test.
- Bayesian shrinkage: Beta-binomial model; Laplace/Jeffreys pseudo-count smoothing.
- Agent loop pattern (collect→aggregate→...→validate) and "numbers from tools, not prose": OpenHands agent/tooling model (https://docs.openhands.dev/), ReAct (Yao et al.) and the tool-augmented reasoning literature.
- Survival analysis (Kaplan–Meier/Cox) marked out-of-scope for this simpler outcome weighting; stratified analysis preferred.