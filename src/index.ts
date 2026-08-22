import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';

import RaidHelperService from './services/raidhelper.ts';
import WCLService from './services/wcl.ts';
import CSVFormatter from './utils/csv_formatter.ts';
import { createProgram } from './cli.ts';
import type { Handlers, CliOptions } from './cli.ts';
import { resolveRoleMappings } from './shared/roster-roles.ts';
import type { RoleMappings } from './shared/roster-roles.ts';
import type { TimelineEvent } from './services/wcl.ts';
import type { Assignment } from './shared/assignments-schema.ts';
import { CommunityAnalyst } from './agents/community-analyst.ts';
import { AssignmentGenerator } from './agents/assignment-generator.ts';
import { AssignmentRefiner } from './agents/assignment-refiner.ts';
import { WCLExplorer } from './agents/wcl-explorer.ts';

// ---------------------------------------------------------------------------
// State dir + small JSON helpers (artifacts land in .cache/cli by default)
// ---------------------------------------------------------------------------
const DEFAULT_STATE = path.join(process.cwd(), '.cache', 'cli');
const resolveState = (dir: string | undefined): string => dir || DEFAULT_STATE;
const readJSON = (dir: string, file: string): any => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { return null; }
};
const writeJSON = (dir: string, file: string, data: unknown): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
};
const isPlaceholder = (v: string | undefined): boolean => !v || /your_/i.test(v);

// ---------------------------------------------------------------------------
// Prompt plumbing (works for interactive terminals AND piped stdin)
// ---------------------------------------------------------------------------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const inputLines: string[] = [];
let inputDone = false;
let pendingPrompt: ((line: string | null) => void) | null = null;
rl.on('line', (line) => {
  if (pendingPrompt) { const r = pendingPrompt; pendingPrompt = null; r(line); } else inputLines.push(line);
});
rl.on('close', () => {
  inputDone = true;
  if (pendingPrompt) { const r = pendingPrompt; pendingPrompt = null; r(null); }
});
// null => EOF (piped run had no more input)
function promptUser(query: string): Promise<string | null> {
  process.stdout.write(query);
  if (inputLines.length > 0) return Promise.resolve(inputLines.shift() ?? null);
  if (inputDone) return Promise.resolve(null);
  return new Promise((resolve) => { pendingPrompt = resolve; });
}

// ---------------------------------------------------------------------------
// Services + Flue runtime
// ---------------------------------------------------------------------------
const rhService = () => new RaidHelperService(process.env.RAID_HELPER_API_KEY);
const wclService = (instance?: string) => new WCLService(
  process.env.WCL_CLIENT_ID, process.env.WCL_CLIENT_SECRET, { instance },
);

const runAgent = async (handle: any, message: string, initialData?: unknown): Promise<any> => {
  const receipt = await handle.dispatch(initialData === undefined ? message : { message, initialData });
  return handle.read(receipt);
};

// COMMUNITY_RANKS env: "100-500" => mid-tier average-guild kills.
function communityRanks(): { rankStart: number | null; rankEnd: number | null } {
  const v = process.env.COMMUNITY_RANKS;
  if (!v) return { rankStart: null, rankEnd: null };
  const m = v.match(/^(\d*)\s*-\s*(\d+)$/);
  return m ? { rankStart: m[1] ? Number(m[1]) : null, rankEnd: Number(m[2]) } : { rankStart: null, rankEnd: null };
}

// ---------------------------------------------------------------------------
// Artifact-producing steps (shared by subcommands, `run` and the bare menu)
// ---------------------------------------------------------------------------
async function stepMappings(opts: { encounter?: string; state?: string }): Promise<RoleMappings> {
  const { encounter, state } = opts;
  const rosterEventId = encounter || process.env.RAID_HELPER_EVENT_ID;
  if (!rosterEventId) throw new Error('no RaidHelper event id — pass -e or set RAID_HELPER_EVENT_ID');
  const roster = await rhService().getEventRoster(rosterEventId);
  const { mappings, unmapped } = resolveRoleMappings(roster);
  writeJSON(resolveState(state), 'rolemappings.json', { eventId: rosterEventId, mappings, roster });
  console.log(`Mapped ${Object.keys(mappings).length} players to sheet roles (RaidHelper event ${rosterEventId}):`);
  for (const [tag, info] of Object.entries(mappings)) {
    console.log(`  ${tag.padEnd(12)} ${info.name}  (${info.className || '?'}/${info.specName || '?'})`);
  }
  const unresolved = unmapped.filter((p) => !['Bench', 'Absence', 'Tentative'].includes(p.className ?? '') && p.status !== 'Absence');
  if (unresolved.length) {
    console.log('\nUnresolved (in roster, not mapped) — add a pin in src/shared/roster-roles.ts ROSTER_ROLE_OVERRIDES:');
    for (const p of unresolved) {
      console.log(`  ${p.name}  (${p.className || '?'}/${p.specName || '?'})  [${p.status || ''}]`);
    }
  }
  console.log(`\n  -> ${path.join(resolveState(state), 'rolemappings.json')}`);
  return mappings;
}

