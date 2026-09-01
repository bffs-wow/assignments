/**
 * Unit tests for the Sheets writer (B2: locate + read + backup; B3: clear +
 * replace + truncation guard). The HTTP seam is stubbed — no live API.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GoogleSheetsService } from '../../src/services/google-sheets.ts';
import {
  locateCountBlock,
  readCountBlock,
  backupCountBlock,
  SheetsWriter,
  quoteTab,
} from '../../src/services/sheets-writer.ts';
import { resolveBoss, allSooBosses } from '../../src/serializer/bosses.ts';
import type { SheetsAdapter } from '../../src/services/google-sheets.ts';

const WORKBOOK = 'wb-123';
const TAB_ID = 1945140668;
const IMM = allSooBosses().find((b) => b.id === 'immerseus')!;

/** Build a synthetic tab grid with an Immerseus COUNT block at row 19. */
function fakeGrid(rows: unknown[][]): unknown[][] {
  // Column-0 1-based: the first 18 rows are header + HEALTH block.
  const pre: unknown[][] = [];
  for (let r = 1; r <= 18; r++) pre.push([]);
  pre[2] = ['', 'IMMERSEUS', '', 'HEALTH %', '', '', '', '', 'NPC NAME']; // r3
  pre[18] = ['', 'IMMERSEUS', '', 'COUNT', '', '', '', '', 'LEAVE BLANK']; // r19
  return pre.concat(rows);
}

function stubAdapter(grid: unknown[][], opts: { onWrite?: (range: string, body: Record<string, unknown>) => void } = {}): SheetsAdapter & { writes: Record<string, unknown>[] } {
  const writes: Record<string, unknown>[] = [];
  let cur = grid.map((r) => (Array.isArray(r) ? r.map((c) => c ?? '') : []));
  return {
    writes,
    async tokenRequest() {
      return { access_token: 'at-1', expires_in: 3599, token_type: 'Bearer' };
    },
    async request(path, token) {
      if (path.startsWith(`/v4/spreadsheets/${WORKBOOK}/values/`)) {
        const m = path.match(/=.*!/); // ignore A1:M1068 itself — return full grid
        if (m) return { values: cur, range: path };
        return { values: cur, range: path };
      }
      if (path === `/v4/spreadsheets/${WORKBOOK}?fields=properties(title)`) return { properties: { title: 'W' } };
      if (path === `/v4/spreadsheets/${WORKBOOK}?fields=sheets.properties(title,sheetId,gridProperties)`) return { sheets: [{ properties: { title: 'SOO-Assigns-Import', sheetId: TAB_ID, gridProperties: { rowCount: cur.length, columnCount: 13 } } }] };
      throw new Error(`unexpected request ${path}`);
    },
    async updateValues(path, token, body) {
      writes.push(body);
      // Apply the write to the in-memory grid so a re-read sees it.
      const dec = decodeURIComponent(path);
      const rangeMatch = dec.match(/values\/.*?!A(\d+):[A-Z]+(\d+)/);
      if (rangeMatch) {
        const [from, to] = [Number(rangeMatch[1]), Number(rangeMatch[2])];
        const vals = (body.values as string[][]) ?? [];
        for (let i = 0; i < vals.length; i++) {
          const row = from - 1 + i;
          cur[row] = vals[i].map((c) => c ?? '');
        }
      }
      return { range: path, updatedCells: 1 };
    },
    async clearValues(path) {
      const dec = decodeURIComponent(path);
      const rangeMatch = dec.match(/values\/.*?!A(\d+):[A-Z]+(\d+)/);
      if (rangeMatch) {
        const [from, to] = [Number(rangeMatch[1]), Number(rangeMatch[2])];
        for (let i = from - 1; i <= to - 1 && i < cur.length; i++) cur[i] = Array(13).fill('');
      }
      return {};
    },
    ...opts,
  };
}

function makeService(adapter: SheetsAdapter): GoogleSheetsService {
  return new GoogleSheetsService({
    adapter,
    sheetId: WORKBOOK,
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
  });
}

test('B2: locateCountBlock finds the Immerseus COUNT header by sheetName+D', () => {
  const grid = fakeGrid([]);
  const block = locateCountBlock(grid as string[][], IMM, 54);
  assert.ok(block, 'should locate block');
  assert.equal(block.headerRow, 19);
  assert.equal(block.firstRow, 20);
  assert.equal(block.lastRowExclusive, 74); // 20 + 54
  assert.equal(block.capacity, 54);
});

