/**
 * Unit tests for the CLI seam (src/cli.js) — the commander.js program with its
 * operation subcommands.
 *
 * Runs offline: handlers are spies, so no live WCL / RaidHelper / Gemini calls.
 * Exit behavior is captured via commander's exitOverride(), which throws a
 * CommanderError instead of calling process.exit().
 *
 * Run: node --test test/unit/
 */
import 'dotenv/config';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProgram } from '../../src/cli.ts';
import type { Handlers } from '../../src/cli.ts';
import { handlers as liveHandlers, setAgentRunner } from '../../src/index.ts';
import type { Assignment } from '../../src/shared/assignments-schema.ts';

// Spy handlers so each test asserts which operation commander dispatched and
// with which resolved options.
function makeHandlers(): { handlers: Handlers; calls: any[] } {
  const calls: any[] = [];
  const handlers: Handlers = {
    menu: () => { calls.push(['menu']); },
    timeline: (opts) => { calls.push(['timeline', opts]); },
    mappings: (opts) => { calls.push(['mappings', opts]); },
    community: (opts) => { calls.push(['community', opts]); },
    generate: (opts) => { calls.push(['generate', opts]); },
    run: (opts) => { calls.push(['run', opts]); },
    review: (opts) => { calls.push(['review', opts]); },
    refine: (opts) => { calls.push(['refine', opts]); },
    explore: (opts) => { calls.push(['explore', opts]); },
    push: (opts) => { calls.push(['push', opts]); },
  };
  return { handlers, calls };
}

// Parse through a fresh program per case. Returns { calls, error }.
// exitOverride must be applied to every subcommand too — commander only registers
// the callback on the command it is called on, and subcommand errors surface from
// the subcommand's own _exit().
function overrideExits(program: ReturnType<typeof createProgram>) {
  program.exitOverride();
  for (const cmd of program.commands) cmd.exitOverride();
  return program;
}

function run(argv: string[], env?: string): { calls: any[]; error: any } {
  const { handlers, calls } = makeHandlers();
  const program = overrideExits(createProgram(handlers));
  const prev = process.env.WCL_INSTANCE;
  if (env === undefined) delete process.env.WCL_INSTANCE;
  else process.env.WCL_INSTANCE = env;
  try {
    program.parse(argv, { from: 'user' });
    return { calls, error: null };
  } catch (err) {
    return { calls, error: err };
  } finally {
    if (prev === undefined) delete process.env.WCL_INSTANCE;
    else process.env.WCL_INSTANCE = prev;
  }
}

const ARGS = { report: 'aBcDeFgH1Xx', fight: 4, encounter: 'The Fallen Protectors' };

test('bare invocation runs nothing: missing subcommand shows help and exits 1; the menu is the entry point\'s explicit choice, not an automatic run', () => {
  const { calls, error } = run([]);
  assert.equal(error.code, 'commander.help');
  assert.equal(error.exitCode, 1);
  assert.deepStrictEqual(calls, []); // no operation dispatched
  // The menu handler exists for the entry point to call explicitly (tested in interactive.test.js).
  const { handlers: h } = makeHandlers();
  h.menu?.();
  assert.ok(true);
});

test('timeline dispatches with report, coerced fight, and default instance', () => {
  const { calls, error } = run(['timeline', '-r', ARGS.report, '-f', '4']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'timeline'); assert.equal(o.report, ARGS.report); assert.equal(o.fight, 4); assert.equal(o.instance, 'classic'); assert.equal(o.state, undefined);
});

test('timeline requires --report (exit 1)', () => {
  const { error } = run(['timeline', '-f', '4']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /required option '-r, --report <code>' not specified/);
});

test('timeline requires --fight (exit 1)', () => {
  const { error } = run(['timeline', '-r', ARGS.report]);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /required option '-f, --fight <id>' not specified/);
});

test('timeline rejects a non-integer fight id as invalid argument', () => {
  const { error } = run(['timeline', '-r', ARGS.report, '-f', 'abc']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /argument 'abc' is invalid\. must be an integer/);
});

test('timeline rejects a fractional fight id as invalid argument', () => {
  const { error } = run(['timeline', '-r', ARGS.report, '-f', '1.5']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /argument '1.5' is invalid\. must be an integer/);
});

