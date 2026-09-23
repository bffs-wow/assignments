/**
 * Unit tests for the SOO-Assigns-Import read-back parser (T4).
 *
 * Pure contract tests: golden round-trip, lossless field reconstruction,
 * scaffolding-only plan, and false-positive immunity.
 * No env, no network, no model — runs under `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import type { Assignment } from '../../src/shared/assignments-schema.ts';
import { allSooBosses, resolveBoss } from '../../src/serializer/bosses.ts';
import { renderSooAssigns, CUSTOM_SPELL_LITERAL } from '../../src/serializer/render.ts';
import { parseSooAssigns, parseCsv } from '../../src/serializer/readback.ts';

const paragons = resolveBoss('Paragons of the Klaxxi');
assert.ok(paragons, 'Paragons must resolve for the fixture');

const immerseus = resolveBoss('Immerseus');
assert.ok(immerseus, 'Immerseus must resolve for the fixture');

const ROLE_MAPPINGS = {
  PROTPALA1: { name: 'Paladino' },
  DISC1: { name: 'Sacred' },
  RSHAM1: { name: 'Totem' },
};

/** Representative Paragons plan matching serializer-render fixture. */
const goldenPlan: Assignment[] = [
  { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: -20, spellName: 'Shield Wall', notes: 'tank external', spellId: '871' },
  { event: 'Death from Above (PAR)', occurrence: '1,4', roleTag: 'RSHAM1', timingOffset: 0.5, spellName: 'Spirit Link Totem', notes: '', spellId: '98008', tts: 'Pop SLT' },
  { event: 'Whirling', occurrence: 2, roleTag: 'MELEEDPS', timingOffset: 5, spellName: 'Lay on Hands', notes: 'bop priest', spellId: '633' },
  { event: 'Hurl Amber', occurrence: 3, roleTag: 'PROTPALA1', timingOffset: 10, spellName: 'Void Shift', notes: '', spellId: '' },
];

