/**
 * Google Sheets writer (B2/B3/B4) — COUNT-block location, timestamped backup,
 * clear+replace writes, and the single public push operation for SOO-Assigns-Import.
 *
 * One tested module boundary (SheetAssignmentsWriter) owns the entire sheet
 * interaction behind a single public operation (push assignments for one encounter):
 *   - OAuth / token handling & credentials presence
 *   - Tab + block detection: boss section found dynamically by sheetName in col B;
 *     COUNT block = region below row whose col D reads 'COUNT', ending at next
 *     boss's section header
 *   - Pre-write timestamped backup of existing non-blank rows
 *   - Clear + replace: data columns (C..G, J..K, M) are cleared and written;
 *     formula-owned columns (Player col A, spell-icon col H) and untouched columns
 *     (CD# col B, NPC col I, CUSTOM NAME col L) are NEVER overwritten
 *   - Capacity / truncation: assignments exceeding capacity are dropped with a
 *     loud warning listing every dropped row; capacity is surfaced via getCapacity
 *   - Custom-assignment column convention: col K OVERRIDE TTS carries the real
 *     spell, col M CUSTOM ICON carries the spell ID
 *   - Failure policy: sheet errors produce loud warnings with local CSV/TSV
 *     fallback; pipeline never hard-fails
 */
import fs from 'node:fs';
import path from 'node:path';

import { GoogleSheetsService, GoogleSheetsError, sheetsCredsPresent } from './google-sheets.ts';
import type { SheetsAdapter } from './google-sheets.ts';
import { allSooBosses, resolveBoss } from '../serializer/bosses.ts';
import type { SooBoss } from '../serializer/bosses.ts';
import { renderCountRows } from '../serializer/render.ts';
import type { Assignment } from '../shared/assignments-schema.ts';

export interface CountBlock {
  /** 1-based sheet row of the COUNT header (B=sheetName or D=COUNT). */
  headerRow: number;
  /** 1-based sheet row of the first data row (headerRow + 1). */
  firstRow: number;
  /** 1-based sheet row just after the last data row (== next block's header or capacity bound). */
  lastRowExclusive: number;
  /** The per-boss capacity (rows available below the header). */
  capacity: number;
  /** The boss this block belongs to (via baked catalog). */
  boss: SooBoss;
}

export interface CountBlockLocation {
  tab: string;
  block: CountBlock;
  /** All rows returned by the values read (in sheet order). */
  rows: string[][];
}

export interface BackupResult {
  /** Absolute path to the timestamped backup CSV. */
  file: string;
  /** Number of non-blank data rows backed up. */
  rowCount: number;
}

export interface WriteReport {
  block: CountBlock;
  /** Rows written (13 columns each, after the header row). */
  writtenRows: string[][];
  /** Assignments that overflowed capacity and were dropped. */
  dropped: string[];
  /** Absolute path to the pre-write backup CSV. */
  backupFile?: string;
}

export interface PushOptions {
  /** The boss encounter (name, id, or SooBoss). */
  encounter: string | SooBoss;
  /** Assignments to push (will be validated and rendered into COUNT rows). */
  assignments: Assignment[];
  /** Role mappings for resolving player bindings. */
  roleMappings?: Record<string, unknown> | null;
  /** Optional logger (defaults to console.log). */
  log?: (msg: string) => void;
  /** Optional error logger (defaults to console.error). */
  logError?: (msg: string) => void;
}

export interface PushResult {
  ok: boolean;
  block?: CountBlock;
  writtenCount: number;
  droppedCount: number;
  dropped: string[];
  backupFile?: string;
  error?: string;
  skipped?: boolean;
}

/** Parse a bare tab title into a quoted Sheets A1 range component. */
export function quoteTab(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Normalize a cell to trim + strip enclosing quotes — the API sometimes returns '"x"' for a formula. */
function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;
}

/** Non-blank test for a data row: at least one of the 13 data columns has a value. */
function isBlankRow(row: string[], width = 13): boolean {
  for (let i = 0; i < width; i++) {
    if ((row[i] ?? '') !== '') return false;
  }
  return true;
}

