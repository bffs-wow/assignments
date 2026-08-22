# Plan: Replace hand-rolled CLI parsing with commander.js

Status: approved — Part 1 (commander migration) implemented; Part 2 (CLI-driven
operations) ready to implement
Date: 2026-08
Owner: seanm

> **Amendment (Part 2): CLI-driven operations.** Part 1 replaced the manual
> arg parser with commander.js. Part 2 removes the last piece of automatic
> behaviour — the pipeline that auto-runs on `node index.js -r … -f … -e …`
> and then drops into a fixed interactive loop. The tool becomes fully
> CLI-driven: every operation is an explicit initialization, through a main
> menu and/or a one-shot subcommand, with state flowing between operations via
> artifacts in a state directory. The amendment supersedes the old "Out of
> Scope" line about the interactive loop.

## Problem Statement

`index.js` hand-rolls CLI parsing (`parseArgs` + a `USAGE` string). It silently ignores
bare positionals, coerces a non-integer `fight` id to `null` (producing a misleading
"missing required input" error when the value was merely mistyped), doesn't validate the
instance enum at the CLI (fail happens later, inside `WCLService`), and its help text can
drift from the actual options. The parsing logic has zero unit tests — the repo's only
tests are live-API integration tests that need real credentials.

## Solution

Adopt commander.js as the CLI framework. Extract the program definition into a single
testable module (`src/cli.js`). Commander owns option definitions, required-option
enforcement, `parseInt` coercion, instance enum validation, env-var defaulting
(`WCL_INSTANCE`), generated help, and error/exit behavior. `index.js` shrinks to
"parse + run pipeline". The `GEMINI_API_KEY` env check stays manual in `index.js`.

## User Stories

1. As a user, I want to run the tool with `-r`/`-f`/`-e`, so that the pipeline runs exactly as before.
2. As a user who omits a required option, I want a clear "missing required option" error and exit code 1, so I know what to fix.
3. As a user who mistypes the fight id (`-f abc`), I want an immediate "invalid argument" error, so I don't get a misleading "missing" error.
4. As a user who passes an unknown flag, I want commander's error plus a suggestion, so I can recover quickly.
5. As a user who passes a stray positional argument, I want an error, so typos are not silently ignored.
6. As a user who passes an invalid instance (`-i bogus`), I want an instant CLI error, so I don't burn a WCL API call before finding out.
7. As a user who omits `-i`, I want the `WCL_INSTANCE` env var (else `classic`) to apply, so the MoP default keeps working.
8. As a user, I want `--help` to print generated help that cannot drift from the real options.
9. As a developer, I want CLI parsing covered by unit tests that need no live API keys, so regressions are caught without credentials.

## Implementation Decisions

1. **Scope (Q1A)**: commander owns flags, required-option enforcement, and the instance
   default. The `GEMINI_API_KEY` check stays a manual env check in `index.js` — it is an
   environment concern, not an argument concern.
2. **Behavior compatibility (Q2A)**: commander's defaults win — generated help, its error
   messages, exit code 1 on error, and errors on stray positionals (the current code
   ignores them).
3. **Fight coercion (Q3A)**: `-f`/`--fight` uses commander's built-in `parseInt` coercion,
   so a non-integer errors as "invalid argument" rather than masquerading as missing.
4. **Instance validation (Q4A)**: `-i`/`--instance` validates against
   `retail | classic | fresh | vanilla | sod` at the CLI (fast fail). `WCLService` keeps
   its own guard, unchanged.
5. **Env default (Q5A)**: `-i` falls back via commander `.env('WCL_INSTANCE')`, then the
   default `'classic'` — identical semantics to today's `flag → env → classic`.
6. **Testability / seam (Q6A)**: the commander program is defined in `src/cli.js` behind a
   factory (`createProgram()`) plus a singleton for `index.js`, so tests get a fresh
   `Command` per case and never mutate shared state. `index.js` consumes the singleton.
7. **npm scripts**: `"test"` becomes the unit suite (`node --test test/unit/`);
   `"test:integration"` stays live-API only. This matches the integration suite's stated
   intent that it is "intentionally separate from the unit-test command".
8. **Dependency**: `commander` added to dependencies via `npm install commander`.

## Testing Decisions

- Only **external behavior** is tested, through the CLI seam: exit codes, error messages,
  and resolved option values — never internals.
- **Seam**: the `Command` exported by `src/cli.js`, driven with `program.parse()` under
  `exitOverride()`, so tests capture the thrown `CommanderError` instead of
  `process.exit()` killing the runner.
- **Module under test**: `src/cli.js` only. `index.js`'s pipeline is untouched and stays
  covered by the existing integration tests.
- **Prior art**: `node:test` + `node:assert` from `test/integration/*.test.js`; new tests
  live in `test/unit/`.
- **Cases**: each required option missing (`-r`/`-f`/`-e`), `parseInt` failure, invalid
  instance, instance default, `WCL_INSTANCE` env fallback, `--help` output, unknown
  option, stray positional.

