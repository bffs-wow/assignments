/**
 * Warcraft Logs API Service
 *
 * Real client for the Warcraft Logs v2 GraphQL API (client-credentials OAuth).
 *
 * Modeled on the reference architecture of the `wcl` CLI
 * (https://github.com/hillerstorm/wcl):
 *   - single gqlRequest core: token auth, retry/backoff, 429 + quota handling
 *   - report probe (fights + actors + abilities) cached by report code alone
 *   - paginated event streams following nextPageTimestamp
 *   - disk cache with TTLs (report/events 7d, rankings 1h, encounter lookup 24h)
 *   - rateLimitData footer parsed on every response
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Instance string must match one of INSTANCE_HOSTS keys (validated at runtime). */
type WCLInstance = keyof typeof INSTANCE_HOSTS;

interface WCLServiceOptions {
  instance?: string;
  cacheDir?: string;
}

interface Token {
  access_token: string;
  token_type: string;
  expires_at: number;
}

interface RateLimit {
  pointsSpent: number;
  limit: number;
  resetIn: number;
  ratio: number;
}

interface RequestOptions {
  useCache?: boolean;
  cacheTtlSeconds?: number;
  force?: boolean;
}

export interface FetchEventsOptions {
  dataType: string;
  start: number;
  end: number;
  sourceID?: number;
  targetID?: number;
  abilityID?: number;
  hostility?: string;
  maxPages?: number;
  useCache?: boolean;
}

/** Loose JSON from the WCL GraphQL API. */
type WCLJson = Record<string, any>;

interface CastEvent {
  type: 'cast';
  timestamp: number;
  abilityGameID: number;
  sourceID?: number;
}

interface DamageEvent {
  type: 'damage';
  timestamp: number;
  abilityGameID: number;
  amount: number;
}

/** One entry of the boss-ability timeline shaped for the assignment AI. */
export interface TimelineEvent {
  timestamp: number;
  type: string;
  name: string;
  description: string;
  damage: number;
}

/** A community pull's cooldown cast aligned to a boss ability. */
export interface CommunityPullEvent {
  timestamp: number;
  type: 'cast';
  abilityName: string;
  context: string;
}

