'use agent';
import { useDataWriter, useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';

/**
 * Generates the initial raid cooldown assignment matrix.
 *
 * Structured output: the model builds the full assignment array as the
 * arguments to submit_assignments (validated by the Valibot input schema — the
 * replacement for Gemini's responseSchema), the tool durably writes it to the
 * 'assignments' data channel, and the caller reads reply.data.assignments[0].
 *
 * Creation data (initialData): { timeline, roleMappings, skillsData, communityStrategy }.
 */
export function AssignmentGenerator() {
  useModel(process.env.MODEL_GENERATE ?? 'opencode-go/deepseek-v4-flash');

  const writeAssignments = useDataWriter('assignments', { schema: v.array(assignmentSchema) });

  const { timeline, roleMappings, skillsData, communityStrategy, canonicalEvents } = useInitialData<{
    timeline: unknown[] | null;
    roleMappings: Record<string, unknown>;
    skillsData: unknown;
    communityStrategy: string;
    canonicalEvents: string[];
  }>();

  useTool({
    name: 'submit_assignments',
    description: 'Submit the final raid cooldown assignment matrix for the encounter. Call once with an object { assignments: [...] } containing the complete array when every assignment is decided.',
    input: v.object({ assignments: v.array(assignmentSchema) }),
    async run({ data }) {
      writeAssignments(data.assignments);
      return { output: `Saved ${data.assignments.length} assignments.` };
    },
  });

  const strategySection = communityStrategy
    ? `Community Practices (Highly Recommended Strategy to Mimic):\n${communityStrategy}`
    : '(No community strategy was provided for this encounter.)';

  const timelineSection = timeline?.length
    ? JSON.stringify(timeline)
    : '(No encounter timeline was provided — plan from the encounter’s standard SOO boss events (e.g. “Encounter Start”, the boss’s signature heavy-hitting events) and the raid roster below.)';

  return `You are an expert World of Warcraft: Mists of Pandaria raid leader.
Your task is to assign raid cooldowns to major boss events based on the provided encounter timeline and the available raid roster.

Available Roles and their toolkits:
${JSON.stringify(skillsData, null, 2)}

Current Raid Roster Roles Available:
${JSON.stringify(Object.keys(roleMappings))}

Encounter Timeline:
${timelineSection}

${strategySection}

Canonical Event Whitelist:
${JSON.stringify(canonicalEvents ?? [])}

Rules for assignment:
0. EVENT NAMES MUST BE EXACT: use only the event names from the "Canonical Event Whitelist" section below. Do NOT paraphrase, rename, or use community-strategy prose names. If the whitelist has numbered variants (e.g. "Overload 1".."Overload 10"), map each strategy mention to the specific numbered event. Use the exact string, including any boss-abbreviation suffix.
1. Assign appropriate defensive and utility cooldowns to high-damage or high-risk events (like "Desperate Measures Sun", "Calamity", "Mark of Anguish").
2. Respect cooldown durations. If a spell has a 180s cooldown, do not assign that exact player (e.g., DISC1) to use it again within 180 seconds.
3. For heavy single target damage (like "Mark of Anguish"), assign tank externals like "Hand of Sacrifice" or "Pain Suppression", or personal tank cooldowns like "Shield Wall".
4. For heavy raid damage (like "Calamity"), assign raid cooldowns like "Devotion Aura", "Healing Tide Totem", "Power Word: Barrier", or "Spirit Link Totem".
5. For "Encounter Start", always assign "ALL" -> "Bloodlust".
6. Do your best to spread out cooldowns so the raid is covered across all dangerous events.
7. If Community Practices are provided, strongly prioritize mimicking those cooldown assignments for the respective events, assuming the required roles are available in the current roster — but always map their event names to the canonical whitelist.

When the full assignment matrix is ready, call submit_assignments once with { assignments: [...] } — the complete array. Do not describe the assignments in prose — submit them via the tool.`;
}

AssignmentGenerator.initialData = v.object({
  timeline: v.optional(v.union([v.array(v.unknown()), v.null()])),
  roleMappings: v.record(v.string(), v.unknown()),
  skillsData: v.unknown(),
  communityStrategy: v.string(),
  canonicalEvents: v.optional(v.array(v.string())),
});