## Out of Scope

- Replacing the interactive prompt loop (`readline`) in `index.js` — **superseded by Part 2** (the loop becomes the main menu; see amendment below).
- The `GEMINI_API_KEY` check (stays manual).
- Any change to `WCLService` / `RaidHelperService` / `AIAgent` / `WCLExplorerAgent` behavior.
- Flag name changes (the `-r`/`-f`/`-e`/`-i`/`-h` contract is preserved on the ops that need them).

## Further Notes

- Commander's generated help changes the exact help text; nothing in the repo parses the
  old `USAGE` string, so nothing downstream depends on it.

---

# Part 2: CLI-driven operations

Status: approved — ready to implement

## Problem Statement (Part 2)

Today `node index.js -r X -f 4 -e Y` runs the entire pipeline automatically
(mappings → timeline → community → generate → write TSV) and then drops into a
fixed interactive loop. The user wants **no automatic work**: any operation the
tool takes must be an explicit initialization via the CLI, and after each
execution the user lands back in a main menu (or a sub-process prompting the
next step) where they decide what happens next.

## Solution (Part 2)

- `node index.js` (no args) opens a **main menu** of operations. Picking one runs
exactly that operation, then returns to the menu. Exit is an explicit choice.
- Every operation is also a **one-shot subcommand** (`node index.js timeline
--report X --fight 4`), usable in scripts. On a TTY the operation still lands
back in the menu/sub-process; on a non-TTY stdin (piped/CI) it writes its
artifacts and exits.
- Operations exchange state through **JSON artifacts in a state directory**
(default `.cache/cli/`, overridable with `--state <dir>`).
- `run` drives the whole old pipeline in one explicit command; missing required
params are **prompted interactively**, not hard-errored.
- After `generate`/`refine`/`run` produce assignments, a **review/commit
sub-process** lets the user review in-console, write files, commit, or suggest
changes (→ refine, looping back).

## User Stories (Part 2)

10. As a user, I want `node index.js` to show a menu, so that nothing runs without my explicit choice.
11. As a user, I want each operation invocable as a one-shot subcommand, so that I can script single operations.
12. As a user, I want `run` to execute the whole pipeline on demand, so that the old behaviour is available when I ask for it.
13. As a user running from a script (non-TTY), I want one-shots to finish, write artifacts, and exit, so that CI/pipes do not hang on a menu.
14. As a user, I want analysis results reviewable in-console or written to file, then committed or refined, so that I control the final output.
15. As a user, I want `--state <dir>` on operations, so that I can run isolated workspaces.
16. As a user, I want Commit to update both the canonical artifact and the rendered TSV, so that the file on disk matches what I accepted.
17. As a user, I want the main menu to offer: mappings, timeline, community, generate, full run, review, refine, explorer, and exit.

## Implementation Decisions (Part 2)

9. **Menu-first surface**: operations are `mappings`, `timeline`, `community`,
   `generate`, `run`, `review`, `refine`, `explore`, plus Exit. Each is a
   commander subcommand declaring exactly the options it needs (Q5A, round 1);
   the bare program opens the menu loop.
10. **One-shot exit semantics**: with interactive stdin (TTY), an operation
    returns to the main menu (or enters its sub-process) when done; with
    non-TTY stdin, it finishes, writes artifacts, and exits.
11. **State directory**: artifacts live at `--state <dir>` (default
    `.cache/cli/`): `timeline.json`, `role_mappings.json`,
    `community_strategy.md`, `assignments.json` (canonical/committed), plus the
    rendered `assignments.tsv` beside the artifact on commit.
12. **run prompting**: `run`'s report/fight/encounter options are not commander-
    required; the action prompts interactively for any missing ones (TTY),
    and errors on non-TTY when inputs are incomplete.
13. **Review/commit sub-process** after `generate`/`refine`/`run`:
    [1] review in console (table), [2] write files to disk,
    [3] commit (canonical artifact + TSV), [4] suggest changes (feedback →
    refine, loops back), [5] back to main menu.
14. **Discrete fetch ops** (`timeline`, `mappings`, `community`) save their
    artifact and report the path; `generate` reads the three artifacts +
    `src/data/mop_skills.json` and produces assignments.
15. **Seams under test** (confirmed):
    - `src/cli.js` — subcommand/option surface and validation (unit),
    - `src/interactive.js` — menu loop + review/commit flow with injected
      `prompt`/`print` (unit),
    - `src/state.js` — artifact save/load/commit round-trips in a temp dir (unit).
    Op bodies stay thin over the services; API-touching behaviour stays covered
    by the existing integration suite.

## Out of Scope (Part 2)

- Changes to the services (`WCLService`, `RaidHelperService`, `AIAgent`,
  `WCLExplorerAgent`) or the flue migration in flight.
- Interactive exploration of WCL data beyond the single `explore --query` op.
