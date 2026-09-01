import * as v from 'valibot';

/**
 * One raid cooldown assignment. Mirrors the JSON schema the old
 * @google/genai responseSchema enforced; now a Valibot schema used as the
 * submit_assignments tool input and the 'assignments' data-writer channel.
 */
export const assignmentSchema = v.object({
  event: v.string(),
  // A single count or a comma-separated list of counts ("1", "1,4") per the
  // sheet's COUNT / HEALTH % convention. Widened from number-only (backward
  // compatible: existing plans carry numbers).
  occurrence: v.union([v.number(), v.string()]),
  roleTag: v.string(),
  timingOffset: v.number(),
  spellName: v.string(),
  notes: v.string(),
  spellId: v.string(),
  // Sheet-compliant extras (optional — legacy plans omit them):
  // OVERRIDE TTS  -> tts
  // CD #          -> cd
  tts: v.optional(v.string()),
  cd: v.optional(v.number()),
});

export type Assignment = v.InferOutput<typeof assignmentSchema>;
