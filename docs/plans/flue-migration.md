# Plan: Replace `@google/genai` with Flue Framework

Status: in progress — M1–M3 and the integration tests are done; M4 (CLI rewire) and the model-default flip are also done. Remaining: cleanup/docs polish (M6) and commit.
Date: 2026-08
Owner: seanm

## Goal

Swap the direct `@google/genai` SDK usage out of this repo for **Flue** (https://flueframework.com/),
the open agent framework from the Astro team. Keep the existing interactive CLI UX. Use two
credentials:

| Credential | Env var | Provider / specifier |
|---|---|---|
| Google Studio key (already in `.env`) | `GEMINI_API_KEY` | `google/gemini-2.5-flash` |
| OpenCode Go key (add to `.env`) | `OPENCODE_API_KEY` | `opencode-go/deepseek-v4-flash` |

Verified against the Pi provider catalogs bundled with `pi-ai`:

- `google/gemini-2.5-flash` — present, `GEMINI_API_KEY`.
- `opencode-go/deepseek-v4-flash` — present (api `openai-completions`, baseUrl
  `https://opencode.ai/zen/go/v1`), env `OPENCODE_API_KEY`. `reasoning: true`, text-only input.

## Decisions (locked)

1. **Scope: Option A — adopt Flue, keep the CLI.** Agents as `'use agent'` functions, driven from
   the existing CLI through Flue's standalone-scripts API (`start()` / `init()` / `dispatch()` /
   `read()`). No Vite/Hono server — this app stays a local CLI.
2. **OpenCode key is OpenCode Go** (workspace
   `https://opencode.ai/workspace/wrk_01M00BHXJA279250QNKDT73H2C/go`). Its API key value goes in
   `.env` as `OPENCODE_API_KEY` (the user pastes it — it lives in their opencode auth, not in this
   repo).
3. **Model routing (defaults, env-overridable):**
   - `MODEL_GENERATE` = `opencode-go/deepseek-v4-flash` — assignment generation/refine/community analysis
   - `MODEL_EXPLORER` = `opencode-go/deepseek-v4-flash` — WCL Explorer agent
   - `google/gemini-2.5-flash` remains a supported alternative via `MODEL_*` (Google Studio key).
   - Rationale: deepseek-v4-flash is the cheapest model on the OpenCode Go gateway
     ($0.07/M in, $0.14/M out) with a 1M context; proven in our integration tests for
     both structured output (submit_assignments) and tool calling (execute_wcl_query).
4. **Persistence: SQLite** via `sqlite('./.cache/flue.db')` (`.cache/` is already gitignored).
   Conversations survive process restarts.

## What exists today (usage inventory)

| File | Role | genai features used |
|---|---|---|
| `src/agent.js` | `AIAgent`: community summary (free text), generate + refine assignments (JSON) | `generateContent`, `Type`/`Schema` JSON mode |
| `src/wcl_explorer.js` | `WCLExplorerAgent`: autonomous WCL GraphQL query agent | `chats.create`, manual `functionCalls`↔`functionResponse` loop, `functionDeclarations` |
| `src/utils/retry.js` | backoff on 429/503/5xx for model calls | error-shape sniffing (`err.status`/`code`) |
| `index.js` | interactive CLI pipeline (CommonJS) | constructs both agents with `GEMINI_API_KEY` |

## Target architecture

```
index.js (ESM CLI)
  └─ start({ agents: [CommunityAnalyst, AssignmentGenerator, AssignmentRefiner, WCLExplorer],
             db: sqlite('./.cache/flue.db') })
       └─ init(Agent, { id }) → dispatch(msg, { initialData }) → read(receipt)

src/agents/  ('use agent' modules, TypeScript, run natively via Node 26 type stripping)
  community-analyst.ts   → free-text summary; model reads reply.text
  assignment-generator.ts → structured JSON via tool input schema + useDataWriter
  assignment-refiner.ts   → same shape, single-shot per feedback turn
  wcl-explorer.ts         → tool agent; runtime owns the tool-call loop

src/services/wcl.js  → add a shared singleton getter (tool + CLI use one authenticated instance)
src/utils/retry.js   → deleted (Flue runtime owns model retries/backoff)
```