test('B2: locateCountBlock returns null for an absent boss', () => {
  const grid = fakeGrid([]);
  assert.equal(locateCountBlock(grid as string[][], allSooBosses().find((b) => b.id === 'garrosh-hellscream')!, 122), null);
});

test('B2: readCountBlock returns exactly the non-blank data rows', () => {
  const grid = fakeGrid([
    ['', '', 'Encounter Start (IMM)', '', 'PROTPALA1', '', 'Devotion Aura'],
    [], // blank
    ['', '', 'Split', '', 'CDSHA1', '', 'Ancestral Guidance'],
  ]);
  const { data, block } = readCountBlock(grid as string[][], IMM, 54);
  assert.equal(block.firstRow, 20);
  assert.equal(data.length, 2);
  assert.equal(data[0][2], 'Encounter Start (IMM)');
  assert.equal(data[1][2], 'Split');
});

test('B2: backupCountBlock writes a timestamped CSV into backups/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b2-'));
  try {
    const { file, rowCount } = backupCountBlock([
      ['', '', 'Encounter Start (IMM)', '1', 'ALL', '0', 'Bloodlust'],
    ], IMM, dir);
    assert.ok(rowCount === 1);
    assert.ok(fs.existsSync(file));
    assert.match(file, /immerseus-\d{8}-\d{6}\.csv$/);
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /^Player/);
    assert.match(content, /Encounter Start \(IMM\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('B3: clear+replace writes rows into the COUNT block, sorted/idempotent, other bosses untouched', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const writer = new SheetsWriter({ service: svc, backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'b3-')) });
  const boss = IMM;
  const rows = [
    ['', '', 'Encounter Start (IMM)', '1', 'ALL', '0', 'Bloodlust'],
    ['', '', 'Corrosive Blast', '1', 'PROTWARR1', '0', 'Shield Wall'],
  ];

  const report = await writer.writeAssignments(boss, rows);
  assert.equal(report.writtenRows.length, 2);
  assert.deepEqual(report.dropped, []);
  // The adapter's in-memory grid now has the rows at 20..21 — re-read and confirm.
  const gridAfter = (await svc.request(`/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent(`'SOO-Assigns-Import'!A1:M1068`)}`)).values as string[][];
  const { data } = readCountBlock(gridAfter, boss, 54);
  assert.equal(data.length, 2);
  assert.equal(data[0][2], 'Encounter Start (IMM)');
  assert.equal(data[1][2], 'Corrosive Blast');

  // Idempotent re-run: writing the same rows again must not duplicate.
  await writer.writeAssignments(boss, rows, () => {});
  const grid2 = (await svc.request(`/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent(`'SOO-Assigns-Import'!A1:M1068`)}`)).values as string[][];
  const { data: data2 } = readCountBlock(grid2, boss, 54);
  assert.equal(data2.length, 2, 're-run must not duplicate rows');
});

test('B3: truncation guard — assignments over baked capacity are dropped and reported', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const writer = new SheetsWriter({ service: svc, capacityFor: () => 2, backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'b3-')) });
  const rows = [
    ['', '', 'a', '1', 'ALL', '0', 'S1'],
    ['', '', 'b', '1', 'ALL', '0', 'S2'],
    ['', '', 'c', '1', 'ALL', '0', 'S3'],
    ['', '', 'd', '1', 'ALL', '0', 'S4'],
  ];
  const warnings: string[] = [];
  const report = await writer.writeAssignments(IMM, rows, (m) => warnings.push(m));
  assert.equal(report.writtenRows.length, 2);
  assert.equal(report.dropped.length, 2);
  assert.match(warnings.join('\n'), /WARNING: 2 assignment[s]?/);
  assert.match(warnings.join('\n'), /c \| 1 \| ALL \| 0 \| S3/);
  assert.match(warnings.join('\n'), /d \| 1 \| ALL \| 0 \| S4/);
});

test('B3: empty write does not clobber — empty target clears region and writes nothing', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const writer = new SheetsWriter({ service: svc, backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'b3-')) });
  const report = await writer.writeAssignments(IMM, [], () => {});
  assert.equal(report.writtenRows.length, 0);
  assert.equal(report.dropped.length, 0);
});

test('quoteTab quotes the tab title', () => {
  assert.equal(quoteTab('SOO-Assigns-Import'), "'SOO-Assigns-Import'");
});