/**
 * Live smoke for B1: mints a real access token from .env and resolves the
 * SOO-Assigns-Import tab geometry. Reads only; run from the repo root after
 * `npm test` (which builds dist). Never prints secrets.
 */
import 'dotenv/config';
import { GoogleSheetsService } from '../dist/src/services/google-sheets.js';

const svc = new GoogleSheetsService();
const meta = await svc.getTab();
console.log('OK workbookTitle =', meta.workbookTitle);
console.log('OK tab =', meta.title, '| sheetId =', meta.sheetId, '| grid =', meta.rowCount, 'x', meta.columnCount);
console.log('OK tokenCalls =', svc.tokenCalls, '(auth minted once, reused)');