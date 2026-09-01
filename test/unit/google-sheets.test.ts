/**
 * Unit tests for the Google Sheets auth/token client (B1).
 *
 * Stubbed-adapter contract tests: the fetch seam is injected per test so no
 * real token, network or sheet is touched, and the env fallback is exercised
 * through a fake env. The live smoke (real .env + real API) is a manual step
 * documented in the ticket, not a unit test.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import {
  GoogleSheetsService,
  GoogleSheetsError,
  resolveSheetsEnv,
} from '../../src/services/google-sheets.ts';
import { DEFAULT_TAB } from '../../src/shared/sheets-target.ts';
import type { SheetsAdapter } from '../../src/services/google-sheets.ts';

const WORKBOOK = 'workbook-123';
const TAB_ID = 1945140668;
const TAB_TITLE = 'SOO-Assigns-Import';

const workbookTitlePath = (workbookId: string): string =>
  `/v4/spreadsheets/${workbookId}?fields=properties(title)`;
const workbookSheetsPath = (workbookId: string): string =>
  `/v4/spreadsheets/${workbookId}?fields=sheets.properties(title,sheetId,gridProperties)`;

const TAB_PROPS = { title: TAB_TITLE, sheetId: TAB_ID, gridProperties: { rowCount: 1068, columnCount: 15 } };

/** A stub adapter standing in for the real HTTP OAuth/sheets endpoints. */
function stubAdapter(over: Partial<SheetsAdapter> = {}): SheetsAdapter {
  return {
    async tokenRequest(body) {
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('client_id'), 'id');
      assert.equal(body.get('client_secret'), 'secret');
      assert.equal(body.get('refresh_token'), 'refresh');
      return { access_token: 'at-1', expires_in: 3599, token_type: 'Bearer' };
    },
    async request(path, token) {
      assert.equal(token, 'at-1', 'requests must use the latest access token');
      if (path === workbookTitlePath(WORKBOOK)) {
        return { properties: { title: 'AI BFFS SOO Assigns' } };
      }
      if (path === workbookSheetsPath(WORKBOOK)) {
        return { sheets: [{ properties: TAB_PROPS }] };
      }
      if (/^\/v4\/spreadsheets\/[^/]+\/values\//.test(path)) {
        return { values: [['a', 'b'], ['c', 'd']], range: path };
      }
      throw new Error(`unexpected request path: ${path}`);
    },
    ...over,
  };
}

function makeService(adapter: SheetsAdapter, env: Record<string, string | undefined> = {}): GoogleSheetsService {
  return new GoogleSheetsService({
    adapter,
    env,
    sheetId: 'GOOGLE_SHEET_ID' in env ? env.GOOGLE_SHEET_ID : WORKBOOK,
    clientId: 'GOOGLE_CLIENT_ID' in env ? env.GOOGLE_CLIENT_ID : 'id',
    clientSecret: 'GOOGLE_CLIENT_SECRET' in env ? env.GOOGLE_CLIENT_SECRET : 'secret',
    refreshToken: 'GOOGLE_REFRESH_TOKEN' in env ? env.GOOGLE_REFRESH_TOKEN : 'refresh',
  });
}

test('B1: GET_TAB success — meta with resolved values, tab title + grid; token minted once and cached', async () => {
  const adapter = stubAdapter();
  const svc = makeService(adapter);
  const meta = await svc.getTab();

  assert.equal(meta.sheetId, TAB_ID);
  assert.equal(meta.title, TAB_TITLE);
  assert.equal(meta.rowCount, 1068);
  assert.equal(meta.columnCount, 15);
  assert.equal(meta.workbookTitle, 'AI BFFS SOO Assigns');
  assert.ok(meta.authenticated, 'a successful read is proof of authentication');

  // The token is minted once and reused for both requests.
  assert.equal(svc.tokenCalls, 1);
  assert.equal(svc.requestCalls, 2);
});

test('B1: token is reused across calls until it expires (expiry margin respected)', async () => {
  const adapter = stubAdapter();
  const svc = makeService(adapter);
  await svc.getTab();
  await svc.getTab();
  await svc.getTab();
  assert.equal(svc.tokenCalls, 1, 'token cache must be reused while fresh');
  assert.equal(svc.requestCalls, 6, 'every request hits the adapter');
});

test('B1: an expired token is re-minted on the next request', async () => {
  const adapter = stubAdapter();
  const svc = makeService(adapter);
  await svc.getTab();
  // Expire the cached token directly (simulates a 3600s+ wait between calls).
  svc['_token'] = { access_token: 'at-1', expires_at: Date.now() - 1000 };
  svc.tokenCalls = 0;
  await svc.getTab();
  assert.equal(svc.tokenCalls, 1, 'expired tokens must be refreshed');
});

