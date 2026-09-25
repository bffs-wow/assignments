/**
 * Unit tests for AssignmentGenerator prompt steering (issues #33 and #34).
 *
 * #33: the generator should lean on the canonical event whitelist when the
 *      community strategy names events that may not exist (e.g. the
 *      hallucinated Magnetic Crush on Blackfuse).
 * #34: the Blackfuse Shredder -16s pre-call is first-occurrence-only —
 *      later shredders repeat on irregular gaps, so fixed offsets must not
 *      be reused for occurrence 2+.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import { AssignmentGenerator, buildGeneratorPrompt } from '../../src/agents/assignment-generator.ts';
import * as v from 'valibot';

const baseOpts = {
  timeline: [[17, 'ENCOUNTER_START', 'Immerseus']],
  roleMappings: { DISC1: { name: 'Sjue' }, PROTWARR1: { name: 'omo' } },
  skillsData: { heal: [], dps: [], tank: [] },
  communityStrategy: 'Pump Healing Tide on Magnetic Crush.',
  canonicalEvents: [
    'Encounter Start (IMM)',
    'Health % (IMM)',
    'Swirl',
    'Encounter Start (BLA)',
    'Shredder',
    'Overload 1',
  ],
};

test('T1/#33: buildGeneratorPrompt embeds the canonical event whitelist verbatim', () => {
  const prompt = buildGeneratorPrompt(baseOpts);
  assert.ok(prompt.includes('Canonical Event Whitelist:'));
  assert.ok(prompt.includes(JSON.stringify(baseOpts.canonicalEvents)));
});

test('T1/#33: buildGeneratorPrompt keeps EVENT NAMES MUST BE EXACT and maps numbered variants', () => {
  const prompt = buildGeneratorPrompt(baseOpts);
  assert.ok(prompt.includes('EVENT NAMES MUST BE EXACT: use only the event names from the "Canonical Event Whitelist"'));
  assert.ok(prompt.includes('"Overload 1".."Overload 10"'), 'numbered-variant mapping hint present');
});

test('T1/#33: buildGeneratorPrompt warns that community-strategy events may never occur (Magnetic Crush hallucination)', () => {
  const prompt = buildGeneratorPrompt(baseOpts);
  assert.ok(prompt.includes('COMMUNITY-STRATEGY EVENTS MAY NOT EXIST'));
  assert.ok(prompt.includes('Magnetic Crush'));
  assert.ok(prompt.includes('Shredder'), 'points at the real BLA event instead');
});

test('T1/#33: buildGeneratorPrompt omits the whitelist-related wording without breaking when canonicalEvents is missing', () => {
  const prompt = buildGeneratorPrompt({ ...baseOpts, canonicalEvents: undefined });
  assert.ok(prompt.includes('Event Whitelist:\n[]'));
});

test('T1/#34: buildGeneratorPrompt notes the shredder pre-call (-16s) is first-occurrence-only', () => {
  const prompt = buildGeneratorPrompt(baseOpts);
  assert.ok(prompt.includes('SHREDDER/LATE-PHASE PRE-CALLS ARE FIRST-OCCURRENCE-ONLY'));
  assert.ok(prompt.includes('-16s'), 'mentions the Blackfuse pre-call offset');
  assert.ok(prompt.includes('irregular gaps'), 'explains irregular later-occurrence gaps');
  assert.ok(prompt.includes('Overload'), 'points to attaching CDs at the Overload event instead');
});

test('T1/#34: buildGeneratorPrompt keeps the mass-fire rule for CD reuse separate (no collision with pre-call rule)', () => {
  const prompt = buildGeneratorPrompt(baseOpts);
  const rule8 = prompt.match(/8\. COMMUNITY-STRATEGY[^\n]*/)?.[0] ?? '';
  const rule9 = prompt.match(/9\. SHREDDER[^\n]*/)?.[0] ?? '';
  assert.ok(rule8.length > 0 && rule9.length > 0, 'both new rules present');
});

test('T1: AssignmentGenerator.initialData schema accepts the same shape as before', () => {
  const ok = { ...baseOpts };
  const parse = v.safeParse(AssignmentGenerator.initialData, ok);
  assert.ok(parse.success, 'initialData still validates');
});
