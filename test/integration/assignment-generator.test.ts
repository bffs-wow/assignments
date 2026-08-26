/**
 * Live integration test for the AssignmentGenerator agent — proves the
 * structured-output path: the model must call submit_assignments with a
 * Valibot-validated array, which lands in reply.data.assignments (no manual
 * JSON.parse). Uses google/gemini-2.5-flash with GEMINI_API_KEY from .env.
 *
 * Skips when GEMINI_API_KEY is absent. Consumes real Gemini quota.
 * Run: npm run test:integration
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert';
import * as v from 'valibot';
import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';
import { AssignmentGenerator } from '../../src/agents/assignment-generator.ts';
import { assignmentSchema } from '../../src/shared/assignments-schema.ts';

const hasKey = Boolean(process.env.GEMINI_API_KEY && !/your_/.test(process.env.GEMINI_API_KEY));
const skip = !hasKey && 'GEMINI_API_KEY not set in .env';

const flue = await start({ agents: [AssignmentGenerator], db: sqlite() });
after(async () => {
  await flue.stop();
});

const skillsData = JSON.parse(
  readFileSync(new URL('../../src/data/mop_skills.json', import.meta.url), 'utf8'),
);

const timeline = [
  { timestamp: 0, type: 'encounter_start', name: 'Encounter Start (The Fallen Protectors)', description: 'The fight begins.', damage: 0 },
  { timestamp: 50000, type: 'cast', name: 'Mark of Anguish', description: 'Boss ability — heavy single-target tank damage.', damage: 1200000 },
  { timestamp: 90000, type: 'cast', name: 'Calamity', description: 'Boss ability — heavy raid-wide damage.', damage: 3000000 },
];

const roleMappings = {
  DISC1: { name: 'Heala', class: 'Priest', spec: 'Discipline' },
  PROTPALA1: { name: 'Tanky', class: 'Paladin', spec: 'Protection' },
  RSHAM1: { name: 'Totems', class: 'Shaman', spec: 'Restoration' },
  ALL: {},
};

test('AssignmentGenerator: model produces a valid, schema-conformant assignment matrix via tool call', { skip, timeout: 180000 }, async () => {
  const agent = init(AssignmentGenerator, { id: 'it-assignment-generator' });
  const receipt = await agent.dispatch({
    message: 'Generate the raid cooldown assignment matrix for this encounter.',
    initialData: { timeline, roleMappings, skillsData, communityStrategy: '' },
  });
  const reply = await agent.read(receipt);

  assert.ok(reply.text && reply.text.length > 0, 'expected a non-empty text reply');

  const writes = reply.data?.assignments;
  assert.ok(Array.isArray(writes) && writes.length > 0, 'expected reply.data.assignments to be written (model must call submit_assignments)');

  const assignments = writes[0];
  assert.ok(Array.isArray(assignments) && assignments.length > 0, 'expected at least one assignment');
  assert.ok(v.safeParse(v.array(assignmentSchema), assignments).success, 'assignments must conform to the schema');

  // Spot-check the rules: Bloodlust on encounter start, coverage for Calamity.
  const bloodlust = assignments.find(a => /bloodlust|time warp|heroism/i.test(a.spellName));
  assert.ok(bloodlust, 'expected a Bloodlust-style assignment');
  assert.ok(bloodlust.roleTag === 'ALL', 'Bloodlust should be assigned to ALL');

  const calamity = assignments.find(a => /calamity/i.test(a.event));
  assert.ok(calamity, 'expected an assignment covering Calamity');
});