async function stepTimeline(opts: { report?: string; fight?: string | number; instance?: string; state?: string }): Promise<TimelineEvent[]> {
  const { report, fight, instance, state } = opts;
  if (!report || !fight) throw new Error('timeline needs -r/--report and -f/--fight');
  const wcl = wclService(instance);
  const timeline = await wcl.getEncounterEvents(report, fight);
  writeJSON(resolveState(state), 'timeline.json', { report, fight, timeline });
  console.log(`Fetched ${timeline.length} encounter events (${timeline.filter(e => e.type === 'cast').length} boss casts).`);
  return timeline;
}

async function stepCommunity(opts: { encounter?: string; instance?: string; state?: string }): Promise<string> {
  const { encounter, instance, state } = opts;
  if (!encounter) throw new Error('community needs -e/--encounter');
  const { rankStart, rankEnd } = communityRanks();
  const wcl = wclService(instance);
  const communityLogs = await wcl.getCommunityPulls(encounter, { rankStart, rankEnd, maxPulls: 6 });
  const band = rankEnd ? ` (ranks ${rankStart ?? 1}..${rankEnd})` : '';
  console.log(`Analysing ${communityLogs.length} community kill pull(s)${band}...`);
  const community = init(CommunityAnalyst, { id: `community-${encounter}-${Date.now()}` });
  const reply = await runAgent(community, JSON.stringify(communityLogs));
  writeJSON(resolveState(state), 'community.json', { encounter, communityLogs, communityStrategy: reply.text });
  console.log(`\nCommunity strategy:\n${reply.text}\n`);
  return reply.text;
}

async function stepGenerate(opts: { state?: string }, { initial = null }: { initial?: unknown } = {}): Promise<Assignment[]> {
  const dir = resolveState(opts.state);
  const roleMappings = readJSON(dir, 'rolemappings.json')?.mappings ?? {};
  const timeline = readJSON(dir, 'timeline.json')?.timeline ?? null;
  const community = readJSON(dir, 'community.json');
  if (!Object.keys(roleMappings).length) throw new Error('no rolemappings — run `mappings` first');
  if (!timeline) throw new Error('no timeline — run `timeline` first');

  const skillsData = JSON.parse(fs.readFileSync(new URL('../src/data/mop_skills.json', import.meta.url), 'utf8'));
  const generator = init(AssignmentGenerator, { id: `generate-${Date.now()}` });
  const reply = await runAgent(generator, 'Generate the raid cooldown assignment matrix for this encounter.', {
    timeline, roleMappings, skillsData, communityStrategy: community?.communityStrategy ?? '',
  });
  const assignments = reply.data?.assignments?.[0];
  if (!Array.isArray(assignments)) throw new Error('AssignmentGenerator did not submit assignments');

  writeJSON(dir, 'committed.json', { assignments, roleMappings, generatedAt: new Date().toISOString() });
  const tsv = `${CSVFormatter.formatToTSV(assignments, roleMappings)}\n`;
  fs.writeFileSync(path.join(dir, 'assignments.tsv'), tsv);
  console.log(`Generated ${assignments.length} assignments.\n-> ${path.join(dir, 'assignments.tsv')}`);
  console.log(tsv);
  return assignments;
}