const CSV_HEADER = ['Player', 'CD #', 'BOSS HEALTH / SPELL', 'COUNT / HEALTH %', 'PLAYER / CLASS / ALL', 'TIME', 'COOLDOWN SPELL', '', 'NPC NAME', 'ADDITIONAL TEXT', 'OVERRIDE TTS', 'CUSTOM NAME', 'CUSTOM ICON']
  .map((c, i) => (i === 0 ? c : `"${c}"`))
  .join(',') + '\n';

function toCsv(row: string[]): string {
  return row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

/** Resolve the baked per-boss capacity (R1) — the sheet layout is frozen within a tier; no runtime scan. */
const CAPACITIES: Record<string, number> = {
  'immerseus': 54,
  'the-fallen-protectors': 52,
  'norushen': 49,
  'sha-of-pride': 54,
  'galakras': 51,
  'iron-juggernaut': 51,
  'korkron-dark-shaman': 51,
  'general-nazgrim': 51,
  'malkorok': 51,
  'spoils-of-pandaria': 51,
  'thok-the-bloodthirsty': 64,
  'siegecrafter-blackfuse': 51,
  'paragons-of-the-klaxxi': 74,
  'garrosh-hellscream': 122,
};

function defaultCapacity(bossId: string): number {
  return CAPACITIES[bossId] ?? 50;
}

export function getBossCapacity(
  encounter: string | SooBoss,
  capacityFor: (bossId: string) => number = defaultCapacity,
): number {
  const boss = typeof encounter === 'string' ? resolveBoss(encounter) : encounter;
  if (!boss) return 0;
  return capacityFor(boss.id);
}

function buildBlock(
  rows: string[][],
  boss: SooBoss,
  headerIndex: number,
  capacity: number,
): CountBlock {
  const headerRow = headerIndex + 1; // 1-based
  const firstRow = headerRow + 1;
  let end = firstRow + capacity;
  for (let j = headerIndex + 1; j < Math.min(firstRow + capacity, rows.length); j++) {
    const bb = cellStr(rows[j]?.[1]).trim().toUpperCase();
    const dd = cellStr(rows[j]?.[3]).trim().toUpperCase();
    const ii = cellStr(rows[j]?.[8]).trim().toUpperCase();
    if (bb && (dd === 'COUNT' || dd === 'HEALTH %')) {
      end = j + 1;
      break;
    }
    if (ii === 'NPC NAME' && j + 1 < rows.length) {
      end = j + 1;
      break;
    }
  }
  return {
    headerRow,
    firstRow,
    lastRowExclusive: end,
    capacity,
    boss,
  };
}

/**
 * Count-block location (B2) — dynamic, header-driven.
 *
 * Scans the tab's values grid for the target boss's COUNT block:
 * 1. Direct match: row where column B equals the baked sheetName AND column D equals "COUNT".
 * 2. Section header match: row where column B equals (or contains) the baked sheetName,
 *    followed by a row where column D equals "COUNT" within that section.
 *
 * The data region spans from headerRow + 1 up to the next boss's section header
 * (or firstRow + capacity, whichever is smaller).
 */
export function locateCountBlock(
  rows: string[][],
  boss: SooBoss,
  capacity: number = defaultCapacity(boss.id),
): CountBlock | null {
  const sheetName = boss.sheetName.toUpperCase();

  // 1. Direct match: row where column B == sheetName AND column D == "COUNT"
  for (let i = 0; i < rows.length; i++) {
    const b = cellStr(rows[i]?.[1]).trim().toUpperCase();
    const d = cellStr(rows[i]?.[3]).trim().toUpperCase();
    if (b === sheetName && d === 'COUNT') {
      return buildBlock(rows, boss, i, capacity);
    }
  }

  // 2. Section header match: row where column B == sheetName (or contains it),
  // followed by a row where column D == "COUNT"
  for (let i = 0; i < rows.length; i++) {
    const b = cellStr(rows[i]?.[1]).trim().toUpperCase();
    if (b === sheetName || (b.length > 3 && b.includes(sheetName))) {
      for (let j = i + 1; j < rows.length; j++) {
        const nextB = cellStr(rows[j]?.[1]).trim().toUpperCase();
        const nextD = cellStr(rows[j]?.[3]).trim().toUpperCase();
        if (nextD === 'COUNT') {
          return buildBlock(rows, boss, j, capacity);
        }
        // If we hit another boss's section header before COUNT, break
        if (nextB && nextB !== sheetName && (nextD === 'COUNT' || nextD === 'HEALTH %')) {
          break;
        }
      }
    }
  }

  return null;
}

/**
 * Read the existing non-blank data rows of a COUNT block (B2). Returns the
 * rows as raw string arrays plus the block geometry.
 */
export function readCountBlock(
  rows: string[][],
  boss: SooBoss,
  capacity: number = defaultCapacity(boss.id),
): { data: string[][]; block: CountBlock } {
  const block = locateCountBlock(rows, boss, capacity);
  if (!block) throw new GoogleSheetsError('MISSING_SHEET',
    `COUNT block for "${boss.sheetName}" not found — headers changed? (expect B="${boss.sheetName}" AND D="COUNT")`);
  const data: string[][] = [];
  for (let r = block.firstRow - 1; r < block.lastRowExclusive - 1 && r < rows.length; r++) {
    const row = (rows[r] ?? []);
    if (!isBlankRow(row)) data.push(row);
  }
  return { data, block };
}

/** RFC-ish timestamp for backup filenames, e.g. 20260822-211530. */
function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * B2 pre-write backup: write the existing non-blank COUNT rows to
 * `backups/<sheetName>-<timestamp>.csv` (dir created; gitignored). No write
 * happens to the sheet itself.
 */
export function backupCountBlock(
  data: string[][],
  boss: SooBoss,
  backupDir = 'backups',
): BackupResult {
  const slug = boss.sheetName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `${slug}-${timestamp()}.csv`);
  const csv = `${CSV_HEADER}${data.map(toCsv).join('\n')}${data.length ? '\n' : ''}`;
  fs.writeFileSync(file, csv);
  return { file, rowCount: data.length };
}

