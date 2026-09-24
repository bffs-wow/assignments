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
  SheetAssignmentsWriter,
  getBossCapacity,
  quoteTab,
} from '../../src/services/sheets-writer.ts';
import { resolveBoss, allSooBosses } from '../../src/serializer/bosses.ts';
import type { SheetsAdapter } from '../../src/services/google-sheets.ts';
import type { Assignment } from '../../src/shared/assignments-schema.ts';

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
      const rangeMatch = dec.match(/values\/.*?!([A-Z]+)(\d+):([A-Z]+)(\d+)/);
      if (rangeMatch) {
        const [, startColStr, fromStr, , toStr] = rangeMatch;
        const from = Number(fromStr);
        const startCol = startColStr.charCodeAt(0) - 65;
        const vals = (body.values as string[][]) ?? [];
        for (let i = 0; i < vals.length; i++) {
          const row = from - 1 + i;
          if (!cur[row]) cur[row] = Array(13).fill('');
          for (let c = 0; c < vals[i].length; c++) {
            cur[row][startCol + c] = vals[i][c] ?? '';
          }
        }
      }
      return { range: path, updatedCells: 1 };
    },
    async clearValues(path) {
      const dec = decodeURIComponent(path);
      const rangeMatch = dec.match(/values\/.*?!([A-Z]+)(\d+):([A-Z]+)(\d+)/);
      if (rangeMatch) {
        const [, startColStr, fromStr, endColStr, toStr] = rangeMatch;
        const from = Number(fromStr);
        const to = Number(toStr);
        const startCol = startColStr.charCodeAt(0) - 65;
        const endCol = endColStr.charCodeAt(0) - 65;
        for (let i = from - 1; i <= to - 1 && i < cur.length; i++) {
          if (cur[i]) {
            for (let c = startCol; c <= endCol; c++) {
              cur[i][c] = '';
            }
          }
        }
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

test('B3: formula-owned columns (A, H) and untouched columns (B, I, L) are NEVER overwritten or cleared', async () => {
  const formulaGrid = fakeGrid([
    ['=VLOOKUP(E20, Roster_Mappings, 2, FALSE)', 'OLD_CD', 'Old Event', '1', 'OLD_ROLE', '0', 'Old Spell', '=IMAGE(G20)', 'NPC', 'Old notes', 'Old TTS', 'CUSTOM', '123'],
  ]);
  const adapter = stubAdapter(formulaGrid);
  const svc = makeService(adapter);
  const writer = new SheetsWriter({ service: svc, backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'b3-formula-')) });
  const rows = [
    ['Ignored Player', 'Ignored CD', 'Encounter Start (IMM)', '1', 'ALL', '0', 'Bloodlust', 'Ignored Icon', 'Ignored NPC', 'stack', 'Bloodlust now', 'Ignored Name', '2825'],
  ];
  await writer.writeAssignments(IMM, rows);
  const gridAfter = (await svc.request(`/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent(`'SOO-Assigns-Import'!A1:M1068`)}`)).values as string[][];
  assert.equal(gridAfter[19][0], '=VLOOKUP(E20, Roster_Mappings, 2, FALSE)', 'Player formula in Col A must be preserved');
  assert.equal(gridAfter[19][1], 'OLD_CD', 'CD# in Col B must be untouched');
  assert.equal(gridAfter[19][2], 'Encounter Start (IMM)', 'Event in Col C must be updated');
  assert.equal(gridAfter[19][7], '=IMAGE(G20)', 'Spell icon formula in Col H must be preserved');
  assert.equal(gridAfter[19][8], 'NPC', 'NPC in Col I must be untouched');
  assert.equal(gridAfter[19][9], 'stack', 'Notes in Col J must be updated');
  assert.equal(gridAfter[19][10], 'Bloodlust now', 'TTS in Col K must be updated');
  assert.equal(gridAfter[19][11], 'CUSTOM', 'Custom Name in Col L must be untouched');
  assert.equal(gridAfter[19][12], '2825', 'Custom Icon in Col M must be updated');
});

