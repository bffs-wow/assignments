import * as v from 'valibot';

/**
 * One raid cooldown assignment. Mirrors the JSON schema the old
 * @google/genai responseSchema enforced; now a Valibot schema used as the
 * submit_assignments tool input and the 'assignments' data-writer channel.
 */
export const assignmentSchema = v.object({
  event: v.string(),
  occurrence: v.number(),
  roleTag: v.string(),
  timingOffset: v.number(),
  spellName: v.string(),
  notes: v.string(),
  spellId: v.string(),
});

export type Assignment = v.InferOutput<typeof assignmentSchema>;