export interface CommunityPull {
  guild: string;
  events: CommunityPullEvent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';

// MoP classic is the default instance for this project (see wcl skill:
// mop -> classic -> classic.warcraftlogs.com). Override with $WCL_INSTANCE.
const INSTANCE_HOSTS = {
  retail: 'https://www.warcraftlogs.com',
  classic: 'https://classic.warcraftlogs.com',
  fresh: 'https://fresh.warcraftlogs.com',
  vanilla: 'https://vanilla.warcraftlogs.com',
  sod: 'https://sod.warcraftlogs.com',
};

const RATE_LIMIT_FIELD = 'rateLimitData { pointsSpentThisHour limitPerHour pointsResetIn }';

const QUOTA_WARN_RATIO = 0.8;
const QUOTA_REFUSE_RATIO = 0.95;

const SEVEN_DAYS = 7 * 24 * 3600;
const ONE_HOUR = 3600;
const ONE_DAY = 24 * 3600;

const EVENT_PAGE_LIMIT = 10000;

// Damage attribution window: max gap (ms) between a boss cast and the damage
// events of the same ability that we attribute to that cast (partitioned).
const DAMAGE_WINDOW_MS = 5000;

// Window used to align a guild's raid-cooldown casts to boss abilities (ms).
const ALIGN_BEFORE_MS = 2000;
const ALIGN_AFTER_MS = 5000;

// Loading the full set of hardcoded spell IDs is deliberately avoided — the
// authoritative assignable-spell list (id -> name) lives in src/data/mop_skills.json.
let COOLDOWN_SPELLS: Record<number, string> = {};
try {
  const skillsFile = path.join(import.meta.dirname, '..', 'data', 'mop_skills.json');
  const skillsData = JSON.parse(fs.readFileSync(skillsFile, 'utf8'));
  COOLDOWN_SPELLS = (skillsData.spells ?? {}) as Record<number, string>;
} catch (e) {
  console.warn(`[wcl] could not load assignable spell list from mop_skills.json: ${errMsg(e)}`);
}
const COOLDOWN_IDS = new Set(Object.keys(COOLDOWN_SPELLS).map(Number));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class WCLServiceError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(code: string, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'WCLServiceError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    Object.setPrototypeOf(this, WCLServiceError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// One probe per report: fights + actors + abilities. Keyed on $code alone so
// the disk cache serves every fight and every consumer from a single API call.
const REPORT_PROBE_QUERY = /* GraphQL */ `
  query ReportProbe($code: String!) {
    reportData {
      report(code: $code) {
        fights { id name startTime endTime encounterID kill difficulty }
        masterData {
          actors { id name type subType petOwner }
          abilities { gameID name }
        }
      }
    }
    ${RATE_LIMIT_FIELD}
  }
`;

const EVENTS_QUERY = /* GraphQL */ `
  query Events($code: String!, $fightId: Int!, $dataType: EventDataType!, $start: Float!, $end: Float!, $sourceID: Int, $targetID: Int, $abilityID: Float, $hostility: HostilityType, $limit: Int!) {
    reportData {
      report(code: $code) {
        events(fightIDs: [$fightId], dataType: $dataType, startTime: $start, endTime: $end, sourceID: $sourceID, targetID: $targetID, abilityID: $abilityID, hostilityType: $hostility, limit: $limit) {
          data
          nextPageTimestamp
        }
      }
    }
    ${RATE_LIMIT_FIELD}
  }
`;

const ENCOUNTER_LOOKUP_QUERY = /* GraphQL */ `
  query EncounterLookup {
    worldData {
      expansions { id name zones { id name encounters { id name } } }
    }
    ${RATE_LIMIT_FIELD}
  }
`;

// characterRankings is a JSON scalar in the WCL schema. Ranking entries carry
// { guild, character, amount, reportID, fightID, duration, startTime }.
const SEARCH_QUERY = /* GraphQL */ `
  query Search($encounterId: Int!, $className: String, $spec: String, $difficulty: Int, $page: Int, $serverRegion: String, $serverSlug: String) {
    worldData {
      encounter(id: $encounterId) {
        name
        characterRankings(className: $className, specName: $spec, difficulty: $difficulty, page: $page, serverRegion: $serverRegion, serverSlug: $serverSlug)
      }
    }
    ${RATE_LIMIT_FIELD}
  }
`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class WCLService {
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly instance: WCLInstance;
  private readonly endpoint: string;
  private readonly cacheDir: string;
  private rateLimit: RateLimit | null = null;
  private token: Token | null = null;

  constructor(clientId: string | undefined, clientSecret: string | undefined, options: WCLServiceOptions = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    const instanceName = options.instance || process.env.WCL_INSTANCE || 'classic';
    if (!(instanceName in INSTANCE_HOSTS)) {
      throw new WCLServiceError('BAD_INPUT', `unknown WCL instance: ${instanceName}`,
        `one of: ${Object.keys(INSTANCE_HOSTS).join(', ')}`);
    }
    this.instance = instanceName as WCLInstance;
    this.endpoint = `${INSTANCE_HOSTS[this.instance]}/api/v2/client`;
    this.cacheDir = options.cacheDir || path.join(import.meta.dirname, '..', '..', '.cache', 'wcl');
    this.rateLimit = null;

    if (!this.clientId || !this.clientSecret || /your_/.test(this.clientId) || /your_/.test(this.clientSecret)) {
      console.warn('WCL credentials missing or placeholder — real WCL calls will fail (set WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env).');
    }

    fs.mkdirSync(path.join(this.cacheDir, 'keys'), { recursive: true });
  }

  // -- auth ----------------------------------------------------------------

  private async _ensureToken(): Promise<string> {
    const tokenFile = path.join(this.cacheDir, 'token.json');
    let token: Token | null = this.token;
    if (!token) {
      try { token = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); } catch { token = null; }
    }
    if (token && token.expires_at - Date.now() > 60_000) {
      this.token = token;
      return token.access_token;
    }

    if (!this.clientId || !this.clientSecret || /your_/.test(this.clientId) || /your_/.test(this.clientSecret)) {
      throw new WCLServiceError('NOT_AUTHENTICATED', 'WCL credentials not configured', 'set WCL_CLIENT_ID / WCL_CLIENT_SECRET in .env');
    }

    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (e) {
      throw new WCLServiceError('NETWORK_ERROR', `token endpoint unreachable: ${errMsg(e)}`, 'transient — retry');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WCLServiceError('NOT_AUTHENTICATED', `token endpoint returned ${res.status}: ${text.slice(0, 200)}`,
        'check WCL_CLIENT_ID / WCL_CLIENT_SECRET');
    }
    let json: Record<string, any>;
    try { json = await res.json(); } catch (e) {
      throw new WCLServiceError('NETWORK_ERROR', `token endpoint returned unparseable JSON: ${errMsg(e)}`);
    }
    if (!json.access_token) {
      throw new WCLServiceError('NOT_AUTHENTICATED', 'token endpoint returned no access_token');
    }
    token = {
      access_token: json.access_token,
      token_type: json.token_type || 'Bearer',
      expires_at: Date.now() + (json.expires_in || 3600) * 1000,
    };
    this.token = token;
    try { fs.writeFileSync(tokenFile, JSON.stringify(token), { mode: 0o600 }); } catch { /* non-fatal */ }
    return token.access_token;
  }

  // -- cache ---------------------------------------------------------------

  private _cacheKey(query: string, variables: Record<string, unknown>): string {
    return crypto.createHash('sha1').update(JSON.stringify([this.instance, query, variables])).digest('hex');
  }

  private _cacheGet(key: string, ttlSeconds: number): any {
    try {
      const raw = fs.readFileSync(path.join(this.cacheDir, 'keys', `${key}.json`), 'utf8');
      const entry = JSON.parse(raw);
      if (entry.savedAt && Date.now() - entry.savedAt < ttlSeconds * 1000) return entry.data;
    } catch { /* miss */ }
    return null;
  }

  private _cacheSet(key: string, data: unknown): void {
    try {
      fs.writeFileSync(path.join(this.cacheDir, 'keys', `${key}.json`),
        JSON.stringify({ savedAt: Date.now(), data }));
    } catch { /* non-fatal */ }
  }

  clearCache(): void {
    fs.rmSync(path.join(this.cacheDir, 'keys'), { recursive: true, force: true });
    fs.mkdirSync(path.join(this.cacheDir, 'keys'), { recursive: true });
  }

  // -- core request --------------------------------------------------------

  private _trackRateLimit(root: Record<string, any> | null | undefined): void {
    const d = root && root.rateLimitData;
    if (!d || typeof d.limitPerHour !== 'number') return;
    this.rateLimit = {
      pointsSpent: d.pointsSpentThisHour,
      limit: d.limitPerHour,
      resetIn: d.pointsResetIn ?? 0,
      ratio: d.limitPerHour === 0 ? 0 : d.pointsSpentThisHour / d.limitPerHour,
    };
  }

  private _checkQuota(force: boolean): void {
    const rl = this.rateLimit;
    if (!rl || force) return;
    if (rl.ratio >= QUOTA_REFUSE_RATIO) {
      throw new WCLServiceError('QUOTA_LOW',
        `WCL rate limit at ${(rl.ratio * 100).toFixed(1)}% (${rl.pointsSpent}/${rl.limit})`,
        `wait ${rl.resetIn}s or pass { force: true }`,
        rl);
    }
    if (rl.ratio >= QUOTA_WARN_RATIO) {
      console.warn(`WCL rate limit at ${(rl.ratio * 100).toFixed(1)}% (${rl.pointsSpent}/${rl.limit})`);
    }
  }

  private async _doFetch(url: string, token: string, query: string, variables: Record<string, unknown>): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  }

