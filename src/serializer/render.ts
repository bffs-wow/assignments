/**
 * SOO-Assigns-Import export-grid renderer — the sheet-compliant CSV artifact.
 *
 * Renders a validated plan + resolved boss into the exact 13-column,
 * per-boss-sectioned CSV the SOO-Assigns-Import tab imports:
 *
 *   header row, then all 14 bosses in sheet order, each with a HEALTH %
 *   template block (15 numbered rows keyed on "Health % (ABBR)", NPC NAME =
 *   the boss's display name on the first row), a LEAVE BLANK separator, and a
 *   COUNT block header; assignment rows appear only in the target boss's COUNT
 *   block, sorted by master event order then TIME.
 *
 * Layout notes (observed from the live test sheet, which supersedes the
 * spec's "blank ×2" wording): column 7 is label-only in data rows, column 8 is
 * the NPC NAME column (carries scaffold markers), G is the COOLDOWN SPELL
 * column (the import box is sheet-generated from these rows and is never
 * written by the app).
 *
 * Determinism: stable boss order, master event order, numeric TIME tiebreak,
 * exact header, no timestamps — identical input yields byte-identical CSV.
 */
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';
import type { Assignment } from '../shared/assignments-schema.ts';
import { allSooBosses } from './bosses.ts';
import type { SooBoss } from './bosses.ts';
import { validateAssignments } from './validate.ts';
import type { ValidationIssue } from './validate.ts';

/** The literal emitted in COOLDOWN SPELL for a spell outside the canonical list. */
export const CUSTOM_SPELL_LITERAL = 'Custom Spell Assignment';

/** The sheet's canonical COOLDOWN SPELL values (docs/tot-assigns-csv-format.md). */
export const CANONICAL_SPELLS = [
  'Ancestral Guidance',
  'Anti-Magic Zone',
  'Bloodlust',
  'Demoralizing Banner',
  'Devotion Aura',
  'Guardian of Ancient Kings',
  'Hand of Protection',
  'Hand of Sacrifice',
  'Healing Tide Totem',
  'Pain Suppression',
  'Power Word: Barrier',
  'Rallying Cry',
  'Revival',
  'Shield Wall',
  'Smoke Bomb',
  'Spirit Link Totem',
  'Spirit Shell',
  'Stampeding Roar',
  'Tranquility',
  'Vampiric Embrace',
  'Vigilance',
];

/** HEALTH % template rows per boss (matches the live sheet's 1..15 grid). */
export const HEALTH_PERCENT_ROWS = 15;

const COL_PLAYER = 0;
const COL_CD = 1;
const COL_EVENT = 2;
const COL_COUNT = 3;
const COL_ROLE = 4;
const COL_TIME = 5;
const COL_SPELL = 6;
const COL_NPC = 8;
const COL_ADDITIONAL_TEXT = 9;
const COL_OVERRIDE_TTS = 10;
const COL_CUSTOM_NAME = 11;
const COL_CUSTOM_ICON = 12;

const HEADER = [
  'Player',
  'CD #',
  'BOSS HEALTH / SPELL',
  'COUNT / HEALTH %',
  'PLAYER/CLASS/ALL',
  'TIME',
  'COOLDOWN SPELL',
  '',
  'NPC NAME',
  'ADDITIONAL TEXT',
  'OVERRIDE TTS',
  'CUSTOM NAME',
  'CUSTOM ICON',
];

export interface RenderInput {
  /** The plan (validated inside the renderer). */
  assignments: unknown;
  /** The roster role tags (keys of the role mappings) — validation input. */
  roleMappings?: Record<string, unknown> | null;
  /** The resolved target boss (from resolveBoss). */
  boss: SooBoss;
}

export interface RenderResult {
  /** The full 13-column CSV artifact, or null when the plan is invalid. */
  csv: string | null;
  /** Grouped validation errors (empty when rendered). */
  errors: ValidationIssue[];
}

const csvCell = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const csvLine = (row: string[]): string => row.map(csvCell).join(',');

function bossScaffold(boss: SooBoss): string[][] {
  const rows: string[][] = [];
  for (let n = 1; n <= HEALTH_PERCENT_ROWS; n++) {
    const row = Array<string>(13).fill('');
    row[COL_CD] = String(n);
    row[COL_EVENT] = `Health % (${boss.abbr})`;
    if (n === 1) row[COL_NPC] = boss.wclName;
    rows.push(row);
  }
  const leaveBlank = Array<string>(13).fill('');
  leaveBlank[COL_NPC] = 'LEAVE BLANK';
  rows.push(leaveBlank);

  const countHeader = Array<string>(13).fill('');
  countHeader[COL_COUNT] = 'COUNT';
  rows.push(countHeader);

  return rows;
}

function assignmentRow(a: Assignment): string[] {
  const custom = !CANONICAL_SPELLS.includes(a.spellName);
  const row = Array<string>(13).fill('');
  // Player (col A) is left blank — the sheet auto-resolves it from the
  // role-name bindings (the plan's roleTag already resolves to a player).
  if (a.cd != null) row[COL_CD] = String(a.cd);
  row[COL_EVENT] = a.event;
  row[COL_COUNT] = String(a.occurrence);
  row[COL_ROLE] = a.roleTag;
  row[COL_TIME] = String(a.timingOffset);
  row[COL_SPELL] = custom ? CUSTOM_SPELL_LITERAL : a.spellName;
  if (a.notes) row[COL_ADDITIONAL_TEXT] = a.notes;
  // OVERRIDE TTS: an explicit tts override wins; otherwise a custom spell's
  // real name rides here per the sheet's live convention.
  row[COL_OVERRIDE_TTS] = custom ? (a.tts || a.spellName) : (a.tts || '');
  // CUSTOM ICON only for custom rows; blank when the id is unknown.
  if (custom && a.spellId) row[COL_CUSTOM_ICON] = a.spellId;
  return row;
}

export function renderSooAssigns(input: RenderInput): RenderResult {
  const { assignments, roleMappings, boss } = input;

  const validation = validateAssignments(assignments, { boss, roleMappings });
  if (!validation.ok) return { csv: null, errors: validation.errors };

  const parsed = v.safeParse(v.array(assignmentSchema), assignments);
  const plan = parsed.success ? parsed.output : [];

  const rows: string[][] = [HEADER];
  const eventOrder = boss.events.reduce<Map<string, number>>((m, e, i) => m.set(e, i), new Map());
  const sorted = [...plan].sort(
    (a, b) => (eventOrder.get(a.event) ?? 0) - (eventOrder.get(b.event) ?? 0) || a.timingOffset - b.timingOffset,
  );

  for (const b of allSooBosses()) {
    rows.push(...bossScaffold(b));
    if (b.id === boss.id) rows.push(...sorted.map(assignmentRow));
  }

  return { csv: `${rows.map(csvLine).join('\n')}\n`, errors: [] };
}