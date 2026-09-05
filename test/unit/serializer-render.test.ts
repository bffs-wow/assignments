/**
 * Unit tests for the SOO-Assigns-Import renderer (T2).
 *
 * Pure contract tests: the golden Paragons fixture, per-boss scaffolding,
 * custom-assignment idiom, determinism, and the validation gate. No env, no
 * network, no model — runs under `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import type { Assignment } from '../../src/shared/assignments-schema.ts';
import { allSooBosses, resolveBoss } from '../../src/serializer/bosses.ts';
import { renderSooAssigns, renderCountRows, HEALTH_PERCENT_ROWS, CUSTOM_SPELL_LITERAL } from '../../src/serializer/render.ts';

const paragons = resolveBoss('Paragons of the Klaxxi');
assert.ok(paragons, 'Paragons must resolve for the fixture');

const ROLE_MAPPINGS = {
  PROTPALA1: { name: 'Paladino' },
  DISC1: { name: 'Sacred' },
  RSHAM1: { name: 'Totem' },
};

/** Representative Paragons plan covering the AC surface. */
const goldenPlan: Assignment[] = [
  { event: 'Encounter Start (PAR)', occurrence: 1, roleTag: 'ALL', timingOffset: 0, spellName: 'Bloodlust', notes: '', spellId: '2825' },
  { event: 'Reave', occurrence: 1, roleTag: 'PROTPALA1', timingOffset: -20, spellName: 'Shield Wall', notes: 'tank external', spellId: '871' },
  { event: 'Death from Above (PAR)', occurrence: '1,4', roleTag: 'RSHAM1', timingOffset: 0.5, spellName: 'Spirit Link Totem', notes: '', spellId: '98008', tts: 'Pop SLT' },
  { event: 'Whirling', occurrence: 2, roleTag: 'MELEEDPS', timingOffset: 5, spellName: 'Lay on Hands', notes: 'bop priest', spellId: '633' },
  // custom spell with an unknown id → blank CUSTOM ICON, never a failed render
  { event: 'Hurl Amber', occurrence: 3, roleTag: 'PROTPALA1', timingOffset: 10, spellName: 'Void Shift', notes: '', spellId: '' },
];

/** Expected assignment rows, sorted by master event order then TIME. */
const goldenBlock = [
  `"","","Encounter Start (PAR)","1","ALL","0","Bloodlust","","","","","",""`,
  `"Paladino","","Reave","1","PROTPALA1","-20","Shield Wall","","","tank external","","",""`,
  `"Totem","","Death from Above (PAR)","1,4","RSHAM1","0.5","Spirit Link Totem","","","","Pop SLT","",""`,
  `"","","Whirling","2","MELEEDPS","5","Custom Spell Assignment","","","bop priest","Lay on Hands","","633"`,
  `"Paladino","","Hurl Amber","3","PROTPALA1","10","Custom Spell Assignment","","","","Void Shift","",""`,
];

const HEADER = '"Player","CD #","BOSS HEALTH / SPELL","COUNT / HEALTH %","PLAYER/CLASS/ALL","TIME","COOLDOWN SPELL","","NPC NAME","ADDITIONAL TEXT","OVERRIDE TTS","CUSTOM NAME","CUSTOM ICON"';
const SCAFFOLD_ROWS = HEALTH_PERCENT_ROWS + 2; // 15 HEALTH % rows + LEAVE BLANK + COUNT header

