/**
 * Unit tests for the artifact store (src/state.js).
 *
 * Artifacts are the JSON/markdown files through which CLI operations exchange
 * state (timeline, role mappings, community strategy, committed assignments).
 * All file I/O here runs against a throwaway temp dir.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import type { TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultStateDir,
  resolveStateDir,
  artifactPath,
  saveJson,
  loadJson,
  saveText,
  loadText,
  commitAssignments,
  StateError,
  ARTIFACTS,
} from '../../src/state.ts';
import type { Assignment } from '../../src/shared/assignments-schema.ts';

// One throwaway state dir per test, removed afterwards.
function withStateDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('default state dir is <cwd>/.cache/cli', () => {
  assert.equal(defaultStateDir(), path.join(process.cwd(), '.cache', 'cli'));
});

test('resolveStateDir honours --state and makes it absolute', () => {
  const dir = resolveStateDir({ state: 'some/where' });
  assert.equal(dir, path.resolve('some/where'));
  assert.equal(resolveStateDir({}), defaultStateDir());
});

test('artifactPath points into the state dir', (t) => {
  const dir = withStateDir(t);
  assert.equal(artifactPath(dir, ARTIFACTS.timeline), path.join(dir, 'timeline.json'));
});

test('saveJson/loadJson round-trip preserves data', (t) => {
  const dir = withStateDir(t);
  const data = { fights: [{ id: 4, name: 'The Fallen Protectors' }] };
  saveJson(dir, ARTIFACTS.timeline, data);
  assert.deepEqual(loadJson(dir, ARTIFACTS.timeline), data);
});

test('loadJson of a missing artifact throws a typed StateError naming the file', (t) => {
  const dir = withStateDir(t);
  assert.throws(
    () => loadJson(dir, ARTIFACTS.timeline),
    (err) => err instanceof StateError && err.code === 'MISSING_ARTIFACT' && /timeline\.json/.test(err.message),
  );
});

test('saveText/loadText round-trip (community strategy)', (t) => {
  const dir = withStateDir(t);
  const md = '# Strategy\n- spread out on smash';
  saveText(dir, ARTIFACTS.community, md);
  assert.equal(loadText(dir, ARTIFACTS.community), md);
});

test('commitAssignments writes the canonical artifact and a rendered TSV', (t) => {
  const dir = withStateDir(t);
  const roleMappings = { TANK1: { name: 'Bob' }, HEAL1: { name: 'Alice' } };
  const assignments = [
    { roleTag: 'TANK1', event: 'Dance', occurrence: 1, spellName: 'Smash', notes: 'move out', spellId: '12345', timingOffset: 2 },
    { roleTag: 'HEAL1', event: 'Dance', occurrence: 2, spellName: 'Heal', notes: '', spellId: '67890', timingOffset: 1 },
  ] as Assignment[];

  commitAssignments(dir, assignments, roleMappings);

  // Canonical artifact: the raw assignments array.
  assert.deepEqual(loadJson(dir, ARTIFACTS.assignments), assignments);

  // Rendered TSV: header plus one row per assignment (independent literals).
  const expected = [
    'Player\t\tEvent\tOccurrence\tRole\tTiming\tSpell\tNotes\tSpellID',
    'Bob\t\tDance\t1\tTANK1\t2\tSmash\tmove out\t12345',
    'Alice\t\tDance\t2\tHEAL1\t1\tHeal\t\t67890',
    '',
  ].join('\n');
  assert.equal(fs.readFileSync(artifactPath(dir, ARTIFACTS.tsv), 'utf8'), expected);
});