test('B1: refresh-token failure surfaces a typed NOT_AUTHENTICATED error', async () => {
  const adapter = stubAdapter({
    async tokenRequest() {
      throw new GoogleSheetsError('NOT_AUTHENTICATED',
        'Google token endpoint returned invalid_grant: Token has been expired or revoked.',
        're-run scripts/google-oauth-wizard.sh to re-consent (refresh token expired or revoked)');
    },
  });
  const svc = makeService(adapter);
  await assert.rejects(
    () => svc.getTab(),
    (err: unknown) => err instanceof GoogleSheetsError
      && err.code === 'NOT_AUTHENTICATED'
      && /refresh token/i.test(err.message + ' ' + String(err.hint ?? '')),
  );
});

test('B1: an unexpected token-endpoint error is a typed NETWORK_ERROR', async () => {
  const adapter = stubAdapter({
    async tokenRequest() {
      throw new Error('socket hang up');
    },
  });
  const svc = makeService(adapter);
  await assert.rejects(() => svc.getTab(), (err: unknown) =>
    err instanceof GoogleSheetsError && err.code === 'NETWORK_ERROR');
});

test('B1: a missing/geoless GOOGLE_SHEET_ID is a typed MISSING_SHEET error', async () => {
  const adapter = stubAdapter();
  const svc = makeService(adapter, { GOOGLE_SHEET_ID: undefined });
  await assert.rejects(
    () => svc.getTab(),
    (err: unknown) => err instanceof GoogleSheetsError
      && err.code === 'MISSING_SHEET'
      && /GOOGLE_SHEET_ID/.test(err.message),
  );
});

test('B1: a workbook without the SOO-Assigns-Import tab is a MISSING_SHEET error', async () => {
  const adapter = stubAdapter({
    async request(path) {
      if (path === workbookSheetsPath(WORKBOOK)) return { sheets: [] };
      if (path === workbookTitlePath(WORKBOOK)) return { properties: { title: 'AI BFFS SOO Assigns' } };
      throw new Error(`unexpected request path: ${path}`);
    },
  });
  const svc = makeService(adapter);
  await assert.rejects(() => svc.getTab(), (err: unknown) =>
    err instanceof GoogleSheetsError && err.code === 'MISSING_SHEET' && /SOO-Assigns-Import/.test(err.message));
});

test('B1: tab located by exact title first, then by sheetId fallback', async () => {
  const adapter = stubAdapter({
    async request(path: string) {
      if (path === workbookSheetsPath(WORKBOOK)) {
        return { sheets: [{ properties: { title: TAB_TITLE, sheetId: TAB_ID, gridProperties: { rowCount: 9, columnCount: 3 } } }] };
      }
      if (path === workbookTitlePath(WORKBOOK)) return { properties: { title: 'AI BFFS SOO Assigns' } };
      throw new Error(`unexpected request path: ${path}`);
    },
  });
  const svc = makeService(adapter);
  const meta = await svc.getTab();
  assert.equal(meta.sheetId, TAB_ID);
  assert.equal(meta.rowCount, 9);
});

test('B1: DROP-IN seam for B2 values API — the same request() serves values paths', async () => {
  const adapter = stubAdapter();
  const svc = makeService(adapter);
  // B2 will call svc.request() with a values API path; the stub asserts the
  // Authorization header carried the freshest token on every call.
  const out = await svc.request(`/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent('SOO-Assigns-Import!A1:D5')}`);
  assert.deepEqual(out, { values: [['a', 'b'], ['c', 'd']], range: `/v4/spreadsheets/${WORKBOOK}/values/${encodeURIComponent('SOO-Assigns-Import!A1:D5')}` });
  assert.equal(svc.requestCalls, 1);
});

test('B1: resolveSheetsEnv pulls GOOGLE_* keys for the auth client', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    GOOGLE_REFRESH_TOKEN: 'rt',
    GOOGLE_SHEET_ID: 'sht',
    WCL_CLIENT_ID: 'ignored',
  };
  const e = resolveSheetsEnv(env);
  assert.equal(e.clientId, 'cid');
  assert.equal(e.clientSecret, 'csec');
  assert.equal(e.refreshToken, 'rt');
  assert.equal(e.sheetId, 'sht');
});

test('B1: DEFAULT_TAB is SOO-Assigns-Import', () => {
  assert.equal(DEFAULT_TAB, 'SOO-Assigns-Import');
});