function renderLines(plan: unknown[]): string[] {
  const r = renderSooAssigns({ assignments: plan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.ok(r.csv, `expected a render, got errors: ${JSON.stringify(r.errors)}`);
  return r.csv.split('\n').filter((l) => l !== '');
}

/** Line index where the target boss's COUNT-block assignment rows start. */
function targetBlockStart(lines: string[]): number {
  const bossIndex = allSooBosses().findIndex((b) => b.id === paragons!.id);
  return 1 + bossIndex * SCAFFOLD_ROWS + SCAFFOLD_ROWS;
}

test('T2: header + 14 per-boss scaffolds; assignments only in the target COUNT block', () => {
  const lines = renderLines(goldenPlan);
  assert.equal(lines[0], HEADER);
  // every boss scaffolds HEALTH % ×15 + LEAVE BLANK + COUNT, in sheet order
  const bosses = allSooBosses();
  assert.equal(bosses.length, 14);
  assert.equal(lines.filter((l) => /^"","\d+","Health % \([A-Z]+\)"/.test(l)).length, 14 * HEALTH_PERCENT_ROWS);
  assert.equal(lines.filter((l) => l.includes('"LEAVE BLANK"')).length, 14);
  assert.equal(lines.filter((l) => l.includes('"","","","COUNT",""')).length, 14);
  // first scaffold row carries the boss display name in the NPC column
  assert.equal(lines[1], `"","1","Health % (IMM)","","","","","","Immerseus","","","",""`);
  assert.equal(lines[2], `"","2","Health % (IMM)","","","","","","","","","",""`);
  // the target boss's first scaffold row at its sheet-order offset
  const parStart = 1 + allSooBosses().findIndex((b) => b.id === paragons!.id) * SCAFFOLD_ROWS;
  assert.equal(lines[parStart], `"","1","Health % (PAR)","","","","","","Paragons of the Klaxxi","","","",""`);
  // total lines = header + 14 scaffolds (+ assignments)
  assert.equal(lines.length, 1 + 14 * SCAFFOLD_ROWS + goldenBlock.length);
});

test('T2: golden Paragons block — exact 13-column rows, sorted, custom idiom, byte-identical on re-run', () => {
  const r1 = renderSooAssigns({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  const r2 = renderSooAssigns({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.equal(r2.csv, r1.csv, 'reruns must be byte-identical');
  const lines = r1.csv!.split('\n').filter((l) => l !== '');
  const start = targetBlockStart(lines);
  assert.deepEqual(lines.slice(start, start + goldenBlock.length), goldenBlock);
});

test('T2: an off-vocabulary event never renders — grouped validation errors instead', () => {
  const bad = [{ ...goldenPlan[0], event: 'Calamity' }];
  const r = renderSooAssigns({ assignments: bad, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.equal(r.csv, null);
  assert.ok(r.errors.some((e) => e.field === 'event' && /Calamity/.test(e.message)));
});

test('T2: an empty plan renders scaffolding-only output (no assignment rows, still valid)', () => {
  const lines = renderLines([]);
  assert.equal(lines.length, 1 + 14 * SCAFFOLD_ROWS);
  // nothing after Paragons' COUNT header except Paragons' own scaffold is intact
  const start = targetBlockStart(lines);
  assert.equal(lines[start], `"","1","Health % (GAR)","","","","","","Garrosh Hellscream","","","",""`); // next boss scaffold
});

test('T2: canonical spells emit a plain row; custom spells use the literal + OVERRIDE TTS + icon', () => {
  const canonicalRows = renderLines(goldenPlan).filter((l) => l.includes('"Bloodlust"'));
  assert.equal(canonicalRows.length, 1);
  assert.equal(CUSTOM_SPELL_LITERAL, 'Custom Spell Assignment');
  const customRows = renderLines(goldenPlan).filter((l) => l.includes(CUSTOM_SPELL_LITERAL));
  assert.equal(customRows.length, 2);
});

test('T2: timing formats preserve negatives and fractions; occurrence keeps comma-lists', () => {
  const lines = renderLines(goldenPlan);
  const block = lines.slice(targetBlockStart(lines), targetBlockStart(lines) + goldenBlock.length);
  assert.ok(block.some((l) => l.includes('"-20"')));
  assert.ok(block.some((l) => l.includes('"0.5"')));
  assert.ok(block.some((l) => l.includes('"1,4"')));
  assert.ok(block.some((l) => l.includes('"0"')));
});

test('T3: renderCountRows returns pure 13-col assignment rows (no scaffold), validated + sorted', () => {
  const { rows, errors } = renderCountRows({ assignments: goldenPlan, roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.equal(errors.length, 0);
  assert.equal(rows.length, goldenPlan.length);
  // each row is exactly the 13-column sheet grid
  for (const row of rows) {
    assert.equal(row.length, 13);
  }
  // sorted by master event order then TIME — matches the golden block's content
  assert.equal(rows[0][2], 'Encounter Start (PAR)');
  assert.equal(rows[1][2], 'Reave');
  assert.equal(rows[2][2], 'Death from Above (PAR)');
  // custom idiom rides the same columns the CSV renderer uses
  assert.equal(rows[3][6], CUSTOM_SPELL_LITERAL);
  assert.equal(rows[3][10], 'Lay on Hands');
  assert.equal(rows[3][12], '633');
});

test('T3: renderCountRows is gated by the same validation — off-vocabulary returns errors', () => {
  const { rows, errors } = renderCountRows({ assignments: [{ ...goldenPlan[0], event: 'Calamity' }], roleMappings: ROLE_MAPPINGS, boss: paragons! });
  assert.equal(rows.length, 0);
  assert.ok(errors.some((e) => e.field === 'event' && /Calamity/.test(e.message)));
});