### Construct mapping

| `@google/genai` construct | Flue replacement |
|---|---|
| `new GoogleGenAI({ apiKey })` | nothing — `useModel('provider/model-id')`; runtime owns auth/streaming/retries |
| `models.generateContent({ model, contents, config: { responseSchema } })` | agent + `useTool(submit_assignments)` where the **tool input schema** (Valibot) validates the model's JSON, and `run()` writes it via `useDataWriter('assignments', schema)` |
| `chats.create` + manual `functionCalls`/`functionResponse` loop | `defineTool({ name, input: v.object({...}), run })` + `useTool(...)` — the loop is automatic |
| `systemInstruction` | the agent function's return string (system prompt) |
| `withRetry(...)` in `src/utils/retry.js` | delete — retries are the runtime's job |
| `response.text` | `reply.text` |
| `JSON.parse(response.text)` | `reply.data['assignments'][0]` (validated, no parse) |

### Structured output pattern (generator / refiner)

The model constructs the assignment array as **tool-call arguments**; Valibot validates the shape
(schema guarantee, same role as Gemini's `responseSchema`); the tool durably writes it to the
`assignments` data channel; the CLI reads it from `reply.data.assignments[0]`.

```ts
// src/agents/assignment-generator.ts
'use agent';
import { useDataWriter, useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';

export function AssignmentGenerator() {
  useModel(process.env.MODEL_GENERATE ?? 'google/gemini-2.5-flash');
  const writeAssignments = useDataWriter('assignments', { schema: v.array(assignmentSchema) });
  const { timeline, roleMappings, skillsData, communityStrategy } = useInitialData();

  useTool({
    name: 'submit_assignments',
    description: 'Submit the final assignment matrix for the encounter.',
    input: v.array(assignmentSchema),
    async run({ data }) {
      writeAssignments(data);
      return { output: `Saved ${data.length} assignments.` };
    },
  });

  return `You are an expert WoW: MoP raid leader... Timeline/roster/skills/strategy are provided at
  creation. When you have the full assignment matrix, call submit_assignments.`;
}
AssignmentGenerator.initialData = v.object({ timeline: v.unknown(), roleMappings: v.unknown(), skillsData: v.unknown(), communityStrategy: v.string() });
```

### Tool agent (WCL Explorer)

```ts
// src/agents/wcl-explorer.ts
'use agent';
import { useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { getWCLService } from '../services/wcl.ts';

export function WCLExplorer() {
  useModel(process.env.MODEL_EXPLORER ?? 'opencode-go/deepseek-v4-flash');
  useTool({
    name: 'execute_wcl_query',
    description: 'Executes a GraphQL query against the Warcraft Logs v2 API...',
    input: v.object({ query: v.string(), variables: v.string() }),
    async run({ data }) {
      const wcl = getWCLService();
      try {
        return { output: { ok: true, data: await wcl.executeQuery(data.query, JSON.parse(data.variables ?? '{}')) } };
      } catch (e) {
        return { output: { ok: false, error: e.message, code: e.code ?? 'UNKNOWN' } };
      }
    },
  });
  return 'You are an expert WoW combat log analyst. Construct valid WCL v2 GraphQL queries...';
}
```

The error-return (not throw) preserves today's "model sees the error and retries a corrected query"
behavior; the runtime drives the loop.

## Milestones

Each milestone ends with a verification step before moving on.

### M1 — Scaffold
- `npm uninstall @google/genai`; `npm install @flue/runtime @flue/cli valibot`.
- `package.json`: `"type": "module"`; scripts `start: node index.js`.
- New `tsconfig.json` (type-stripping-safe: `erasableSyntaxOnly`, `verbatimModuleSyntax`,
  `allowImportingTsExtensions`, `noEmit`).
- Convert CJS → ESM: `src/services/wcl.js`, `src/services/raidhelper.js`,
  `src/utils/csv_formatter.js` (`module.exports` → `export`, `require` → `import`).
- **Verify:** hello-world agent `src/agents/hello.ts` runs via `npx flue run src/agents/hello.ts -m "hi"`
  using `GEMINI_API_KEY` (proves `google/gemini-2.5-flash` + key end-to-end).

### M2 — Port the AI layer (`src/agent.js` → 3 agents)
- `src/agents/community-analyst.ts` (free text).
- `src/agents/assignment-generator.ts` + `src/agents/assignment-refiner.ts` with the
  structured-output pattern above; extract `src/shared/assignments-schema.ts`.
- Delete `src/utils/retry.js` and its two imports.
- **Verify:** each agent smoke-tested via `flue run` with canned timeline/roles payloads;
  generator returns a valid `reply.data.assignments` array.

### M3 — Port the WCL Explorer (`src/wcl_explorer.js` → tool agent)
- `src/agents/wcl-explorer.ts` + shared `getWCLService()` singleton in `src/services/wcl.js`.
- Delete `src/wcl_explorer.js`.
- **Verify:** run against a real report code; the model iterates on a deliberately-wrong query
  and recovers via the tool-error path.

### M4 — Rewire the CLI (`index.js`)
- `start({ agents: [...], db: sqlite('./.cache/flue.db') })`; `await using` / `flue.stop()`.
- Pipeline steps → `init()`/`dispatch()`/`read()`:
  - community analyst: one instance per report id.
  - generator: one instance per report+fight (creation carries `initialData`).
  - interactive feedback: **fresh refiner instance per turn** (context-clean, matches today's
    single-shot refine); explorer keeps **one instance per CLI session** so follow-up questions
    retain context.
- Keep the menu, arg parsing, TSV writing, and `GEMINI_API_KEY` presence check unchanged.
- **Verify:** full dry run of the pipeline with a real report code + a couple of feedback turns
  and one explorer question; restart mid-session and confirm sqlite continues the conversation.

### M5 — OpenCode Go integration
- Add `OPENCODE_API_KEY=<user-provided value>` to `.env` (user pastes from their opencode auth).
- Defaults already route the explorer to `opencode-go/deepseek-v4-flash`; add
  `MODEL_GENERATE`/`MODEL_EXPLORER` to `.env.example`.
- **Verify:** explorer runs on the opencode key; `flue run` with `MODEL_EXPLORER=opencode-go/deepseek-v4-flash`.

### M6 — Cleanup & docs
- Update `.env.example`, `README.md` (architecture/env section), `AGENTS.md` if needed.
- `git add` the plan, commit.

## Env changes

```env
# .env (additions)
OPENCODE_API_KEY=sk-...            # OpenCode Go key (user-provided)
MODEL_GENERATE=google/gemini-2.5-flash
MODEL_EXPLORER=opencode-go/deepseek-v4-flash
```

## Risks / notes

- **Node 26 type stripping**: agents are `.ts` with erasable syntax only (no enums/namespaces) —
  the codebase needs none.
- **OpenCode Go key value**: the user must paste it into `.env` (not readable from this machine).
- **Text-only model**: `deepseek-v4-flash` accepts text only — fine here (no image inputs today).
- **Refiner context**: kept single-shot per turn intentionally; a multi-turn refiner chat is a
  possible follow-up (needs persistent-state sync of assignments).
- **Cost**: generation stays on `gemini-2.5-flash`; explorer on `deepseek-v4-flash`. Both are
  cheap; swap via env anytime.

## Out of scope

- Vite/Hono server, deployment, channels, sandboxes, subagents, MCP — none needed for this CLI.
