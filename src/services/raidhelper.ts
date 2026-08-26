/**
 * RaidHelper API Service
 *
 * Real client for the Raid-Helper v4 REST API. Fetches the live event roster
 * and maps players to abstract role tags (e.g., DISC1, PROTPALA1).
 *
 * Endpoint: GET https://raid-helper.xyz/api/v4/events/{event_id}  (v4, current —
 *           the event body carries the signed-up players in `signUps`)
 * Auth:     header `Authorization: <API_KEY>` (the raw server API key — no "Bearer").
 *           The key is shown/refreshed with the /apikey command in your server.
 *
 * No mock data — this always talks to Raid-Helper. Credentials come from the
 * RAID_HELPER_API_KEY env var / constructor arg; the event id from
 * RAID_HELPER_EVENT_ID (integration tests).
 */

import { resolveRoleMappings } from '../shared/roster-roles.ts';
import type { RoleMappings, RosterEntry } from '../shared/roster-roles.ts';

const FETCH_TIMEOUT_MS = 20000;

type RHEventBody = Record<string, any>;

class RaidHelperError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(code: string, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'RaidHelperError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    // `instanceof` must survive transpilation across this package boundary
    // (works with Node ESM when the class is exported and imported directly).
    Object.setPrototypeOf(this, RaidHelperError.prototype);
  }
}

class RaidHelperService {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;

  constructor(apiKey: string | undefined) {
    this.apiKey = apiKey;
    this.endpoint = 'https://raid-helper.xyz/api/v4';
  }

  _hasKey(): boolean {
    return Boolean(this.apiKey && !/your_|^\s*$/.test(this.apiKey));
  }

  /**
   * Fetch a live Raid-Helper event and return the parsed JSON body.
   * `eventId` is the Raid-Helper event id (string or number).
   */
  async getEvent(eventId: string | number): Promise<RHEventBody> {
    const apiKey = this.apiKey;
    if (!apiKey || /your_|^\s*$/.test(apiKey)) {
      throw new RaidHelperError('NOT_AUTHENTICATED', 'RAID_HELPER_API_KEY not configured',
        'set RAID_HELPER_API_KEY in .env (get the key with /apikey in your server)');
    }

    const url = `${this.endpoint}/events/${encodeURIComponent(String(eventId))}`;
    const headers = { authorization: apiKey, accept: 'application/json' };

    const doFetch = (): Promise<Response> => fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      // Transient network failure: one retry after a short backoff.
      await new Promise(r => setTimeout(r, 500));
      try {
        res = await doFetch();
      } catch (e2) {
        throw new RaidHelperError('NETWORK_ERROR', `Raid-Helper unreachable: ${errMsg(e2)}`, 'transient — retry');
      }
    }

    if (res.status === 429) {
      throw new RaidHelperError('RATE_LIMITED', 'Raid-Helper returned 429 Too Many Requests', 'wait and retry');
    }
    if (res.status === 401 || res.status === 403) {
      throw new RaidHelperError('NOT_AUTHENTICATED', `Raid-Helper returned ${res.status} (bad API key)`,
        'refresh the key with /apikey and update RAID_HELPER_API_KEY');
    }
    if (res.status === 404) {
      throw new RaidHelperError('NOT_FOUND', `event ${eventId} not found`, 'check RAID_HELPER_EVENT_ID');
    }
    if (res.status >= 500) {
      throw new RaidHelperError('NETWORK_ERROR', `Raid-Helper returned HTTP ${res.status}`, 'transient — retry');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new RaidHelperError('API_ERROR', `Raid-Helper returned ${res.status}: ${text.slice(0, 200)}`);
    }

    try {
      return await res.json();
    } catch (e) {
      throw new RaidHelperError('NETWORK_ERROR', `Raid-Helper returned unparseable JSON: ${errMsg(e)}`);
    }
  }

  /**
   * Pull the sign-up roster out of an event body. The v2 event object carries the
   * signed-up players in `signUps`; we tolerate a few historical shapes as well.
   */
  _extractRoster(event: RHEventBody): RHEventBody[] {
    if (!event || typeof event !== 'object') return [];
    const candidates = [event.signUps, event.roster, event.data && event.data.signUps, event.data && event.data.roster];
    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return [];
  }

  /**
   * Normalize a single sign-up to { name, className, specName, roleName }.
   * Raid-Helper uses the guild's custom labels: member -> name, class ->
   * className/cClassName, spec -> specName/cSpecName, role -> roleName.
   */
  _normalizeMember(m: RHEventBody): RosterEntry | null {
    if (!m || typeof m !== 'object') return null;
    const name = m.name ?? m.nickname ?? null;
    if (!name) return null;
    return {
      name,
      className: m.cClassName ?? m.className ?? null,
      specName: m.cSpecName ?? m.specName ?? null,
      roleName: m.roleName ?? null,
      status: m.status ?? null,
      id: m.id ?? m.userId ?? null,
    };
  }

  /** Fetch and normalize the live roster for an event (no mock). */
  async getEventRoster(eventId: string | number): Promise<RosterEntry[]> {
    const event = await this.getEvent(eventId);
    const roster = this._extractRoster(event);
    return roster.map(m => this._normalizeMember(m)).filter((m): m is RosterEntry => m !== null);
  }

  /**
   * Map the live roster to the abstract role tags the assignment AI uses
   * (DISC1, PROTPALA1, PROTWARR1, RSHAM1, ...).
   *
   * Delegates to the shared "RaidHelper -> sheet role" layer
   * (src/shared/roster-roles.ts): a curated per-player override map first
   * (tanks are often labelled with the guild's custom class name "Tank", so
   * protection paladin vs protection warrior must be pinned by player name), then
   * automatic class+spec rules.
   */
  async getRoleMappings(eventId: string | number): Promise<RoleMappings> {
    const roster = await this.getEventRoster(eventId);
    return resolveRoleMappings(roster).mappings;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { RaidHelperError };
export default RaidHelperService;