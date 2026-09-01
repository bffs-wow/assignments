/**
 * Sheets writer (B2/B3) — COUNT-block location, timestamped backup, and
 * clear+replace writes on the SOO-Assigns-Import tab.
 *
 * Design follows the R1 geometry: a boss's COUNT data region is located
 * dynamically from the sheet headers alone (B == baked sheetName AND
 * D == "COUNT"), never from a runtime capacity scan — the per-boss capacity
 * is baked (R1). The writer reads existing non-blank rows into a timestamped
 * local CSV backup before any write, then clear+replaces the target region
 * (B3) so other bosses' blocks are untouched.
 *
 * The HTTP surface extends the B1 auth seam: values read (existing
 * `request()` GET), `updateValues` (PUT), and `clearValues` (POST clear)
 * all run through the same injectable `SheetsAdapter` so unit tests stub the
 * network and no live token/sheet is touched.
 */
import fs from 'node:fs';
import path from 'node:path';

import { GoogleSheetsService, GoogleSheetsError } from './google-sheets.ts';
import type { SheetsAdapter } from './google-sheets.ts';
import { allSooBosses } from '../serializer/bosses.ts';
import type { SooBoss } from '../serializer/bosses.ts';

export interface CountBlock {
  /** 1-based sheet row of the COUNT header (B=sheetName, D=COUNT). */
  headerRow: number;
  /** 1-based sheet row of the first data row (headerRow + 1). */
  firstRow: number;
  /** 1-based sheet row just after the last data row (== next block's header). */
  lastRowExclusive: number;
  /** The baked per-boss capacity (rows available below the header). */
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

const TSV_HEADER = ['Player', 'CD #', 'BOSS HEALTH / SPELL', 'COUNT / HEALTH %', 'PLAYER / CLASS / ALL', 'TIME', 'COOLDOWN SPELL', '', 'NPC NAME', 'ADDITIONAL TEXT', 'OVERRIDE TTS', 'CUSTOM NAME', 'CUSTOM ICON'].join('\t') + '\n';

function toCsv(row: string[]): string {
  return row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
}

/**
 * Count-block location (B2) — dynamic, header-driven.
 *
 * Scans the tab's values grid for the row where column B equals the boss's
 * baked sheetName AND column D equals "COUNT". From that header it derives
 * the data region as the next `capacity` rows (capacity baked, no runtime
 * scan); the block ends earlier if the next section header interrupts it.
 */
export function locateCountBlock(
  rows: string[][],
  boss: SooBoss,
  capacity: number,
): CountBlock | null {
  const sheetName = boss.sheetName.toUpperCase();
  for (let i = 0; i < rows.length; i++) {
    const b = cellStr(rows[i]?.[1]).trim().toUpperCase();
    const d = cellStr(rows[i]?.[3]).trim().toUpperCase();
    if (b === sheetName && d === 'COUNT') {
      const headerRow = i + 1; // 1-based
      const firstRow = headerRow + 1;
      // The data region is bounded by the next section header (any boss's
      // HEALTH % / COUNT row) or the baked capacity — whichever is smaller.
      let end = firstRow + capacity;
      for (let j = i + 1; j < Math.min(firstRow + capacity, rows.length); j++) {
        const bb = cellStr(rows[j]?.[1]).trim().toUpperCase();
        const dd = cellStr(rows[j]?.[3]).trim().toUpperCase();
        if (bb && (dd === 'COUNT' || dd === 'HEALTH %')) { end = j; break; }
      }
      return {
        headerRow,
        firstRow,
        lastRowExclusive: end,
        capacity,
        boss,
      };
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
  capacity: number,
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
  const csv = `${TSV_HEADER}${data.map(toCsv).join('\n')}${data.length ? '\n' : ''}`;
  fs.writeFileSync(file, csv);
  return { file, rowCount: data.length };
}

/** 13-column write grid for assignment rows (sheet order matches the renderer). */

export interface SheetsWriterOptions {
  service: GoogleSheetsService;
  /** Baked per-boss capacity override (tests inject smaller capacities). */
  capacityFor?: (bossId: string) => number;
  backupDir?: string;
}

/**
 * B3: clear + replace the target COUNT region.
 *
 * - Locates the COUNT block dynamically (B2 rule)
 * - Reads + timestamp-backups the existing non-blank rows (B2)
 * - Clears the full data region, then writes fresh 13-col rows in order
 * - Backs up even when the block is empty (an empty pre-write backup is the
 *   recovery artifact — clear+replace is destructive).
 * - Truncation guard: assignments exceeding the baked capacity are dropped
 *   and reported loudly (every dropped row named).
 * Other bosses' COUNT blocks are untouched.
 */
export class SheetsWriter {
  private readonly service: GoogleSheetsService;
  private readonly capacityFor: (bossId: string) => number;
  private readonly backupDir: string;

  constructor(options: SheetsWriterOptions) {
    this.service = options.service;
    this.capacityFor = options.capacityFor ?? defaultCapacity;
    this.backupDir = options.backupDir ?? 'backups';
  }

  /**
   * Full write: read+backup, then clear+replace the COUNT region of `boss`.
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

    await this.clearRegion(block);
    let writtenRows: string[][] = [];
    if (target.length) {
      const range = `${quoteTab(grid.tab)}!A${block.firstRow}:M${block.firstRow + target.length - 1}`;
      await this.service.updateValues(
        `/v4/spreadsheets/${encodeURIComponent(this.service.sheetId ?? '')}/values/${encodeURIComponent(range)}`,
        { range, majorDimension: 'ROWS', values: target },
      );
      writtenRows = target;
    }
    log(`[sheets] wrote ${writtenRows.length} row(s) to ${boss.sheetName} COUNT block (rows ${block.firstRow}..${block.firstRow + writtenRows.length - 1})`);
    return { block, writtenRows, dropped: dropped.map((r) => r.join('|')) };
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
    const range = `${quoteTab(meta.title)}!A${block.firstRow}:M${block.lastRowExclusive - 1}`;
    await this.service.clearValues(`/v4/spreadsheets/${encodeURIComponent(this.service.sheetId ?? '')}/values/${encodeURIComponent(range)}:clear`);
  }
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
  return CAPACITIES[bossId] ?? 0;
}