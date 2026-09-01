/**
 * Google Sheets auth/token client (B1) — small, typed seam the writer
 * (B2/B3/B4) and the CLI push stand on.
 *
 * Design deviation from the ticket's "googleapis" suggestion, in line with the
 * repo's other services (RaidHelper/WCL) and the OAuth wizard: plain fetch
 * against the token + Sheets REST endpoints, no heavyweight dependency. The
 * token flow is the refresh-token grant the B0 wizard minted
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN /
 * GOOGLE_SHEET_ID in .env — never committed). Everything network-shaped goes
 * through an injectable `SheetsAdapter` so unit tests stub the HTTP seam and
 * no real token/sheet is touched; the live smoke is a manual step.
 *
 * Errors are typed `GoogleSheetsError` so the writer can fall back loudly:
 *   - NOT_AUTHENTICATED — refresh-token grant failed (expired/revoked/401)
 *   - MISSING_SHEET    — GOOGLE_SHEET_ID absent, or no SOO-Assigns-Import tab
 *   - NETWORK_ERROR    — transport failure / 5xx / unparseable response
 *
 * The token is cached in memory and reused across requests until it approaches
 * expiry (refreshed on demand — Google access tokens last ~1h).
 *
 * `getTab()` is the B1 proof-of-life: it resolves the workbook + tab geometry
 * the whole sheet thread needs. B2 builds the values read/write on the same
 * adapter seam (the unit stub already covers the request-path convention).
 */
import { DEFAULT_TAB } from '../shared/sheets-target.ts';

// ---------------------------------------------------------------------------
// Typed errors (the writer's fall-back switch)
// ---------------------------------------------------------------------------

export type GoogleSheetsErrorCode = 'NOT_AUTHENTICATED' | 'MISSING_SHEET' | 'NETWORK_ERROR';

export class GoogleSheetsError extends Error {
  readonly code: GoogleSheetsErrorCode;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(code: GoogleSheetsErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    Object.setPrototypeOf(this, GoogleSheetsError.prototype);
  }
}

// ---------------------------------------------------------------------------
// HTTP seam (stubbed in unit tests; real fetch adapter below)
// ---------------------------------------------------------------------------

export interface SheetsAdapter {
  /**
   * Exchange a refresh token for an access token (POST /oauth2/v4/token).
   * Throws GoogleSheetsError on failure (NOT_AUTHENTICATED / NETWORK_ERROR).
   */
  tokenRequest(body: URLSearchParams): Promise<{ access_token: string; expires_in: number; token_type?: string }>;
  /** Authenticated request against the Sheets API root (bare path, no base URL). */
  request(path: string, token: string): Promise<Record<string, unknown>>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_ROOT = 'https://sheets.googleapis.com';

/** Refresh-token grant against the live token endpoint. */
async function fetchToken(body: URLSearchParams): Promise<{ access_token: string; expires_in: number; token_type?: string }> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) {
    throw new GoogleSheetsError('NETWORK_ERROR', `Google token endpoint unreachable: ${errMsg(e)}`, 'transient — retry');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GoogleSheetsError('NOT_AUTHENTICATED',
      `Google token endpoint returned ${res.status}: ${text.slice(0, 200)}`,
      're-run scripts/google-oauth-wizard.sh to re-consent (refresh token expired or revoked)');
  }
  let json: Record<string, any>;
  try {
    json = await res.json();
  } catch (e) {
    throw new GoogleSheetsError('NOT_AUTHENTICATED', `Google token endpoint returned unparseable JSON: ${errMsg(e)}`);
  }
  if (!json.access_token) {
    throw new GoogleSheetsError('NOT_AUTHENTICATED', 'Google token endpoint returned no access_token');
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600, token_type: json.token_type };
}