test('T4: Golden round-trip — render → parse → re-render is byte-identical', () => {
  const r1 = renderSooAssigns({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r1.csv, 'initial render should succeed');

  const parsed = parseSooAssigns(r1.csv);
  assert.equal(parsed.bossId, 'paragons-of-the-klaxxi');
  assert.equal(parsed.assignments.length, goldenPlan.length);

  const r2 = renderSooAssigns({ assignments: parsed.assignments, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r2.csv, 're-render should succeed');
  assert.equal(r2.csv, r1.csv, 're-rendered CSV must be byte-identical to original render');
});

test('T4: Lossless for custom assignment, ALL row, negative/fractional timing, TTS override, comma occurrence', () => {
  const r1 = renderSooAssigns({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r1.csv);

  const parsed = parseSooAssigns(r1.csv);
  assert.equal(parsed.bossId, 'paragons-of-the-klaxxi');

  // Row 0: ALL row, zero timing, integer occurrence
  const row0 = parsed.assignments[0];
  assert.equal(row0.event, 'Encounter Start (PAR)');
  assert.equal(row0.occurrence, 1);
  assert.equal(row0.roleTag, 'ALL');
  assert.equal(row0.timingOffset, 0);
  assert.equal(row0.spellName, 'Bloodlust');
  assert.equal(row0.notes, '');
  assert.equal(row0.tts, undefined);

  // Row 1: negative timing, notes
  const row1 = parsed.assignments[1];
  assert.equal(row1.event, 'Reave');
  assert.equal(row1.occurrence, 1);
  assert.equal(row1.roleTag, 'PROTPALA1');
  assert.equal(row1.timingOffset, -20);
  assert.equal(row1.spellName, 'Shield Wall');
  assert.equal(row1.notes, 'tank external');
  assert.equal(row1.tts, undefined);

  // Row 2: comma-list occurrence, fractional timing, explicit TTS override on canonical spell
  const row2 = parsed.assignments[2];
  assert.equal(row2.event, 'Death from Above (PAR)');
  assert.equal(row2.occurrence, '1,4');
  assert.equal(row2.roleTag, 'RSHAM1');
  assert.equal(row2.timingOffset, 0.5);
  assert.equal(row2.spellName, 'Spirit Link Totem');
  assert.equal(row2.tts, 'Pop SLT');

  // Row 3: custom assignment with real spell name in OVERRIDE TTS and spellId in CUSTOM ICON
  const row3 = parsed.assignments[3];
  assert.equal(row3.event, 'Whirling');
  assert.equal(row3.occurrence, 2);
  assert.equal(row3.roleTag, 'MELEEDPS');
  assert.equal(row3.timingOffset, 5);
  assert.equal(row3.spellName, 'Lay on Hands');
  assert.equal(row3.notes, 'bop priest');
  assert.equal(row3.spellId, '633');
  assert.equal(row3.tts, undefined);

  // Row 4: custom assignment without spellId
  const row4 = parsed.assignments[4];
  assert.equal(row4.event, 'Hurl Amber');
  assert.equal(row4.occurrence, 3);
  assert.equal(row4.roleTag, 'PROTPALA1');
  assert.equal(row4.timingOffset, 10);
  assert.equal(row4.spellName, 'Void Shift');
  assert.equal(row4.spellId, '');
  assert.equal(row4.tts, undefined);
});

test('T4: cd field is losslessly reconstructed when present', () => {
  const planWithCd: Assignment[] = [
    { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: 0, spellName: 'Shield Wall', notes: '', spellId: '', cd: 2 },
  ];
  const r1 = renderSooAssigns({ assignments: planWithCd, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r1.csv);

  const parsed = parseSooAssigns(r1.csv);
  assert.equal(parsed.assignments.length, 1);
  assert.equal(parsed.assignments[0].cd, 2);

  const r2 = renderSooAssigns({ assignments: parsed.assignments, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.equal(r2.csv, r1.csv);
});

test('T4: Scaffolding-only (empty assignments): parse returns empty array and blank bossId', () => {
  const r1 = renderSooAssigns({ assignments: [], roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r1.csv);

  const parsed = parseSooAssigns(r1.csv);
  assert.deepEqual(parsed.assignments, []);
  assert.equal(parsed.bossId, '');
});

test('T4: Scaffold-only boss rows are ignored (no false positives)', () => {
  // Render a plan where only Paragons has assignments; all other 13 bosses have 17 scaffold rows each
  const r1 = renderSooAssigns({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r1.csv);

  const parsed = parseSooAssigns(r1.csv);
  // Total assignments must equal exactly 5 (Paragons data rows), no false positives from the 13*17 other scaffold rows
  assert.equal(parsed.assignments.length, 5);
  for (const a of parsed.assignments) {
    assert.ok(paragons!.events.includes(a.event), `event "${a.event}" must belong to Paragons`);
    assert.notEqual(a.event, 'Health % (PAR)');
  }
});

test('T4: Different boss round-trip (Immerseus) correctly identifies boss and round-trips', () => {
  const immerseusPlan: Assignment[] = [
    { event: 'Encounter Start (IMM)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '' },
    { event: 'Corrosive Blast', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: -5, spellName: 'Devotion Aura', notes: 'tank cd', spellId: '' },
  ];

  const r1 = renderSooAssigns({ assignments: immerseusPlan, roleMappings: ROLE_MAPPINGS, boss: immerseus! });
  assert.ok(r1.csv);

  const parsed = parseSooAssigns(r1.csv);
  assert.equal(parsed.bossId, 'immerseus');
  assert.equal(parsed.assignments.length, 2);
  assert.equal(parsed.assignments[0].event, 'Encounter Start (IMM)');
  assert.equal(parsed.assignments[1].event, 'Corrosive Blast');

  const r2 = renderSooAssigns({ assignments: parsed.assignments, roleMappings: ROLE_MAPPINGS, boss: immerseus! });
  assert.equal(r2.csv, r1.csv);
});

test('T4: parseCsv parses RFC 4180 escaped quotes, commas, and multiline text', () => {
  const csv = '"a","b,c","d ""e"" f"\n"1","2","3"\n';
  const rows = parseCsv(csv);
  assert.deepEqual(rows, [
    ['a', 'b,c', 'd "e" f'],
    ['1', '2', '3'],
  ]);
});
