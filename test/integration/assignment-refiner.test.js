/**
 * Live integration test for the AssignmentRefiner agent — proves the same
 * structured-output tool path for the feedback loop: current assignments +
 * natural-language feedback in, a schema-valid updated matrix out via
 * reply.data.assignments. Uses google/gemini-2.5-flash with GEMINI_API_KEY.
 *
 * Skips when GEMINI_API_KEY is absent. Consumes real Gemini quota.
 * Run: npm run test:integration
 */
import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert';
import * as v from 'valibot';
import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';
import { AssignmentRefiner } from '../../src/agents/assignment-refiner.ts';
import { assignmentSchema } from '../../src/shared/assignments-schema.ts';

const hasKey = Boolean(process.env.GEMINI_API_KEY && !/your_/.test(process.env.GEMINI_API_KEY));
const skip = !hasKey && 'GEMINI_API_KEY not set in .env';

const flue = await start({ agents: [AssignmentRefiner], db: sqlite() });
after(async () => {
  await flue.stop();
});

const currentAssignments = [
  { event: 'Encounter Start', occurrence: 1, roleTag: 'ALL', timingOffset: 1, spellName: 'Bloodlust', notes: '', spellId: '' },
  { event: 'Calamity', occurrence: 1, roleTag: 'RSHAM1', timingOffset: 1, spellName: 'Healing Tide Totem', notes: '', spellId: '' },
];

test('AssignmentRefiner: applies human feedback and returns a schema-valid updated matrix', { skip, timeout: 180000 }, async () => {
  const agent = init(AssignmentRefiner, { id: 'it-assignment-refiner' });
  const receipt = await agent.dispatch({
    message: 'Apply the raid leader feedback.',
    initialData: {
      currentAssignments,
      humanFeedback: "add an assignment for everyone to move to the blue marker during Calamity",
    },
  });
  const reply = await agent.read(receipt);

  const writes = reply.data?.assignments;
  assert.ok(Array.isArray(writes) && writes.length > 0, 'expected reply.data.assignments to be written (model must call submit_assignments)');

  const refined = writes[0];
  assert.ok(Array.isArray(refined) && refined.length > 0, 'expected at least one assignment');
  assert.ok(v.safeParse(v.array(assignmentSchema), refined).success, 'assignments must conform to the schema');

  const blue = refined.find(a => /blue/i.test(`${a.spellName} ${a.notes}`));
  assert.ok(blue, 'expected the arbitrary "move to blue" assignment to survive as an ALL assignment');
  assert.equal(blue.roleTag, 'ALL', 'arbitrary assignments should use roleTag ALL');
});