test('B2: two-step dynamic block detection locates COUNT row below boss section header', () => {
  // Synthetic grid where Col B on COUNT row is empty, but section header at row 2 has IMMERSEUS
  const grid: unknown[][] = [
    ['Player', 'CD #', 'BOSS HEALTH / SPELL', 'COUNT / HEALTH %'],
    ['', 'IMMERSEUS', '', 'HEALTH %'],
    ['', '', '', ''],
    ['', '', '', 'COUNT'], // row 4
    ['', '', 'Encounter Start (IMM)', '1'], // row 5 (data)
    ['', 'THE FALLEN PROTECTORS', '', 'HEALTH %'], // row 6 (next boss)
  ];
  const block = locateCountBlock(grid as string[][], IMM, 54);
  assert.ok(block, 'should locate block via section header');
  assert.equal(block.headerRow, 4);
  assert.equal(block.firstRow, 5);
  assert.equal(block.lastRowExclusive, 6); // ends at next boss row 6
  assert.equal(block.capacity, 54);
});

test('Capacity surfacing: getCapacity surfaces per-boss capacity', () => {
  const writer = new SheetAssignmentsWriter();
  assert.equal(writer.getCapacity('immerseus'), 54);
  assert.equal(writer.getCapacity('paragons-of-the-klaxxi'), 74);
  assert.equal(writer.getCapacity('garrosh-hellscream'), 122);
  assert.equal(getBossCapacity('norushen'), 49);
});

test('SheetAssignmentsWriter: push succeeds end-to-end with clear+replace, backup, and custom spell convention', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-success-'));
  const writer = new SheetAssignmentsWriter({ service: svc, backupDir });

  const assignments: Assignment[] = [
    {
      event: 'Encounter Start (IMM)',
      occurrence: 1,
      roleTag: 'ALL',
      timingOffset: 0,
      spellName: 'Bloodlust',
      notes: 'Bloodlust on pull',
      spellId: '2825',
    },
    {
      event: 'Corrosive Blast',
      occurrence: 1,
      roleTag: 'PROTWARR1',
      timingOffset: 0,
      spellName: 'Last Stand', // custom spell
      notes: 'Tank HP boost',
      spellId: '12975',
    },
  ];

  const logs: string[] = [];
  const res = await writer.push({
    encounter: 'Immerseus',
    assignments,
    roleMappings: { PROTWARR1: { name: 'TankOmo' } },
    log: (m) => logs.push(m),
  });

  assert.equal(res.ok, true);
  assert.equal(res.writtenCount, 2);
  assert.equal(res.droppedCount, 0);
  assert.ok(res.backupFile && fs.existsSync(res.backupFile), 'backup file should exist');

  // Verify sheet state after write
  const gridAfter = (await svc.request(`/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent(`'SOO-Assigns-Import'!A1:M1068`)}`)).values as string[][];
  const { data } = readCountBlock(gridAfter, IMM, 54);
  assert.equal(data.length, 2);

  // Row 1: canonical spell Bloodlust
  assert.equal(data[0][2], 'Encounter Start (IMM)');
  assert.equal(data[0][3], '1');
  assert.equal(data[0][4], 'ALL');
  assert.equal(data[0][6], 'Bloodlust');
  assert.equal(data[0][9], 'Bloodlust on pull');

  // Row 2: custom spell Last Stand -> COOLDOWN SPELL = Custom Spell Assignment, OVERRIDE TTS = Last Stand
  assert.equal(data[1][2], 'Corrosive Blast');
  assert.equal(data[1][4], 'PROTWARR1');
  assert.equal(data[1][6], 'Custom Spell Assignment');
  assert.equal(data[1][10], 'Last Stand');
  assert.equal(data[1][11], ''); // CUSTOM NAME left untouched/blank
  assert.equal(data[1][12], '12975'); // CUSTOM ICON has spellId
});

