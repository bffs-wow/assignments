import { test } from 'node:test';
import assert from 'node:assert';

import { runMenu, reviewCommit, renderTable } from '../../src/interactive.ts';
import type { MenuIO, Ops, OpResult } from '../../src/interactive.ts';

// Scripted IO: answers are consumed one prompt at a time; prints are collected.
function fakeIo(answers: string[], { isTTY = false }: { isTTY?: boolean } = {}): MenuIO & { printed: string[] } {
  const printed: string[] = [];
  const io = {
    isTTY,
    printed,
    prompt: async () => answers.shift() ?? Promise.reject(new Error('no more answers scripted')),
    print: (text = '') => printed.push(String(text)),
  };
  return io;
}

// A set of ops that record their invocations; generate/refine return canned results.
function fakeOps(overrides: Partial<Ops> = {}): { base: Ops; calls: any[] } {
  const calls: any[] = [];
  const base: Ops = {
    mappings: async (opts) => { calls.push(['mappings', opts]); return { roleMappings: { TANK1: { name: 'Bob' } } }; },
    timeline: async (opts) => { calls.push(['timeline', opts]); return { timeline: [] }; },
    community: async (opts) => { calls.push(['community', opts]); return { strategy: '# strategy\nspread out' }; },
    generate: async (opts) => { calls.push(['generate', opts]); return { assignments: [{ event: 'Dance', occurrence: 1, roleTag: 'TANK1', spellName: 'Smash', timingOffset: 2, notes: '', spellId: '1' }], roleMappings: { TANK1: { name: 'Bob' } } }; },
    run: async (opts) => { calls.push(['run', opts]); return { assignments: [{ event: 'Dance', occurrence: 1, roleTag: 'TANK1', spellName: 'Smash', timingOffset: 2, notes: '', spellId: '1' }], roleMappings: { TANK1: { name: 'Bob' } } }; },
    review: async (opts) => { calls.push(['review', opts]); return { assignments: [{ event: 'Dance', occurrence: 1, roleTag: 'TANK1', spellName: 'Smash', timingOffset: 2, notes: '', spellId: '1' }], roleMappings: { TANK1: { name: 'Bob' } } }; },
    refine: async (opts) => { calls.push(['refine', opts]); return { assignments: [{ event: 'Move', occurrence: 1, roleTag: 'TANK1', spellName: 'Smash', timingOffset: 3, notes: '', spellId: '1' }], roleMappings: { TANK1: { name: 'Bob' } } }; },
    explore: async (opts) => { calls.push(['explore', opts]); return { answer: 'The boss cast Smash 3 times.' }; },
    commit: async (result: OpResult) => { calls.push(['commit', result.assignments?.length]); },
    writeFiles: async (result: OpResult) => { calls.push(['writeFiles', result.assignments?.length]); },
    ...overrides,
  };
  return { base, calls };
}

test('menu prompts for a timeline op params, runs it, and loops until exit (TTY)', async () => {
  const io = fakeIo(['2', 'R', '4', 'exit'], { isTTY: true });
  const { base, calls } = fakeOps();
  await runMenu({ io, ops: base, ctx: { stateDir: '/tmp/state' }, onResult: () => {} });

  assert.ok(calls.some(([name, opts]) => name === 'timeline' && opts.report === 'R' && opts.fight === 4));
  assert.ok(calls.some(([name]) => name === 'commit') === false, 'no commit in menu-only flow');
  assert.ok(io.printed.some((p) => p.includes('Raid Assignment Tool'))); // menu header shown repeatedly
  assert.ok(io.printed.some((p) => p.includes('Bye')));
});

test('generate runs, then enters the review/commit sub-process on a TTY', async () => {
  const io = fakeIo(['4', '1', '5', 'exit'], { isTTY: true });
  const { base, calls } = fakeOps();
  await runMenu({ io, ops: base, ctx: { stateDir: '/tmp/state' }, onResult: () => {} });

  assert.ok(calls.some(([name]) => name === 'generate'), 'generate should run');
  assert.ok(io.printed.some((p) => /Bob/.test(p)), 'table printed for review in console');
  assert.ok(calls.some(([name]) => name === 'commit') === false, 'no commit without explicit choice');
  assert.ok(io.printed.some((p) => p.includes('Bye')), 'menu exited at the end');
});

test('non-TTY invocation writes files and exits without the review loop', async () => {
  const io = fakeIo(['5'], { isTTY: false });
  const calls: any[] = [];
  const ops = {
    run: async () => { calls.push(['run']); return { assignments: [], roleMappings: {} }; },
    commit: async () => calls.push(['commit']),
  } as unknown as Ops;
  await runMenu({ io, ops, ctx: { stateDir: '/tmp/state' }, onResult: () => {} });

  assert.ok(calls.some(([name]) => name === 'run'), 'run was invoked explicitly');
  assert.ok(calls.some(([name]) => name === 'commit'), 'non-TTY commits artifacts before exiting');
  assert.ok(io.printed.some((p) => p.includes('Bye')), 'exits after finishing the operation');
});

test('review/commit sub-process: write files, suggest changes, commit, back', async () => {
  const io = fakeIo(['2', '4', 'F', '3', '5'], { isTTY: true });
  const calls: any[] = [];
  const ops = {
    writeFiles: async (r: OpResult) => calls.push(['writeFiles', r.roleMappings ? 1 : 0]),
    refine: async (opts: Record<string, unknown>) => { calls.push(['refine', opts.feedback]); return { assignments: [], roleMappings: {} }; },
    commit: async (r: OpResult) => calls.push(['commit', r.roleMappings ? 1 : 0]),
  } as unknown as Ops;
  await reviewCommit({
    io,
    ops,
    result: { assignments: [], roleMappings: {} },
    ctx: { stateDir: '/tmp/state' },
    onBack: () => {},
  });

  assert.ok(calls.some(([name, v]) => name === 'writeFiles' && v === 1));
  assert.ok(calls.some(([name, v]) => name === 'refine' && v === 'F'), 'suggest changes prompted for feedback and refined');
  assert.ok(calls.some(([name, v]) => name === 'commit' && v === 1), 'committed the refined result');
});

test('renders a readable table row per assignment with player names', () => {
  const table = renderTable([
    { event: 'Dance', occurrence: 1, roleTag: 'TANK1', spellName: 'Smash', timingOffset: 2, notes: '', spellId: '1' },
  ], { TANK1: { name: 'Bob' } });
  assert.match(table, /Bob/);
  assert.match(table, /Dance/);
  assert.match(table, /Smash/);
});