export interface SheetAssignmentsWriterOptions {
  service?: GoogleSheetsService;
  adapter?: SheetsAdapter;
  env?: Record<string, string | undefined>;
  backupDir?: string;
  capacityFor?: (bossId: string) => number;
}

export type SheetsWriterOptions = SheetAssignmentsWriterOptions;

/**
 * SheetAssignmentsWriter owns the entire Google Sheets interaction behind ONE
 * public operation (`push` / `pushEncounter`).
 *
 * Composes:
 * - OAuth / token handling
 * - Dynamic block detection (sheetName in col B, COUNT in col D)
 * - Pre-write backup of previous non-blank rows
 * - Clear + replace with preservation of formula columns (Player col A, spell-icon col H)
 * - Truncation guard with loud warning listing dropped rows
 * - Failure fallback: errors produce loud warnings while CSV/TSV artifact remains unaffected
 */
export class SheetAssignmentsWriter {
  readonly service: GoogleSheetsService;
  readonly capacityFor: (bossId: string) => number;
  readonly backupDir: string;

  constructor(options: SheetAssignmentsWriterOptions = {}) {
    this.service = options.service ?? new GoogleSheetsService({
      adapter: options.adapter,
      env: options.env,
    });
    this.capacityFor = options.capacityFor ?? defaultCapacity;
    this.backupDir = options.backupDir ?? 'backups';
  }

  /** Whether the writer has valid OAuth credentials configured to push. */
  hasCredentials(): boolean {
    if (this.service.hasCustomAdapter && Boolean(this.service.sheetId)) {
      return true;
    }
    return sheetsCredsPresent(process.env);
  }

  /** Surface per-boss capacity so generator plans fit. */
  getCapacity(encounter: string | SooBoss): number {
    return getBossCapacity(encounter, this.capacityFor);
  }