/** Authenticated GET against the Sheets API. */
async function fetchRequest(path: string, token: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${SHEETS_ROOT}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch (e) {
    throw new GoogleSheetsError('NETWORK_ERROR', `Sheets API unreachable: ${errMsg(e)}`, 'transient — retry');
  }
  if (res.status === 401 || res.status === 403) {
    throw new GoogleSheetsError('NOT_AUTHENTICATED',
      `Sheets API returned ${res.status} (bad/expired token or no access)`,
      'check GOOGLE_SHEET_ID scope (spreadsheets) and that the account can read the sheet');
  }
  if (res.status >= 500) {
    throw new GoogleSheetsError('NETWORK_ERROR', `Sheets API returned HTTP ${res.status}`, 'transient — retry');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GoogleSheetsError('NETWORK_ERROR', `Sheets API returned ${res.status}: ${text.slice(0, 200)}`);
  }
  let json: Record<string, unknown>;
  try {
    json = await res.json();
  } catch (e) {
    throw new GoogleSheetsError('NETWORK_ERROR', `Sheets API returned unparseable JSON: ${errMsg(e)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Env resolution (also exported for tests)
// ---------------------------------------------------------------------------

export interface SheetsEnv {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  sheetId?: string;
}

export function resolveSheetsEnv(env: Record<string, string | undefined> = process.env): SheetsEnv {
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
    sheetId: env.GOOGLE_SHEET_ID,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface GoogleSheetsOptions {
  /** HTTP seam — defaults to the real fetch adapters. */
  adapter?: SheetsAdapter;
  /** Env bag — defaults to process.env. */
  env?: Record<string, string | undefined>;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  sheetId?: string;
}

export interface TabMeta {
  /** Numeric sheetId of the tab (block-detection geometry for B2). */
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  workbookTitle: string;
  /** Always true on success — a resolved tab proves the token works. */
  authenticated: boolean;
}

interface CachedToken {
  access_token: string;
  expires_at: number;
}

const EXPIRY_MARGIN_MS = 60_000;

export class GoogleSheetsService {
  readonly sheetId: string | undefined;
  readonly tabTitle: string;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly refreshToken: string | undefined;
  private readonly adapter: SheetsAdapter;
  private _token: CachedToken | null = null;
  /** Observable counters for the stubbed adapter (tests assert caching). */
  tokenCalls = 0;
  requestCalls = 0;

  constructor(options: GoogleSheetsOptions = {}) {
    const env = options.env ?? process.env;
    const resolved = resolveSheetsEnv(env);
    const clientId = options.clientId ?? resolved.clientId;
    const clientSecret = options.clientSecret ?? resolved.clientSecret;
    const refreshToken = options.refreshToken ?? resolved.refreshToken;
    const sheetId = options.sheetId ?? resolved.sheetId;

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.sheetId = sheetId;
    this.tabTitle = DEFAULT_TAB;
    this.adapter = options.adapter ?? { tokenRequest: fetchToken, request: fetchRequest };

    if (!clientId || !clientSecret || /your_/.test(clientId) || /your_/.test(clientSecret)) {
      console.warn('Google OAuth credentials missing or placeholder — real Sheets calls will fail (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env).');
    }
  }

  private async _accessToken(): Promise<string> {
    if (this._token && this._token.expires_at - Date.now() > EXPIRY_MARGIN_MS) {
      return this._token.access_token;
    }

    const { clientId, clientSecret, refreshToken, adapter } = this;
    if (!clientId || !clientSecret || !refreshToken ||
        /your_/.test(clientId) || /your_/.test(clientSecret) || /your_/.test(refreshToken)) {
      throw new GoogleSheetsError('NOT_AUTHENTICATED',
        'Google OAuth not configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN in .env',
        'or re-run scripts/google-oauth-wizard.sh');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });

    let json: { access_token: string; expires_in: number; token_type?: string };
    try {
      this.tokenCalls++;
      json = await adapter.tokenRequest(body);
    } catch (e) {
      if (e instanceof GoogleSheetsError) throw e;
      throw new GoogleSheetsError('NETWORK_ERROR', `Google token endpoint failed: ${errMsg(e)}`, 'transient — retry');
    }
    const token: CachedToken = {
      access_token: json.access_token,
      expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    this._token = token;
    return token.access_token;
  }

  /** Authenticated request against the Sheets API (bare path, no base URL). */
  async request(path: string): Promise<Record<string, unknown>> {
    const token = await this._accessToken();
    this.requestCalls++;
    return this.adapter.request(path, token);
  }

  /**
   * Resolve the workbook + tab geometry for the SOO-Assigns-Import tab.
   * Proves authentication and produces the constants the writer needs.
   */
  async getTab(): Promise<TabMeta> {
    const { sheetId } = this;
    if (!sheetId || /your_/.test(sheetId)) {
      throw new GoogleSheetsError('MISSING_SHEET',
        'no test raid sheet configured — set GOOGLE_SHEET_ID in .env',
        'GOOGLE_SHEET_ID is the test raid sheet id (see issue #22)');
    }

    const workbook = await this.request(`/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties(title)`) as {
      properties?: { title?: string };
    };
    const workbookTitle = workbook.properties?.title ?? 'unknown';

    const sheets = await this.request(`/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties(title,sheetId,gridProperties)`) as {
      sheets?: Array<{ properties?: { title?: string; sheetId?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
    };

    let found: { title?: string; sheetId?: number; gridProperties?: { rowCount?: number; columnCount?: number } } | undefined;
    for (const s of sheets.sheets ?? []) {
      if (!s.properties) continue;
      const title = s.properties.title ?? '';
      if (title.toLowerCase() === this.tabTitle.toLowerCase()) { found = s.properties; break; }
    }
    // Title-first, then numeric fallback (B2's block-detection uses the id).
    if (!found) {
      for (const s of sheets.sheets ?? []) {
        if (!s.properties) continue;
        if (String(s.properties.sheetId ?? '') === String(this.tabTitle) || s.properties.title === this.tabTitle) {
          found = s.properties;
          break;
        }
      }
    }
    if (!found || typeof found.sheetId !== 'number') {
      throw new GoogleSheetsError('MISSING_SHEET',
        `no "${this.tabTitle}" tab in workbook "${workbookTitle}"`,
        'check GOOGLE_SHEET_ID points at "AI BFFS SOO Assigns"');
    }

    return {
      sheetId: found.sheetId,
      title: found.title ?? this.tabTitle,
      rowCount: found.gridProperties?.rowCount ?? 0,
      columnCount: found.gridProperties?.columnCount ?? 0,
      workbookTitle,
      authenticated: true,
    };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}