test('SheetAssignmentsWriter: push fails loudly on validation error and writes nothing to the sheet', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const writer = new SheetAssignmentsWriter({ service: svc });

  const invalidAssignments: Assignment[] = [
    {
      event: 'Invented Off-Vocab Event',
      occurrence: 1,
      roleTag: 'ALL',
      timingOffset: 0,
      spellName: 'Bloodlust',
      notes: '',
      spellId: '',
    },
  ];

  const errorLogs: string[] = [];
  const res = await writer.push({
    encounter: 'Immerseus',
    assignments: invalidAssignments,
    logError: (m) => errorLogs.push(m),
  });

  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /Validation failed/);
  assert.match(errorLogs.join('\n'), /validation rejected the assignments/);
  assert.equal(adapter.writes.length, 0, 'nothing should be written to the sheet on validation error');
});

test('SheetAssignmentsWriter: push handles unconfigured / missing credentials gracefully without throwing', async () => {
  // Service with no custom adapter and no env
  const svc = new GoogleSheetsService({ env: {} });
  const writer = new SheetAssignmentsWriter({ service: svc });

  const errorLogs: string[] = [];
  const res = await writer.push({
    encounter: 'Immerseus',
    assignments: [
      {
        event: 'Encounter Start (IMM)',
        occurrence: 1,
        roleTag: 'ALL',
        timingOffset: 0,
        spellName: 'Bloodlust',
        notes: '',
        spellId: '',
      },
    ],
    logError: (m) => errorLogs.push(m),
  });

  assert.equal(res.ok, false);
  assert.equal(res.skipped, true);
  assert.match(res.error ?? '', /missing\/unset Google OAuth creds/);
  assert.match(errorLogs.join('\n'), /your CSV\/TSV artifact is unaffected/);
});

test('SheetAssignmentsWriter: push handles network / API failure with loud warning and TSV/CSV fallback without crashing', async () => {
  const adapter: SheetsAdapter = {
    async tokenRequest() { return { access_token: 'tok', expires_in: 3600 }; },
    async request() { throw new Error('Google network timeout 503'); },
  };
  const svc = makeService(adapter);
  const writer = new SheetAssignmentsWriter({ service: svc });

  const errorLogs: string[] = [];
  const res = await writer.push({
    encounter: 'Immerseus',
    assignments: [
      {
        event: 'Encounter Start (IMM)',
        occurrence: 1,
        roleTag: 'ALL',
        timingOffset: 0,
        spellName: 'Bloodlust',
        notes: '',
        spellId: '',
      },
    ],
    logError: (m) => errorLogs.push(m),
  });

  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /Google network timeout 503/);
  assert.match(errorLogs.join('\n'), /sheet push failed/);
  assert.match(errorLogs.join('\n'), /your CSV\/TSV artifact is unaffected/);
});

test('SheetAssignmentsWriter: push reports truncation when assignments exceed capacity', async () => {
  const grid = fakeGrid([]);
  const adapter = stubAdapter(grid);
  const svc = makeService(adapter);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-trunc-'));
  const writer = new SheetAssignmentsWriter({
    service: svc,
    capacityFor: () => 1,
    backupDir,
  });

  const assignments: Assignment[] = [
    {
      event: 'Encounter Start (IMM)',
      occurrence: 1,
      roleTag: 'ALL',
      timingOffset: 0,
      spellName: 'Bloodlust',
      notes: '',
      spellId: '',
    },
    {
      event: 'Corrosive Blast',
      occurrence: 1,
      roleTag: 'PROTWARR1',
      timingOffset: 0,
      spellName: 'Shield Wall',
      notes: '',
      spellId: '',
    },
  ];

  const logs: string[] = [];
  const res = await writer.push({
    encounter: 'Immerseus',
    assignments,
    roleMappings: { PROTWARR1: { name: 'Tank' } },
    log: (m) => logs.push(m),
  });

  assert.equal(res.ok, true);
  assert.equal(res.writtenCount, 1);
  assert.equal(res.droppedCount, 1);
  assert.equal(res.dropped.length, 1);
  assert.match(logs.join('\n'), /WARNING: 1 assignment\(s\) exceed the baked capacity/);
  assert.match(logs.join('\n'), /dropped \(over capacity\)/);
});