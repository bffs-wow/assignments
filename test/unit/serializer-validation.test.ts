/**
 * Unit tests for the sheet-serializer corner shipped by T1: the extended
 * assignment contract, boss resolution, and grouped plan validation.
 *
 * This is the single new test seam for the serializer feature — pure contract
 * tests: no .env keys, no network, no model. Runs under `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as v from 'valibot';

import { assignmentSchema } from '../../src/shared/assignments-schema.ts';
import type { Assignment } from '../../src/shared/assignments-schema.ts';
import { allSooBosses, resolveBoss, GROUP_TAGS } from '../../src/serializer/bosses.ts';
import { validateAssignments } from '../../src/serializer/validate.ts';

const paragons = resolveBoss('Paragons of the Klaxxi');
assert.ok(paragons, 'Paragons must resolve for the fixture');

/** Hand-written representative role mappings (tags the plan is allowed to use). */
const ROLE_MAPPINGS = {
  PROTPALA1: { name: 'Paladino' },
  DISC1: { name: 'Sacred' },
  RSHAM1: { name: 'Totem' },
};

const base = (over: Partial<Assignment> = {}): Assignment => ({
  event: 'Reave',
  occurrence: 1,
  roleTag: 'PROTPALA1',
  timingOffset: 0,
  spellName: 'Shield Wall',
  notes: '',
  spellId: '871',
  ...over,
});

test('T1: a valid plan passes for Paragons (canonical events, resolved + group tags)', () => {
  const plan: Assignment[] = [
    base({ event: 'Reave', roleTag: 'PROTPALA1' }),
    base({ event: 'Whirling', roleTag: 'DISC1' }),
    base({ event: 'Encounter Start (PAR)', roleTag: 'ALL', spellName: 'Bloodlust' }),
    base({ event: 'Hurl Amber', roleTag: 'MELEEDPS' }),
    base({ event: 'Death from Above (PAR)', roleTag: 'RSHAM1', timingOffset: -20 }),
    base({ event: 'Whirling', roleTag: 'RANGEDDPS', occurrence: '1,4' }),
  ];
  const r = validateAssignments(plan, { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.errors.length, 0);
});

test('T1: every one of the 14 bosses accepts its own canonical vocabulary', () => {
  const bosses = allSooBosses();
  assert.equal(bosses.length, 14);
  for (const boss of bosses) {
    const plan: Assignment[] = boss.events.map((event) =>
      base({ event, roleTag: 'ALL', spellName: 'Power Word: Barrier' }));
    const r = validateAssignments(plan, { boss, roleMappings: {} });
    assert.equal(r.ok, true, `${boss.id}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
});

test('T1: an off-vocabulary event is rejected, naming the offending event and the valid set', () => {
  const plan = [base({ event: 'Calamity' })]; // "Calamity" belongs to Fallen Protectors, not Paragons
  const r = validateAssignments(plan, { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(r.ok, false);
  const issue = r.errors.find((e) => e.field === 'event');
  assert.ok(issue, 'expected an event-field issue');
  assert.match(issue.message, /Calamity/);
  assert.deepEqual(issue.legalValues, paragons.events);
});

test('T1: unknown tag, off-vocab event and malformed comma-list are reported together', () => {
  const plan = [base({ event: 'Calamity', roleTag: 'BOGUSTAG', occurrence: '1,,4' })];
  const r = validateAssignments(plan, { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(r.ok, false);
  const fields = r.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['event', 'occurrence', 'roleTag']);
});

test('T1: a missing required field and a non-numeric timing are grouped errors', () => {
  // spellName missing on the first row, timingOffset a string on the second
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plan: any[] = [
    { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: 0, notes: '', spellId: '' },
    { ...base(), timingOffset: 'abc' },
  ];
  const r = validateAssignments(plan, { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'spellName'), 'missing spellName reported');
  assert.ok(r.errors.some((e) => e.field === 'timingOffset'), 'non-numeric timing reported');
});

test('T1: boss resolution accepts id, WCL name and sheet name (case-insensitive); unknown is undefined', () => {
  assert.equal(resolveBoss('paragons-of-the-klaxxi')?.id, 'paragons-of-the-klaxxi');
  assert.equal(resolveBoss('Paragons of the Klaxxi')?.id, 'paragons-of-the-klaxxi');
  assert.equal(resolveBoss('PARAGONS OF THE KLAXXI')?.id, 'paragons-of-the-klaxxi');
  assert.equal(resolveBoss('SPOILS OF PANDAREN')?.id, 'spoils-of-pandaria'); // sheet-name key, WCL-spelled id
  assert.equal(resolveBoss('Garrosh Hellscream')?.id, 'garrosh-hellscream');
  assert.equal(resolveBoss('immerseus')?.id, 'immerseus');
  assert.equal(resolveBoss('GAR'), undefined); // abbreviation is not a resolution key
  assert.equal(resolveBoss('nope'), undefined);
  assert.equal(resolveBoss(''), undefined);
  assert.equal(resolveBoss(undefined), undefined);
});

test('T1: backward compatibility — legacy plan without tts/cd and single-number occurrence validates', () => {
  assert.equal(v.safeParse(v.array(assignmentSchema), [base()]).success, true);
  const r = validateAssignments([base()], { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(r.ok, true);
});

test('T1: occurrence accepts a single count or a comma-list; rejects malformed lists and negatives', () => {
  const ok1 = validateAssignments([base({ occurrence: '1,4' })], { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(ok1.ok, true, JSON.stringify(ok1.errors));
  const ok2 = validateAssignments([base({ occurrence: '1, 4' })], { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(ok2.ok, true);
  assert.equal(validateAssignments([base({ occurrence: '1.5' })], { boss: paragons, roleMappings: ROLE_MAPPINGS }).ok, false);
  assert.equal(validateAssignments([base({ occurrence: -3 })], { boss: paragons, roleMappings: ROLE_MAPPINGS }).ok, false);
});

test('T1: timing offsets accept negatives and fractions; empty plan is scaffolding-only (valid)', () => {
  const r = validateAssignments(
    [base({ timingOffset: -20, occurrence: 1 }), base({ timingOffset: 0.5, occurrence: 2 })],
    { boss: paragons, roleMappings: ROLE_MAPPINGS },
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const empty = validateAssignments([], { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(empty.ok, true);
});

test('T1: validation requires a resolved boss and an assignments array', () => {
  const noBoss = validateAssignments([base()], { roleMappings: ROLE_MAPPINGS });
  assert.equal(noBoss.ok, false);
  const notArray = validateAssignments(null, { boss: paragons, roleMappings: ROLE_MAPPINGS });
  assert.equal(notArray.ok, false);
  assert.equal(notArray.errors.length, 1);
  assert.ok(notArray.errors[0].message.includes('array'));
});

test('T1: GROUP_TAGS is the canonical group-tag set', () => {
  assert.deepEqual([...GROUP_TAGS], [
    'ALL', 'MELEEDPS', 'RANGEDDPS', 'TANKS', 'HEALERS',
    'DEATHKNIGHT', 'DRUID', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR',
  ]);
});