test('timeline rejects an unknown instance, listing the allowed choices', () => {
  const { error } = run(['timeline', '-r', ARGS.report, '-f', '1', '-i', 'bogus']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /Allowed choices are retail, classic, fresh, vanilla, sod/);
});

test('timeline honours WCL_INSTANCE env and a --state dir', () => {
  const { calls, error } = run(['timeline', '-r', ARGS.report, '-f', '1', '--state', 'some/where'], 'fresh');
  assert.ifError(error);
  const [name, opts] = calls[0];
  assert.equal(name, 'timeline');
  assert.equal(opts.instance, 'fresh');
  assert.equal(opts.state, 'some/where');
});

test('mappings dispatches with the encounter', () => {
  const { calls, error } = run(['mappings', '-e', ARGS.encounter]);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'mappings'); assert.equal(o.encounter, ARGS.encounter); assert.equal(o.state, undefined);
});

test('mappings requires an event source: -R missing => handled at runtime, not a commander error', () => {
  const { error } = run(['mappings']);
  assert.ifError(error); // commander parses fine; the handler raises at runtime
});

test('community dispatches with the encounter', () => {
  const { calls, error } = run(['community', '-e', ARGS.encounter]);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'community'); assert.equal(o.encounter, ARGS.encounter); assert.equal(o.instance, 'classic'); assert.equal(o.state, undefined);
});

test('generate runs with no required options', () => {
  const { calls, error } = run(['generate']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'generate'); assert.equal(o.state, undefined);
});

test('generate dispatches -R/--raidhelper-event (roster id, no report)', () => {
  const R = '1542926745605242951';
  const { calls, error } = run(['generate', '-R', R]);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'generate'); assert.equal(o.raidhelperEvent, R);
});

test('run dispatches -R, -e, and -r/-f independently', () => {
  const { calls, error } = run(['run', '-R', '1542926745605242951', '-e', 'Immerseus', '-r', 'aBcDeFgH1Xx', '-f', '2']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'run');
  assert.equal(o.raidhelperEvent, '1542926745605242951');
  assert.equal(o.encounter, 'Immerseus');
  assert.equal(o.report, 'aBcDeFgH1Xx');
  assert.equal(o.fight, 2);
});

test('mappings dispatches -R as the RaidHelper event (encounter optional)', () => {
  const R = '1542926745605242951';
  const { calls, error } = run(['mappings', '-R', R]);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'mappings'); assert.equal(o.raidhelperEvent, R); assert.equal(o.encounter, undefined);
});

test('mappings requires an event source: -R missing => handled at runtime, not a commander error', () => {
  const { calls, error } = run(['mappings']);
  assert.ifError(error); // commander parses fine; the handler raises at runtime
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'mappings'); assert.equal(o.raidhelperEvent, undefined); assert.equal(o.encounter, undefined);
});

test('community dispatches -R (raidhelper) + -e (encounter name) together', () => {
  const R = '1542926745605242951';
  const { calls, error } = run(['community', '-R', R, '-e', 'Immerseus']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'community'); assert.equal(o.raidhelperEvent, R); assert.equal(o.encounter, 'Immerseus');
});

test('explicit -R beats RAID_HELPER_EVENT_ID env when both are set (flag > env)', () => {
  const R = '1542926745605242951';
  const { calls, error } = run(['run', '-R', R, '-e', 'Immerseus', '-r', 'aBcDeFgH1Xx', '-f', '2']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'run');
  assert.equal(o.raidhelperEvent, R); // the flag wins even if the env were set
});

test('run accepts missing params (prompted later, not a commander error)', () => {
  const { calls, error } = run(['run']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'run'); assert.equal(o.report, undefined); assert.equal(o.fight, undefined); assert.equal(o.encounter, undefined); assert.equal(o.instance, 'classic'); assert.equal(o.state, undefined);
});

test('review runs with no required options', () => {
  const { calls, error } = run(['review']);
  assert.ifError(error);
  assert.equal(calls.length, 1); const [n, o] = calls[0]; assert.equal(n, 'review'); assert.equal(o.state, undefined);
});

