/**
 * R1 research read: dump the SOO-Assigns-Import tab's raw grid (A1:O1068)
 * through the authenticated GoogleSheetsService — the same request path B2's
 * writer will use. Writes JSON + compact TSV to /tmp for analysis, and prints
 * a geometry summary. Read-only. Never prints secrets.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { GoogleSheetsService } from '../dist/src/services/google-sheets.js';

const svc = new GoogleSheetsService();
const meta = await svc.getTab();
const SHEET_ID = svc.sheetId;

// Full grid of the tab: A1:O1068 (the tab is 1068x15).
const qs = 'valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS&dateTimeRenderOption=SERIAL_NUMBER';
const path = `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${meta.title}!A1:O${meta.rowCount}`)}?${qs}`;
const out = await svc.request(path);

const rows = (out.values ?? []);
console.log('OK tab =', meta.title, '| sheetId =', meta.sheetId, '| workbook =', meta.workbookTitle);
console.log('OK fetched rows =', rows.length);
console.log('OK outer range =', out.range ?? '(unset)');

writeFileSync('/tmp/r1-grid.json', JSON.stringify(rows));
const tsv = rows.map((r) => (r ?? []).map((c) => String(c ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
writeFileSync('/tmp/r1-grid.tsv', tsv);
console.log('OK wrote /tmp/r1-grid.json + /tmp/r1-grid.tsv');