/**
 * Unit tests for AssignmentRefiner whitelist steering (Issue #13).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as v from 'valibot';

import { AssignmentRefiner, buildRefinerPrompt } from '../../src/agents/assignment-refiner.ts';
import type { Assignment } from '../../src/shared/assignments-schema.ts';

const currentAssignments: Assignment[] = [
  { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '' },
];

test('T13: buildRefinerPrompt includes canonical whitelist, role tags, and exact-name instruction', () => {
  const prompt = buildRefinerPrompt({
    currentAssignments,
    humanFeedback: 'move everyone to blue marker',
    canonicalEvents: ['Encounter Start (PAR)', 'Reave', 'Death from Above (PAR)'],
    roleMappings: { PROTPALA1: { name: 'Paladino' }, RSHAM1: { name: 'Totem' } },
  });

  assert.ok(prompt.includes('Canonical Event Whitelist for this boss:'));
  assert.ok(prompt.includes(JSON.stringify(['Encounter Start (PAR)', 'Reave', 'Death from Above (PAR)'])));
  assert.ok(prompt.includes('Resolved Role Tags:'));
  assert.ok(prompt.includes(JSON.stringify(['PROTPALA1', 'RSHAM1'])));
  assert.ok(prompt.includes('EVENT NAMES MUST BE EXACT: use only event names from the Canonical Event Whitelist below. Do NOT paraphrase.'));
});

test('T13: buildRefinerPrompt handles optional canonicalEvents and roleMappings gracefully', () => {
  const prompt = buildRefinerPrompt({
    currentAssignments,
    humanFeedback: 'add a tranquility',
  });

  assert.ok(prompt.includes('Canonical Event Whitelist for this boss:\n[]'));
  assert.ok(prompt.includes('Resolved Role Tags:\n[]'));
});

test('T13: AssignmentRefiner.initialData schema accepts canonicalEvents and roleMappings as optional fields', () => {
  const validWithAll = {
    currentAssignments,
    humanFeedback: 'feedback',
    canonicalEvents: ['Encounter Start (PAR)'],
    roleMappings: { ALL: {} },
  };
  const parseWithAll = v.safeParse(AssignmentRefiner.initialData, validWithAll);
  assert.ok(parseWithAll.success, 'should validate with canonicalEvents and roleMappings');

  const validMinimal = {
    currentAssignments,
    humanFeedback: 'feedback',
  };
  const parseMinimal = v.safeParse(AssignmentRefiner.initialData, validMinimal);
  assert.ok(parseMinimal.success, 'should validate without optional canonicalEvents and roleMappings');
});