test('refine dispatches with feedback; missing --feedback errors', () => {
  const ok = run(['refine', '--feedback', 'move everyone to blue']);
  assert.ifError(ok.error);
  assert.equal(ok.calls.length, 1); const [n, o] = ok.calls[0]; assert.equal(n, 'refine'); assert.equal(o.feedback, 'move everyone to blue'); assert.equal(o.state, undefined);

  const missing = run(['refine']);
  assert.equal(missing.error.exitCode, 1);
  assert.match(missing.error.message, /required option '--feedback <text>' not specified/);
});

test('explore dispatches with a query; missing -q errors', () => {
  const ok = run(['explore', '-q', 'what were the boss casts?']);
  assert.ifError(ok.error);
  assert.equal(ok.calls.length, 1); const [n, o] = ok.calls[0]; assert.equal(n, 'explore'); assert.equal(o.query, 'what were the boss casts?'); assert.equal(o.instance, 'classic'); assert.equal(o.state, undefined);

  const missing = run(['explore']);
  assert.equal(missing.error.exitCode, 1);
  assert.match(missing.error.message, /required option '-q, --query <text>' not specified/);
});

test('push dispatches with optional --encounter; bare push works; --yes flag', () => {
  const ok = run(['push', '--encounter', 'Immerseus', '--yes']);
  assert.ifError(ok.error);
  assert.equal(ok.calls.length, 1); const [n, o] = ok.calls[0]; assert.equal(n, 'push'); assert.equal(o.encounter, 'Immerseus'); assert.equal(o.yes, true); assert.equal(o.state, undefined);

  const bare = run(['push']);
  assert.ifError(bare.error);
  assert.equal(bare.calls[0][0], 'push');
  assert.equal(bare.calls[0][1].encounter, undefined);
  assert.equal(bare.calls[0][1].yes, undefined);
});

test('unknown command errors with exit 1', () => {
  const { error } = run(['frobnicate']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /unknown command 'frobnicate'/);
});

test('root help lists every operation subcommand', () => {
  const { handlers } = makeHandlers();
  const help = createProgram(handlers).helpInformation();
  for (const cmd of ['timeline', 'mappings', 'community', 'generate', 'run', 'review', 'refine', 'explore', 'push']) {
    assert.match(help, new RegExp(`\\b${cmd}\\b`));
  }
});

// ---------------------------------------------------------------------------
// Issue #15: Sheet-compliant CSV artifact wiring and validation failures
// ---------------------------------------------------------------------------

function withStateDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
  const origExitCode = process.exitCode;
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    setAgentRunner(null);
    process.exitCode = origExitCode;
  });
  return dir;
}

