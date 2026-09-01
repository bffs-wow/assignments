/**
 * Plan validation against a resolved boss — the serializer's hard gate.
 *
 * Returns ALL violations in one pass (grouped), with the legal values where
 * they're known. The renderer (T2) consumes this before emitting CSV; the CLI
 * wiring (T5) surfaces the grouped errors loudly. Validation scope:
 *
 *   - shape/required fields + field types   -> Valibot schema (assignmentSchema)
 *   - event in the boss's canonical vocabulary
 *   - roleTag a resolved sheet role or a group tag
 *   - occurrence a single count or a comma-separated list of counts
 *
 * An empty plan validates (scaffolding-only output is legal).
 */
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';
import type { Assignment } from '../shared/assignments-schema.ts';
import { GROUP_TAGS } from './bosses.ts';
import type { SooBoss } from './bosses.ts';

export interface ValidationIssue {
  /** Index of the offending assignment (-1 for whole-plan issues). */
  index: number;
  /** Field the issue is about, when it's a single field. */
  field?: string;
  /** Human-readable message naming the offending value. */
  message: string;
  /** The valid set, when known (canonical events, allowed role tags). */
  legalValues?: string[];
}

export interface PlanValidation {
  ok: boolean;
  errors: ValidationIssue[];
}

export interface ValidateOptions {
  /** The resolved boss (from resolveBoss) — canon of the event vocabulary. */
  boss?: SooBoss;
  /** The resolved roster: keys of the role mappings = allowed role tags. */
  roleMappings?: Record<string, unknown> | null;
}

/** A single count or a comma-separated list of counts, e.g. "1", "1,4", "1, 4". */
const occurrenceListRe = /^\s*\d+(?:\s*,\s*\d+)*\s*$/;

export function validateAssignments(input: unknown, opts: ValidateOptions = {}): PlanValidation {
  const errors: ValidationIssue[] = [];
  const { boss, roleMappings } = opts;
  const allowedTags = [...GROUP_TAGS, ...Object.keys(roleMappings ?? {})];

  if (!boss) {
    errors.push({ index: -1, field: 'boss', message: 'A boss/encounter is required to validate a plan — resolve it with resolveBoss().' });
  }
  if (!Array.isArray(input)) {
    errors.push({ index: -1, message: 'Assignments must be an array.' });
    return { ok: false, errors };
  }

  // Schema-parse issues cover shape, required fields and field types. An
  // off-vocabulary event / unknown tag / malformed comma-list passes the
  // schema (strings), so those come from the semantic checks below.
  const parsed = v.safeParse(v.array(assignmentSchema), input);
  if (!parsed.success) {
    for (const issue of parsed.issues) {
      const index = typeof issue.path?.[0]?.key === 'number' ? issue.path[0].key : -1;
      const field = typeof issue.path?.[1]?.key === 'string' ? issue.path[1].key : undefined;
      errors.push({ index, field, message: issue.message });
    }
    return { ok: false, errors };
  }

  const assignments = parsed.output;
  for (const [index, a] of assignments.entries()) {
    if (boss && !boss.events.includes(a.event)) {
      errors.push({
        index,
        field: 'event',
        message: `event "${a.event}" is not in the canonical vocabulary for ${boss.wclName}.`,
        legalValues: boss.events,
      });
    }
    if (!allowedTags.includes(a.roleTag)) {
      errors.push({
        index,
        field: 'roleTag',
        message: `roleTag "${a.roleTag}" is not a resolved sheet role or a group tag (ALL / MELEEDPS / RANGEDDPS).`,
        legalValues: allowedTags,
      });
    }
    const occBad =
      typeof a.occurrence === 'number'
        ? !Number.isInteger(a.occurrence) || a.occurrence < 0
        : !occurrenceListRe.test(a.occurrence);
    if (occBad) {
      errors.push({
        index,
        field: 'occurrence',
        message: `occurrence "${String(a.occurrence)}" must be a single count or a comma-separated list of counts (e.g. "1,4").`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}