async function stepRefine(opts: { state?: string }, feedback: string): Promise<Assignment[]> {
  const dir = resolveState(opts.state);
  const committed = readJSON(dir, 'committed.json');
  if (!committed) throw new Error('no committed assignments — run `generate` first');
  const refiner = init(AssignmentRefiner, { id: `refine-${Date.now()}` });
  const reply = await runAgent(refiner, 'Apply the raid leader feedback.', {
    currentAssignments: committed.assignments, humanFeedback: feedback,
  });
  const assignments = reply.data?.assignments?.[0];
  if (!Array.isArray(assignments)) throw new Error('Refiner did not submit assignments');
  writeJSON(dir, 'committed.json', { assignments, roleMappings: committed.roleMappings, generatedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(dir, 'assignments.tsv'), `${CSVFormatter.formatToTSV(assignments, committed.roleMappings)}\n`);
  console.log(`Refined to ${assignments.length} assignments.\n-> ${path.join(dir, 'assignments.tsv')}`);
  console.log(`${CSVFormatter.formatToTSV(assignments, committed.roleMappings)}\n`);
  return assignments;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// CLI handlers (createProgram contracts)
// ---------------------------------------------------------------------------
const handlers: Handlers = {
  mappings: async (opts: CliOptions) => { try { await stepMappings({ encounter: opts.encounter, state: opts.state }); } catch (e) { console.error('mappings failed:', errMsg(e)); process.exitCode = 1; } },
  timeline: async (opts: CliOptions) => { try { await stepTimeline(opts); } catch (e) { console.error('timeline failed:', errMsg(e)); process.exitCode = 1; } },
  community: async (opts: CliOptions) => { try { await stepCommunity(opts); } catch (e) { console.error('community failed:', errMsg(e)); process.exitCode = 1; } },
  generate: async (opts: CliOptions) => { try { await stepGenerate(opts); } catch (e) { console.error('generate failed:', errMsg(e)); process.exitCode = 1; } },
  run: async (opts: CliOptions) => {
    try {
      const { report, fight, encounter, instance, state } = opts;
      const r = report ?? (await promptUser('Report code: '));
      const f = fight ?? Number(await promptUser('Fight id: '));
      const e = encounter ?? (await promptUser('Encounter name/id: '));
      if (!r || !f || !e) throw new Error('report, fight and encounter are required (or set RAID_HELPER_EVENT_ID for the roster)');
      await stepMappings({ encounter: process.env.RAID_HELPER_EVENT_ID || e, state });
      await stepTimeline({ report: r, fight: f, instance, state });
      await stepCommunity({ encounter: e, instance, state });
      await stepGenerate({ state });
    } catch (err) { console.error('run failed:', err); process.exitCode = 1; }
  },
  review: async (opts: CliOptions) => {
    const committed = readJSON(resolveState(opts.state), 'committed.json');
    if (!committed) { console.error('no committed assignments'); process.exitCode = 1; return; }
    console.log(`${CSVFormatter.formatToTSV(committed.assignments, committed.roleMappings)}\n`);
  },
  refine: async (opts: CliOptions) => { try { await stepRefine(opts, opts.feedback); } catch (e) { console.error('refine failed:', errMsg(e)); process.exitCode = 1; } },
  explore: async (opts: CliOptions) => {
    try {
      const explorer = init(WCLExplorer, { id: `explorer-${Date.now()}` });
      const reply = await runAgent(explorer, opts.query);
      console.log(`\n[WCL Explorer Answer]:\n${reply.text}\n`);
    } catch (e) { console.error('explore failed:', errMsg(e)); process.exitCode = 1; }
  },
};

// ---------------------------------------------------------------------------
// Bare invocation => interactive menu (run, then refine/explore/exit)
// ---------------------------------------------------------------------------
async function interactiveMenu() {
  const base = { state: DEFAULT_STATE };
  try {
    const report = process.env.RAID_HELPER_REPORT || (await promptUser('Report code: '));
    const fight = process.env.RAID_HELPER_FIGHT ? Number(process.env.RAID_HELPER_FIGHT) : Number(await promptUser('Fight id: '));
    const encounter = process.env.RAID_HELPER_ENCOUNTER || (await promptUser('Encounter name/id: '));
    if (!report || !fight || !encounter) { console.log('Missing required inputs — aborting.'); return; }
    await stepMappings({ encounter: process.env.RAID_HELPER_EVENT_ID || encounter, state: DEFAULT_STATE });
    await stepTimeline({ report, fight, instance: 'classic', state: DEFAULT_STATE });
    await stepCommunity({ encounter, instance: 'classic', state: DEFAULT_STATE });
    await stepGenerate({ state: DEFAULT_STATE });

    while (true) {
      console.log('\n--- Interactive Mode ---');
      console.log('1. Refine assignments with feedback');
      console.log('2. Ask the WCL Explorer a question');
      console.log('3. Exit');
      const choice = (await promptUser('Select an option (1-3): ') ?? '3').trim();
      if (choice === '1') {
        const feedback = await promptUser('Enter your feedback/instructions: ');
        if (feedback) await stepRefine(base, feedback);
      } else if (choice === '2') {
        const query = await promptUser('Enter your WCL question: ');
        if (query) { const explorer = init(WCLExplorer, { id: `explorer-${Date.now()}` }); const r = await runAgent(explorer, query); console.log(`\n[Answer]:\n${r.text}\n`); }
      } else if (choice === '3' || /exit|quit/i.test(choice)) { console.log('Exiting. Final assignments are saved.'); break; }
    }
  } catch (e) { console.error('An error occurred:', errMsg(e)); }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
if (!isPlaceholder(process.env.OPENCODE_API_KEY) || !isPlaceholder(process.env.GEMINI_API_KEY)) {
  fs.mkdirSync(path.join(process.cwd(), '.cache'), { recursive: true });
  await start({ agents: [CommunityAnalyst, AssignmentGenerator, AssignmentRefiner, WCLExplorer], db: sqlite(path.join(process.cwd(), '.cache', 'flue.db')) });
}

const argv = process.argv;
if (argv.length <= 2) {
  await interactiveMenu();
} else {
  createProgram(handlers).parse(argv);
}
process.exitCode = process.exitCode || 0;