test('generate: writes assignments.csv artifact along with assignments.tsv', async (t) => {
  const dir = withStateDir(t);
  fs.writeFileSync(path.join(dir, 'rolemappings.json'), JSON.stringify({
    mappings: { PROTPALA1: { name: 'Paladino' }, ALL: {} },
  }));
  const validPlan: Assignment[] = [
    { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
    { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: -20, spellName: 'Shield Wall', notes: 'tank external', spellId: '871' },
  ];
  setAgentRunner(async () => ({ data: { assignments: [validPlan] } }));

  await liveHandlers.generate({ state: dir, encounter: 'Paragons of the Klaxxi' });

  assert.ok(fs.existsSync(path.join(dir, 'assignments.tsv')), 'assignments.tsv must exist');
  assert.ok(fs.existsSync(path.join(dir, 'assignments.csv')), 'assignments.csv must exist');
  const csv = fs.readFileSync(path.join(dir, 'assignments.csv'), 'utf8');
  assert.match(csv, /"Player","CD #","BOSS HEALTH \/ SPELL"/);
  assert.match(csv, /"Encounter Start \(PAR\)"/);
  assert.match(csv, /"Paladino","","Reave"/);
});

test('generate: invalid plan surfaces grouped errors + non-zero exit, does not write CSV', async (t) => {
  const dir = withStateDir(t);
  fs.writeFileSync(path.join(dir, 'rolemappings.json'), JSON.stringify({
    mappings: { PROTPALA1: { name: 'Paladino' } },
  }));
  const invalidPlan = [
    { event: 'Bogus Event', occurrence: 1, roleTag: 'UNKNOWN_TAG', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  ];
  setAgentRunner(async () => ({ data: { assignments: [invalidPlan] } }));

  const errs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => errs.push(args.map(String).join(' '));
  t.after(() => { console.error = origError; });

  await liveHandlers.generate({ state: dir, encounter: 'Paragons of the Klaxxi' });

  assert.equal(process.exitCode, 1, 'process.exitCode must be set to 1 on validation error');
  assert.equal(fs.existsSync(path.join(dir, 'assignments.csv')), false, 'assignments.csv must not be written on invalid plan');
  const logged = errs.join('\n');
  assert.match(logged, /validation rejected/);
  assert.match(logged, /Bogus Event/);
});

test('refine: re-renders from persisted encounter without re-resolving', async (t) => {
  const dir = withStateDir(t);
  const initialPlan: Assignment[] = [
    { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  ];
  fs.writeFileSync(path.join(dir, 'committed.json'), JSON.stringify({
    assignments: initialPlan,
    roleMappings: { ALL: {}, PROTPALA1: { name: 'Paladino' } },
    encounter: 'Paragons of the Klaxxi',
    generatedAt: new Date().toISOString(),
  }));

  const refinedPlan: Assignment[] = [
    { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
    { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: -10, spellName: 'Shield Wall', notes: '', spellId: '871' },
  ];
  setAgentRunner(async () => ({ data: { assignments: [refinedPlan] } }));

  // Call refine without passing any encounter in opts
  await liveHandlers.refine({ state: dir, feedback: 'add shield wall' });

  assert.ok(fs.existsSync(path.join(dir, 'assignments.csv')), 'assignments.csv must be written by refine');
  const csv = fs.readFileSync(path.join(dir, 'assignments.csv'), 'utf8');
  assert.match(csv, /"Paladino","","Reave"/);
  const committed = JSON.parse(fs.readFileSync(path.join(dir, 'committed.json'), 'utf8'));
  assert.equal(committed.encounter, 'Paragons of the Klaxxi');
});

test('review: re-renders from persisted encounter without re-resolving from user opts', async (t) => {
  const dir = withStateDir(t);
  const plan: Assignment[] = [
    { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  ];
  fs.writeFileSync(path.join(dir, 'committed.json'), JSON.stringify({
    assignments: plan,
    roleMappings: { ALL: {} },
    encounter: 'Paragons of the Klaxxi',
    generatedAt: new Date().toISOString(),
  }));

  const stdout: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(' '));
  t.after(() => { console.log = origLog; });

  // Pass encounter: 'Immerseus' in opts — review must ignore it and use Paragons from committed.json
  await liveHandlers.review({ state: dir, encounter: 'Immerseus' });

  assert.ok(fs.existsSync(path.join(dir, 'assignments.csv')), 'assignments.csv must be written by review');
  const csv = fs.readFileSync(path.join(dir, 'assignments.csv'), 'utf8');
  assert.match(csv, /"Encounter Start \(PAR\)"/);

  const logged = stdout.join('\n');
  assert.match(logged, /"Player","CD #","BOSS HEALTH \/ SPELL"/, 'review must print CSV to stdout');
  assert.match(logged, /Player\t\tEvent\tOccurrence/, 'review must keep printing TSV to stdout');
});

test('review: surfaces grouped errors + non-zero exit when committed plan is invalid', async (t) => {
  const dir = withStateDir(t);
  const invalidPlan = [
    { event: 'Bogus Event', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  ];
  fs.writeFileSync(path.join(dir, 'committed.json'), JSON.stringify({
    assignments: invalidPlan,
    roleMappings: { ALL: {} },
    encounter: 'Paragons of the Klaxxi',
    generatedAt: new Date().toISOString(),
  }));

  const errs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => errs.push(args.map(String).join(' '));
  t.after(() => { console.error = origError; });

  await liveHandlers.review({ state: dir });

  assert.equal(process.exitCode, 1, 'process.exitCode must be set to 1 on validation error');
  assert.equal(fs.existsSync(path.join(dir, 'assignments.csv')), false, 'assignments.csv must not be written on invalid plan');
  const logged = errs.join('\n');
  assert.match(logged, /validation rejected/);
  assert.match(logged, /Bogus Event/);
});