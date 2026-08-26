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
import assert from 'node:assert';

import { createProgram } from '../../src/cli.ts';
import type { Handlers } from '../../src/cli.ts';

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

test('mappings requires --encounter (exit 1)', () => {
  const { error } = run(['mappings']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /required option '-e, --encounter <name\|id>' not specified/);
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

test('unknown command errors with exit 1', () => {
  const { error } = run(['frobnicate']);
  assert.equal(error.exitCode, 1);
  assert.match(error.message, /unknown command 'frobnicate'/);
});

test('root help lists every operation subcommand', () => {
  const { handlers } = makeHandlers();
  const help = createProgram(handlers).helpInformation();
  for (const cmd of ['timeline', 'mappings', 'community', 'generate', 'run', 'review', 'refine', 'explore']) {
    assert.match(help, new RegExp(`\\b${cmd}\\b`));
  }
});