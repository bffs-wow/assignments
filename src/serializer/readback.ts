/**
 * SOO-Assigns-Import export-grid reader — lossless inverse of the renderer (T4).
 *
 * Reads an emitted sheet CSV back into the identical assignment set:
 *   - Parses the full CSV (header, 14 boss sections, scaffolding)
 *   - Identifies the target boss (the only boss with data rows in its COUNT block)
 *   - Extracts data rows from that boss's COUNT block
 *   - Reconstructs Assignment objects losslessly:
 *       event: col C
 *       occurrence: col D (parsed as integer if single count, string if comma list)
 *       roleTag: col E
 *       timingOffset: col F (parseFloat, negative ok)
 *       spellName: col G (if 'Custom Spell Assignment' use OVERRIDE TTS col K instead)
 *       notes: col J
 *       spellId: col M
 *       tts: col K (only if explicit override on a canonical spell)
 *       cd: col B (parseFloat, only if present)
 *   - Returns { assignments, bossId }
 */
import * as v from 'valibot';
import { assignmentSchema } from '../shared/assignments-schema.ts';
import type { Assignment } from '../shared/assignments-schema.ts';
import { allSooBosses, resolveBoss } from './bosses.ts';
import type { SooBoss } from './bosses.ts';
import {
  COL_CD,
  COL_EVENT,
  COL_COUNT,
  COL_ROLE,
  COL_TIME,
  COL_SPELL,
  COL_NPC,
  COL_ADDITIONAL_TEXT,
  COL_OVERRIDE_TTS,
  COL_CUSTOM_ICON,
  CUSTOM_SPELL_LITERAL,
} from './render.ts';

export interface ParseResult {
  /** Reconstructed assignments from the target boss COUNT block. */
  assignments: Assignment[];
  /** The target boss ID (baked id, e.g. 'paragons-of-the-klaxxi'), or '' if scaffolding-only. */
  bossId: string;
}

/** RFC 4180 compliant CSV parser that handles quotes, escaped quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentCell += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (ch === ',') {
        currentRow.push(currentCell);
        currentCell = '';
        i++;
        continue;
      } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (ch === '\n') {
        currentRow.push(currentCell);
        currentCell = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentCell += ch;
        i++;
        continue;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  // Drop trailing empty line if text ended with newline
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => (c ?? '').trim() === '');
}

function parseDataRow(row: string[]): Assignment | null {
  const event = row[COL_EVENT]?.trim();
  if (!event) return null;

  const rawCount = row[COL_COUNT]?.trim() ?? '';
  let occurrence: number | string = rawCount;
  if (/^-?\d+$/.test(rawCount)) {
    const n = Number.parseInt(rawCount, 10);
    if (!Number.isNaN(n)) {
      occurrence = n;
    }
  }

  const roleTag = row[COL_ROLE]?.trim() ?? '';

  const rawTime = row[COL_TIME]?.trim() ?? '0';
  const parsedTime = Number.parseFloat(rawTime);
  const timingOffset = Number.isNaN(parsedTime) ? 0 : parsedTime;

  const rawSpell = row[COL_SPELL]?.trim() ?? '';
  const rawOverrideTts = row[COL_OVERRIDE_TTS]?.trim() ?? '';

  let spellName = rawSpell;
  let tts: string | undefined;

  if (rawSpell === CUSTOM_SPELL_LITERAL) {
    spellName = rawOverrideTts;
  } else {
    if (rawOverrideTts !== '') {
      tts = rawOverrideTts;
    }
  }

  const notes = row[COL_ADDITIONAL_TEXT] ?? '';
  const spellId = row[COL_CUSTOM_ICON]?.trim() ?? '';

  const rawCd = row[COL_CD]?.trim();
  let cd: number | undefined;
  if (rawCd !== undefined && rawCd !== '') {
    const parsedCd = Number.parseFloat(rawCd);
    if (!Number.isNaN(parsedCd)) {
      cd = parsedCd;
    }
  }

  const candidate: Assignment = {
    event,
    occurrence,
    roleTag,
    timingOffset,
    spellName,
    notes,
    spellId,
  };
  if (tts !== undefined) candidate.tts = tts;
  if (cd !== undefined) candidate.cd = cd;

  const res = v.safeParse(assignmentSchema, candidate);
  return res.success ? res.output : candidate;
}

/**
 * Lossless read-back of a sheet-compliant CSV (the inverse of renderSooAssigns).
 *
 * Scans the full CSV grid, locates the target boss COUNT block with data rows,
 * and reconstructs the Assignment array and bossId.
 */