  /**
   * Clear + replace the target COUNT region for `boss`.
   *
   * Only data columns (C..G, J..K, M) are cleared and written.
   * Formula-owned columns (Player col A, spell-icon col H) and untouched
   * columns (CD# col B, NPC col I, CUSTOM NAME col L) are NEVER overwritten.
   */
  async writeAssignments(
    boss: SooBoss,
    rows: string[][],
    log: (msg: string) => void = console.log,
  ): Promise<WriteReport> {
    const grid = await this.readGrid();
    const { data: existing, block } = readCountBlock(grid.rows, boss, this.capacityFor(boss.id));
    const backup = backupCountBlock(existing, boss, this.backupDir);
    log(`[sheets] backed up ${backup.rowCount} existing row(s) -> ${backup.file}`);

    const target = rows.slice(0, block.capacity);
    const dropped = rows.slice(block.capacity);
    if (dropped.length) {
      log(`\n[sheets] WARNING: ${dropped.length} assignment(s) exceed the baked capacity (${block.capacity}) for ${boss.sheetName} — dropped:`);
      for (const r of dropped) log(`  - ${r.join(' | ')}`);
      log('');
    }

    // Clear data columns only (preserving formula columns A and H, and untouched B, I, L)
    await this.clearRegion(block);

    let writtenRows: string[][] = [];
    if (target.length) {
      const endRow = block.firstRow + target.length - 1;
      const base = `/v4/spreadsheets/${encodeURIComponent(this.service.sheetId ?? '')}/values/`;

      // 1. Columns C..G: BOSS HEALTH / SPELL, COUNT, PLAYER/CLASS/ALL, TIME, COOLDOWN SPELL
      const rangeCG = `${quoteTab(grid.tab)}!C${block.firstRow}:G${endRow}`;
      const valuesCG = target.map((r) => [r[2] ?? '', r[3] ?? '', r[4] ?? '', r[5] ?? '', r[6] ?? '']);
      await this.service.updateValues(
        `${base}${encodeURIComponent(rangeCG)}?valueInputOption=RAW`,
        { range: rangeCG, majorDimension: 'ROWS', values: valuesCG },
      );

      // 2. Columns J..K: ADDITIONAL TEXT (notes), OVERRIDE TTS
      const rangeJK = `${quoteTab(grid.tab)}!J${block.firstRow}:K${endRow}`;
      const valuesJK = target.map((r) => [r[9] ?? '', r[10] ?? '']);
      await this.service.updateValues(
        `${base}${encodeURIComponent(rangeJK)}?valueInputOption=RAW`,
        { range: rangeJK, majorDimension: 'ROWS', values: valuesJK },
      );

      // 3. Column M: CUSTOM ICON (spell id)
      const rangeM = `${quoteTab(grid.tab)}!M${block.firstRow}:M${endRow}`;
      const valuesM = target.map((r) => [r[12] ?? '']);
      await this.service.updateValues(
        `${base}${encodeURIComponent(rangeM)}?valueInputOption=RAW`,
        { range: rangeM, majorDimension: 'ROWS', values: valuesM },
      );

      writtenRows = target;
    }
    log(`[sheets] wrote ${writtenRows.length} row(s) to ${boss.sheetName} COUNT block (rows ${block.firstRow}..${block.firstRow + writtenRows.length - 1})`);
    return { block, writtenRows, dropped: dropped.map((r) => r.join('|')), backupFile: backup.file };
  }

