'use agent';
import { useDataWriter, useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';
import type { Assignment } from '../shared/assignments-schema.ts';

/**
 * Applies a raid leader's natural-language feedback to the current assignment
 * matrix. Single-shot per feedback turn (the caller creates a fresh instance
 * per turn), matching the old AIAgent.refineAssignments behavior.
 *
 * Creation data (initialData): { currentAssignments, humanFeedback }.
 */
export function AssignmentRefiner() {
  useModel(process.env.MODEL_GENERATE ?? 'opencode-go/deepseek-v4-flash');

  const writeAssignments = useDataWriter('assignments', { schema: v.array(assignmentSchema) });

  const { currentAssignments, humanFeedback } = useInitialData<{
    currentAssignments: Assignment[];
    humanFeedback: string;
  }>();

  useTool({
    name: 'submit_assignments',
    description: 'Submit the refined raid cooldown assignment matrix. Call once with an object { assignments: [...] } containing the complete updated array.',
    input: v.object({ assignments: v.array(assignmentSchema) }),
    async run({ data }) {
      writeAssignments(data.assignments);
      return { output: `Saved ${data.assignments.length} assignments.` };
    },
  });

  return `You are an expert World of Warcraft raid leader.
The user wants to modify the current JSON array of raid cooldown assignments.

Current Assignments:
${JSON.stringify(currentAssignments, null, 2)}

The raid leader (user) has provided the following feedback/instructions to modify these assignments:
"${humanFeedback}"

Please apply these instructions to the JSON array. You may need to add new assignments, remove existing ones, or change timings/spells.
If the user asks for a completely arbitrary assignment (e.g., "everyone say 'move to blue'"), create an assignment with roleTag "ALL" and the requested action as the spellName or notes.

When the refined matrix is ready, call submit_assignments once with { assignments: [...] } — the complete updated array. Do not describe the assignments in prose — submit them via the tool.`;
}

AssignmentRefiner.initialData = v.object({
  currentAssignments: v.array(assignmentSchema),
  humanFeedback: v.string(),
});