  private async _request(query: string, variables: Record<string, unknown> = {}, { useCache = true, cacheTtlSeconds = SEVEN_DAYS, force = false }: RequestOptions = {}): Promise<Record<string, any>> {
    const key = this._cacheKey(query, variables);
    if (useCache) {
      const cached = this._cacheGet(key, cacheTtlSeconds);
      if (cached) return cached;
    }

    const token = await this._ensureToken();

    // Network failure and 5xx get one retry after a short backoff.
    let res: Response;
    try {
      res = await this._doFetch(this.endpoint, token, query, variables);
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
      try {
        res = await this._doFetch(this.endpoint, token, query, variables);
      } catch (e2) {
        throw new WCLServiceError('NETWORK_ERROR', `network failure: ${errMsg(e2)}`, 'transient — retry');
      }
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after');
      throw new WCLServiceError('RATE_LIMITED', 'WCL returned 429 Too Many Requests',
        retryAfter ? `wait ${retryAfter}s` : 'wait and retry');
    }
    if (res.status >= 500) {
      await new Promise(r => setTimeout(r, 500));
      try {
        res = await this._doFetch(this.endpoint, token, query, variables);
      } catch (e) {
        throw new WCLServiceError('NETWORK_ERROR', `network failure on retry: ${errMsg(e)}`, 'transient — retry');
      }
      if (res.status >= 500) {
        throw new WCLServiceError('NETWORK_ERROR', `WCL returned HTTP ${res.status}`, 'transient — retry');
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WCLServiceError('GRAPHQL_ERROR', `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    let payload: Record<string, any>;
    try {
      payload = await res.json();
    } catch (e) {
      throw new WCLServiceError('NETWORK_ERROR', `WCL returned unparseable JSON: ${errMsg(e)}`, 'transient — retry');
    }

    this._trackRateLimit(payload);

    if (payload.errors && payload.errors.length > 0) {
      const msgs = payload.errors.map((e: { message?: string }) => e.message);
      if (!payload.data || payload.data === null) {
        throw new WCLServiceError('GRAPHQL_ERROR', msgs.join('; '), undefined, payload.errors);
      }
      console.warn(`[wcl] partial GraphQL errors: ${msgs.join('; ')}`);
    }

    let data = payload.data;
    if (data && typeof data === 'object' && 'rateLimitData' in data) {
      const { rateLimitData, ...rest } = data;
      data = rest;
    }

    // Points are spent — cache first so a --force-style retry is served from cache.
    const clean = !payload.errors || payload.errors.length === 0;
    if (useCache && clean && cacheTtlSeconds > 0) this._cacheSet(key, data);

    this._checkQuota(force);

    return data;
  }

  // -- report helpers ------------------------------------------------------

  private async _probeReport(code: string): Promise<Record<string, any>> {
    const data = await this._request(REPORT_PROBE_QUERY, { code }, { cacheTtlSeconds: SEVEN_DAYS });
    const report = data && data.reportData && data.reportData.report;
    if (!report) throw new WCLServiceError('NOT_FOUND', `report ${code} not found`);
    return report;
  }

  private async _fetchEvents(code: string, fightId: number, {
    dataType, start, end, sourceID, targetID, abilityID, hostility,
    maxPages = 4, useCache = true,
  }: FetchEventsOptions): Promise<{ events: WCLJson[]; pages: number; truncated: boolean }> {
    const events: WCLJson[] = [];
    let cursor = start;
    let pages = 0;
    let nextPageTimestamp: number | null = null;
    let truncated = false;

    while (pages < maxPages) {
      const data = await this._request(EVENTS_QUERY, {
        code,
        fightId,
        dataType,
        start: cursor,
        end,
        limit: EVENT_PAGE_LIMIT,
        ...(sourceID !== undefined ? { sourceID } : {}),
        ...(targetID !== undefined ? { targetID } : {}),
        ...(abilityID !== undefined ? { abilityID } : {}),
        ...(hostility !== undefined ? { hostility } : {}),
      }, { useCache, cacheTtlSeconds: SEVEN_DAYS });

      const page = data && data.reportData && data.reportData.report && data.reportData.report.events;
      if (!page) throw new WCLServiceError('NOT_FOUND', `no events returned for fight ${fightId} in report ${code}`);
      events.push(...(page.data ?? []));
      pages += 1;
      nextPageTimestamp = page.nextPageTimestamp ?? null;
      if (nextPageTimestamp === null) break;
      cursor = nextPageTimestamp;
    }
    truncated = nextPageTimestamp !== null;
    if (truncated) console.warn(`[wcl] event stream truncated after ${pages} pages (maxPages=${maxPages})`);
    return { events, pages, truncated };
  }

  // -- encounter lookup ----------------------------------------------------

  public async _resolveEncounterId(nameOrId: string | number): Promise<number> {
    if (/^\d+$/.test(String(nameOrId))) return parseInt(String(nameOrId), 10);
    const want = String(nameOrId).toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
    const data = await this._request(ENCOUNTER_LOOKUP_QUERY, {}, { cacheTtlSeconds: ONE_DAY });
    const expansions = data && data.worldData && data.worldData.expansions || [];
    const hits: Array<{ id: number; name: string; zone: string }> = [];
    for (const exp of expansions) {
      for (const zone of exp.zones ?? []) {
        for (const enc of zone.encounters ?? []) {
          if (!enc.name) continue;
          const have = enc.name.toLowerCase().replace(/^(the|a|an)\s+/i, '').trim();
          if (have === want) hits.push({ id: enc.id, name: enc.name, zone: zone.name });
        }
      }
    }
    if (hits.length === 0) {
      throw new WCLServiceError('NOT_FOUND', `encounter "${nameOrId}" not found in worldData`,
        'pass a numeric encounter ID or check spelling');
    }
    if (hits.length > 1) {
      // Some raids map to several zone ids (e.g. MoP Classic progression vs its
      // legacy mirror) with equivalent live data. Prefer the first deterministically
      // and surface the candidates — pass a numeric id whenever you need a specific one.
      console.log(`[wcl] encounter "${nameOrId}" matched multiple ids; using ${hits[0].id} (${hits[0].zone}). ` +
        `Candidates: ${hits.map(h => `#${h.id} (${h.zone})`).join(', ')}`);
    }
    return hits[0].id;
  }

  // Public entry for arbitrary GraphQL (used by the WCL Explorer). Returns the
  // response `data` with rateLimitData stripped; throws WCLServiceError on failure.
  async executeQuery(query: string, variables: Record<string, unknown> = {}, opts: RequestOptions = {}): Promise<Record<string, any>> {
    return this._request(query, variables, {
      useCache: opts.useCache ?? true,
      cacheTtlSeconds: opts.cacheTtlSeconds ?? SEVEN_DAYS,
      force: opts.force ?? false,
    });
  }

  // -- public API ----------------------------------------------------------

  /**
   * Build a boss-ability timeline for a fight, shaped for the assignment AI:
   *   [{ timestamp, type, name, description, damage }]
   *
   * Real implementation:
   *   1. probe the report, resolve the fight's start/end window
   *   2. stream enemy casts (hostility: Enemies) — the boss mechanics
   *   3. stream friendly damage taken and attribute each boss cast's damage
   *      within a window (even-split fallback for abilities whose damage
   *      events don't align with the cast)
   */
  async getEncounterEvents(reportId: string, fightId: string | number): Promise<TimelineEvent[]> {
    console.log(`Fetching WCL data for report: ${reportId}, fight: ${fightId}...`);
    const report = await this._probeReport(reportId);
    const fight = report.fights.find((f: { id: number }) => f.id === Number(fightId));
    if (!fight) {
      throw new WCLServiceError('NOT_FOUND', `fight ${fightId} not in report ${reportId}`,
        'list fights with wcl fights or check the fight ID');
    }

    const abilityNames = new Map<number, string>((report.masterData?.abilities ?? []).map((a: { gameID: number; name: string }) => [a.gameID, a.name]));
    const actorNames = new Map<number, string>((report.masterData?.actors ?? []).map((a: { id: number; name: string }) => [a.id, a.name]));

    const start = fight.startTime;
    const end = fight.endTime;

    // Boss mechanics: enemy cast stream.
    const casts = await this._fetchEvents(reportId, fight.id, {
      dataType: 'Casts', start, end, hostility: 'Enemies',
    });
    const bossCasts = casts.events.filter((e): e is CastEvent => e.type === 'cast' && typeof e.abilityGameID === 'number');
    console.log(`  [wcl] ${bossCasts.length} boss casts (${casts.pages} page(s))`);

    // Raid damage taken: attribute to boss casts.
    const taken = await this._fetchEvents(reportId, fight.id, {
      dataType: 'DamageTaken', start, end, hostility: 'Friendlies',
    });
    const damageEvents: DamageEvent[] = []; // {abilityGameID, timestamp, amount}
    for (const e of taken.events) {
      if (e.type !== 'damage' || typeof e.abilityGameID !== 'number' || typeof e.amount !== 'number') continue;
      damageEvents.push({ type: 'damage', abilityGameID: e.abilityGameID, timestamp: e.timestamp, amount: e.amount });
    }

    // Partition damage onto casts: every damage event is attributed to exactly
    // one cast — the most recent same-ability cast at or before the hit (within
    // a window). This avoids double-counting when an ability is cast repeatedly.
    const castsByAbility = new Map<number, Array<{ timestamp: number; index: number }>>(); // abilityGameID -> sorted [{timestamp, index}]
    bossCasts.forEach((c, i) => {
      if (!castsByAbility.has(c.abilityGameID)) castsByAbility.set(c.abilityGameID, []);
      castsByAbility.get(c.abilityGameID)!.push({ timestamp: c.timestamp, index: i });
    });
    for (const arr of castsByAbility.values()) arr.sort((a, b) => a.timestamp - b.timestamp);

    const damagePerCast = new Array(bossCasts.length).fill(0);
    for (const d of damageEvents) {
      const casts2 = castsByAbility.get(d.abilityGameID);
      if (!casts2 || casts2.length === 0) continue;
      let lo = 0, hi = casts2.length - 1, pick = -1;
      while (lo <= hi) { // last cast with timestamp <= hit
        const mid = (lo + hi) >> 1;
        if (casts2[mid].timestamp <= d.timestamp) { pick = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (pick === -1) continue;
      if (d.timestamp - casts2[pick].timestamp <= DAMAGE_WINDOW_MS) {
        damagePerCast[casts2[pick].index] += d.amount;
      }
    }

    const bossCastDamage = bossCasts.map((c, i) => ({
      cast: c,
      damage: damagePerCast[i],
    }));
    console.log(`  [wcl] ${bossCasts.length} boss casts (${casts.pages} page(s)); ${damageEvents.length} damage events partitioned`);

    const timeline: TimelineEvent[] = [{
      timestamp: start,
      type: 'encounter_start',
      name: `Encounter Start (${fight.name})`,
      description: 'The fight begins.',
      damage: 0,
    }];

    for (const { cast: c, damage } of bossCastDamage) {
      const abilityName = abilityNames.get(c.abilityGameID) ?? `Ability ${c.abilityGameID}`;
      const sourceName = actorNames.get(c.sourceID as number) ?? 'boss';
      timeline.push({
        timestamp: c.timestamp,
        type: 'cast',
        name: abilityName,
        description: `Boss ability from ${sourceName}${damage > 0 ? ` — estimated raid damage ${damage.toLocaleString()}.` : '.'}`,
        damage,
      });
    }

    // Deterministic order: chronological, encounter_start first.
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`  [wcl] timeline: ${timeline.length} events (1 start + ${bossCasts.length} boss casts)`);
    return timeline;
  }

  /**
   * Walk characterRankings pages (100 entries each) and return normalized kill
   * entries with their global rank. rank = (page-1)*pageSize + idx + 1.
   */
  private async _fetchRankedEntries(
    encounterIdNum: number,
    { rankStart = 1, rankEnd = 100, pageSize = 100 }: { rankStart?: number; rankEnd?: number; pageSize?: number } = {},
  ): Promise<Array<{ rank: number; code: string; fightID: number; amount: number; serverName: string }>> {
    const entries: Array<{ rank: number; code: string; fightID: number; amount: number; serverName: string }> = [];
    const wantEnd = rankEnd == null ? Infinity : rankEnd;
    const lastPage = Math.max(1, Math.ceil(wantEnd / pageSize));
    for (let page = 1; page <= lastPage; page++) {
      const search = await this._request(SEARCH_QUERY, {
        encounterId: encounterIdNum,
        className: null, spec: null, difficulty: null, page,
        serverRegion: null, serverSlug: null,
      }, { cacheTtlSeconds: ONE_HOUR });
      const cr = search && search.worldData && search.worldData.encounter && search.worldData.encounter.characterRankings;
      if (!cr || !Array.isArray(cr.rankings)) break;
      cr.rankings.forEach((r: Record<string, any>, i: number) => {
        const rank = (page - 1) * pageSize + i + 1;
        if (rank < rankStart || rank > wantEnd) return;
        const code = r.report?.code ?? r.reportID;
        const fightID = r.report?.fightID ?? r.fightID;
        if (!code || fightID == null) return;
        entries.push({ rank, code, fightID: Number(fightID), amount: r.amount ?? 0, serverName: r.server?.name ?? 'Unknown' });
      });
      if (!cr.hasMorePages) break;
      if ((page - 1) * pageSize + cr.rankings.length >= wantEnd) break;
    }
    return entries;
  }

  /**
   * Discover what guilds do on an encounter.
   *
   * options:
   *   rankStart / rankEnd — restrict to a global ranking band (e.g. 100..500 for
   *     average-guild kills). Distinct kills (report+fight) are deduped, preferring
   *     the better rank. Default (unset) keeps the old "best parse per guild, top 5".
   *   maxPulls — cap on distinct kills to analyse (default 5).
   */
  async getCommunityPulls(
    encounterId: string | number,
    options: { rankStart?: number | null; rankEnd?: number | null; maxPulls?: number } = {},
  ): Promise<CommunityPull[]> {
    const { rankStart = null, rankEnd = null, maxPulls = 5 } = options;
    console.log(`Fetching community logs for encounter: ${encounterId}...`);
    const encounterIdNum = await this._resolveEncounterId(encounterId);

    let picks: Array<{ label: string; code: string; fightID: number; amount: number }> = []; // normalised [{ label, code, fightID, amount }]
    if (rankStart != null || rankEnd != null) {
      // Rank-band mode (mid-tier kills): distinct kills within the window.
      const from = rankStart != null ? rankStart : 1;
      const to = rankEnd != null ? rankEnd : 100;
      const entries = await this._fetchRankedEntries(encounterIdNum, { rankStart: from, rankEnd: to });
      const seen = new Map<string, (typeof entries)[number]>();
      for (const e of entries) {
        const key = `${e.code}:${e.fightID}`;
        if (!seen.has(key)) seen.set(key, e);
      }
      const chosen = [...seen.values()].sort((a, b) => a.rank - b.rank).slice(0, maxPulls);
      picks = chosen.map(e => ({ label: `${e.serverName} #${e.rank}`, code: e.code, fightID: e.fightID, amount: e.amount }));
      console.log(`  [wcl] ${entries.length} ranked kill(s) in band ${from}..${to}; analysing ${picks.length} distinct kill(s)`);
    } else {
      // Legacy: best parse per guild, top N.
      const search = await this._request(SEARCH_QUERY, {
        encounterId: encounterIdNum,
        className: null, spec: null, difficulty: null, page: 1,
        serverRegion: null, serverSlug: null,
      }, { cacheTtlSeconds: ONE_HOUR });
      const enc = search && search.worldData && search.worldData.encounter;
      if (!enc) throw new WCLServiceError('NOT_FOUND', `encounter ${encounterIdNum} returned no data`);
      const rankings = (enc.characterRankings?.rankings ?? []).filter((r: Record<string, any>) => {
        const code = r.report?.code ?? r.reportID;
        const fid = r.report?.fightID ?? r.fightID;
        return Boolean(code && fid);
      });
      console.log(`  [wcl] ${rankings.length} ranking(s) for "${enc.name}" (id ${encounterIdNum})`);
      const byGuild = new Map<string, Record<string, any>>();
      for (const r of rankings) {
        const guild = (r.guild && r.guild.name) || r.guildName || 'Unknown';
        if (!byGuild.has(guild) || (r.amount ?? 0) > (byGuild.get(guild)!.amount ?? 0)) byGuild.set(guild, r);
      }
      picks = [...byGuild.values()]
        .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        .slice(0, maxPulls)
        .map(r => ({ label: (r.guild && r.guild.name) || r.guildName || 'Unknown', code: r.report?.code ?? r.reportID, fightID: Number(r.report?.fightID ?? r.fightID), amount: r.amount ?? 0 }));
      console.log(`  [wcl] analysing ${picks.length} pull(s)`);
    }

    const pulls: CommunityPull[] = [];
    for (const pick of picks) {
      const guild = pick.label;
      const reportCode = pick.code;
      const reportFightId = pick.fightID;
      try {
        const report = await this._probeReport(reportCode);
        const abilityNames = new Map<number, string>((report.masterData?.abilities ?? []).map((a: { gameID: number; name: string }) => [a.gameID, a.name]));

        const fight = report.fights.find((f: { id: number }) => f.id === reportFightId);
        const start = fight ? fight.startTime : 0;
        const end = fight ? fight.endTime : Number.MAX_SAFE_INTEGER;

        // Boss mechanics.
        const casts = await this._fetchEvents(reportCode, reportFightId, {
          dataType: 'Casts', start, end, hostility: 'Enemies',
        });
        const bossCasts = casts.events.filter((e): e is CastEvent => e.type === 'cast' && typeof e.abilityGameID === 'number');

        // Guild assignable-spell casts, filtered by authoritative spell ID.
        const friendlyCasts = await this._fetchEvents(reportCode, reportFightId, {
          dataType: 'Casts', start, end, hostility: 'Friendlies',
        });
        const cdCasts = friendlyCasts.events.filter((e): e is CastEvent =>
          e.type === 'cast' && COOLDOWN_IDS.has(e.abilityGameID));

        // Align each cooldown cast to its nearest boss cast within the window.
        const events: CommunityPullEvent[] = [];
        for (const cc of cdCasts) {
          let best: CastEvent | null = null;
          let bestDelta = Infinity;
          for (const bc of bossCasts) {
            const delta = Math.abs(cc.timestamp - bc.timestamp);
            if (cc.timestamp >= bc.timestamp - ALIGN_BEFORE_MS && cc.timestamp <= bc.timestamp + ALIGN_AFTER_MS && delta < bestDelta) {
              best = bc;
              bestDelta = delta;
            }
          }
          if (best) {
            events.push({
              timestamp: cc.timestamp,
              type: 'cast',
              abilityName: COOLDOWN_SPELLS[cc.abilityGameID] || abilityNames.get(cc.abilityGameID) || `Ability ${cc.abilityGameID}`,
              context: abilityNames.get(best.abilityGameID) ?? `Ability ${best.abilityGameID}`,
            });
          }
        }
        events.sort((a, b) => a.timestamp - b.timestamp);
        pulls.push({ guild, events });
        console.log(`  [wcl] ${guild}: ${events.length} cooldown casts aligned to boss abilities (fight ${reportFightId})`);
      } catch (e) {
        console.warn(`  [wcl] skipping guild "${guild}" (report ${reportCode}): ${errMsg(e)}`);
      }
    }
    return pulls;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { WCLServiceError };
export default WCLService;

// ---------------------------------------------------------------------------
// Shared singleton (used by the CLI and the WCL Explorer agent tool so they
// share one authenticated, rate-limited instance). First call wins options;
// later calls ignore them.
// ---------------------------------------------------------------------------

let _sharedWCL: WCLService | null = null;

export function getWCLService(options: WCLServiceOptions = {}): WCLService {
  if (!_sharedWCL) {
    _sharedWCL = new WCLService(
      process.env.WCL_CLIENT_ID,
      process.env.WCL_CLIENT_SECRET,
      options,
    );
  }
  return _sharedWCL;
}