export function parseSooAssigns(csv: string): ParseResult {
  const rows = parseCsv(csv);
  if (rows.length === 0) {
    return { assignments: [], bossId: '' };
  }

  const bosses = allSooBosses();
  const bossByAbbr = new Map<string, SooBoss>();
  for (const b of bosses) {
    bossByAbbr.set(b.abbr.toUpperCase(), b);
  }

  const dataRowsByBoss = new Map<string, string[][]>();
  for (const b of bosses) {
    dataRowsByBoss.set(b.id, []);
  }

  let currentBoss: SooBoss | undefined;
  let inCountBlock = false;

  for (const row of rows) {
    // 1. Header row
    if (row[COL_EVENT] === 'BOSS HEALTH / SPELL' || row[COL_CD] === 'CD #') {
      continue;
    }

    // 2. Health % scaffold row
    const healthMatch = row[COL_EVENT]?.match(/^Health % \(([A-Z]+)\)$/i);
    if (healthMatch && (!row[COL_ROLE] || row[COL_ROLE] === '')) {
      inCountBlock = false;
      const abbr = healthMatch[1].toUpperCase();
      const b = bossByAbbr.get(abbr);
      if (b) {
        currentBoss = b;
      }
      continue;
    }

    // Also check if NPC column has a boss name on row 1 of health block
    const bossByNpc = resolveBoss(row[COL_NPC]);
    if (bossByNpc && !inCountBlock) {
      currentBoss = bossByNpc;
    }

    // 3. Separator row
    if (row[COL_NPC]?.trim().toUpperCase() === 'LEAVE BLANK') {
      inCountBlock = false;
      continue;
    }

    // 4. COUNT header row
    if (row[COL_COUNT]?.trim().toUpperCase() === 'COUNT' && (!row[COL_ROLE] || row[COL_ROLE] === '')) {
      inCountBlock = true;
      const bFromCd = resolveBoss(row[COL_CD]);
      if (bFromCd) {
        currentBoss = bFromCd;
      }
      continue;
    }

    // 5. Data rows in target COUNT block
    if (inCountBlock && currentBoss) {
      if (isBlankRow(row)) {
        continue;
      }
      // Must have an event name
      const event = row[COL_EVENT]?.trim();
      if (!event) {
        continue;
      }
      dataRowsByBoss.get(currentBoss.id)!.push(row);
    }
  }

  // Find boss with data rows
  const bossesWithData = bosses.filter((b) => (dataRowsByBoss.get(b.id)?.length ?? 0) > 0);
  if (bossesWithData.length === 0) {
    // Fallback: what if CSV was only data rows without full scaffold?
    for (const b of bosses) {
      const matchingRows: string[][] = [];
      for (const row of rows) {
        if (row[COL_EVENT] === 'BOSS HEALTH / SPELL' || row[COL_CD] === 'CD #') continue;
        if (row[COL_COUNT]?.trim().toUpperCase() === 'COUNT') continue;
        if (row[COL_NPC]?.trim().toUpperCase() === 'LEAVE BLANK') continue;
        if (row[COL_EVENT]?.match(/^Health % \(([A-Z]+)\)$/i)) continue;
        if (isBlankRow(row)) continue;
        if (b.events.includes(row[COL_EVENT]?.trim() ?? '')) {
          matchingRows.push(row);
        }
      }
      if (matchingRows.length > 0) {
        const assignments: Assignment[] = [];
        for (const r of matchingRows) {
          const a = parseDataRow(r);
          if (a) assignments.push(a);
        }
        return { assignments, bossId: b.id };
      }
    }
    return { assignments: [], bossId: '' };
  }

  const targetBoss = bossesWithData[0];
  const targetDataRows = dataRowsByBoss.get(targetBoss.id) ?? [];
  const assignments: Assignment[] = [];
  for (const r of targetDataRows) {
    const a = parseDataRow(r);
    if (a) assignments.push(a);
  }

  return {
    assignments,
    bossId: targetBoss.id,
  };
}