  /**
   * The ONE public operation: push assignments for one encounter to the sheet.
   *
   * Re-renders and validates assignments against the boss vocabulary, checks
   * OAuth credentials, backs up existing rows, and performs an idempotent
   * clear + replace write.
   *
   * On failure, logs a loud warning and returns `{ ok: false, error }` without
   * hard-failing the pipeline.
   */
  async push(options: PushOptions): Promise<PushResult> {
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;

    const boss = typeof options.encounter === 'string' ? resolveBoss(options.encounter) : options.encounter;
    if (!boss) {
      const msg = `unknown encounter "${options.encounter}" — use a SOO boss name or id`;
      logError(`\n[push] ${msg}`);
      return { ok: false, writtenCount: 0, droppedCount: 0, dropped: [], error: msg };
    }

    if (!this.hasCredentials()) {
      const msg = 'missing/unset Google OAuth creds (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/SHEET_ID) — push skipped.';
      logError(`\n[push] ${msg}`);
      logError('[push] your CSV/TSV artifact is unaffected.');
      return { ok: false, writtenCount: 0, droppedCount: 0, dropped: [], error: msg, skipped: true };
    }

    const { rows, errors } = renderCountRows({
      assignments: options.assignments,
      roleMappings: options.roleMappings,
      boss,
    });
    if (errors.length) {
      logError('\n[push] validation rejected the assignments — nothing written to the sheet:');
      for (const e of errors) logError(`  - ${e.field ? `${e.field}: ` : ''}${e.message}`);
      return {
        ok: false,
        writtenCount: 0,
        droppedCount: 0,
        dropped: [],
        error: `Validation failed: ${errors.map((e) => e.message).join('; ')}`,
      };
    }

    try {
      const report = await this.writeAssignments(boss, rows, log);
      log(`\n[push] done. ${report.writtenRows.length} row(s) in the ${boss.sheetName} COUNT block` +
        (report.dropped.length ? `; ${report.dropped.length} dropped (over capacity)` : '') +
        `. Backups in backups/.`);
      return {
        ok: true,
        block: report.block,
        writtenCount: report.writtenRows.length,
        droppedCount: report.dropped.length,
        dropped: report.dropped,
        backupFile: report.backupFile,
      };
    } catch (e) {
      const msg = errMsg(e);
      logError(`\n[push] sheet push failed (${msg}) — your CSV/TSV artifact is unaffected.`);
      return {
        ok: false,
        writtenCount: 0,
        droppedCount: 0,
        dropped: [],
        error: msg,
      };
    }
  }

  /** Alias for push. */
  async pushEncounter(options: PushOptions): Promise<PushResult> {
    return this.push(options);
  }

  /** Fetch the tab's values grid once (all rows A..M). */
  private async readGrid(): Promise<{ tab: string; rows: string[][] }> {
    const meta = await this.service.getTab();
    const tab = meta.title;
    const qs = 'valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS&dateTimeRenderOption=SERIAL_NUMBER';
    const path = `/v4/spreadsheets/${encodeURIComponent(this.service.sheetId ?? '')}/values/${encodeURIComponent(`${quoteTab(tab)}!A1:M${meta.rowCount}`)}?${qs}`;
    const out = await this.service.request(path);
    return { tab, rows: ((out.values ?? []) as unknown[][]).map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? '' : String(c))) : [])) };
  }

  private async clearRegion(block: CountBlock): Promise<void> {
    const meta = await this.service.getTab();
    const base = `/v4/spreadsheets/${encodeURIComponent(this.service.sheetId ?? '')}/values/`;
    const lastRow = block.lastRowExclusive - 1;

    // Clear data columns: C..G, J..K, M. Formulas in Col A and Col H and columns B, I, L are untouched.
    const rangeCG = `${quoteTab(meta.title)}!C${block.firstRow}:G${lastRow}`;
    await this.service.clearValues(`${base}${encodeURIComponent(rangeCG)}:clear`);

    const rangeJK = `${quoteTab(meta.title)}!J${block.firstRow}:K${lastRow}`;
    await this.service.clearValues(`${base}${encodeURIComponent(rangeJK)}:clear`);

    const rangeM = `${quoteTab(meta.title)}!M${block.firstRow}:M${lastRow}`;
    await this.service.clearValues(`${base}${encodeURIComponent(rangeM)}:clear`);
  }
}

/** Backward-compatible alias for SheetAssignmentsWriter. */
export const SheetsWriter = SheetAssignmentsWriter;
export type SheetsWriter = SheetAssignmentsWriter;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}