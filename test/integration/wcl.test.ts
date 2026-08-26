/**
 * Live integration tests for the WCL service — hit the real Warcraft Logs v2 API
 * using the WCL_CLIENT_ID / WCL_CLIENT_SECRET from .env. No AI, no mocks.
 *
 * Run: npm test   (or)   node --test "test/integration/*.test.js"
 *
 * These consume real WCL rate-limit quota. They skip automatically when
 * credentials are absent.
 */
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert';

import WCLService from '../../src/services/wcl.ts';

const id = process.env.WCL_CLIENT_ID;
const secret = process.env.WCL_CLIENT_SECRET;
const hasWCL = Boolean(id && secret && !/your_/.test(id) && !/your_/.test(secret));
const skip = !hasWCL && 'WCL_CLIENT_ID / WCL_CLIENT_SECRET not set in .env';

const service = new WCLService(id, secret);

// The MoP Classic Fallen Protectors (resolved by name; the resolver picks a
// valid ambiguous match deterministically).
const ENCOUNTER = 'The Fallen Protectors';

test('WCL: auth + a real API round-trip', { skip }, async () => {
  const data = await service.executeQuery('query { worldData { expansions { id name } } }');
  assert.ok(Array.isArray(data.worldData.expansions), 'expected expansions array');
  assert.ok(data.worldData.expansions.length > 0, 'expected at least one expansion');
});

test('WCL: getCommunityPulls returns per-guild cooldown practices', { skip, timeout: 120000 }, async () => {
  const pulls = await service.getCommunityPulls(ENCOUNTER);
  assert.ok(Array.isArray(pulls), 'expected array');
  assert.ok(pulls.length > 0, 'expected at least one guild pull');

  for (const p of pulls) {
    assert.ok(typeof p.guild === 'string' && p.guild.length > 0, 'guild must have a name');
    assert.ok(Array.isArray(p.events), `guild ${p.guild} events must be an array`);
    for (const e of p.events) {
      assert.ok(typeof e.timestamp === 'number', 'event needs numeric timestamp');
      assert.equal(e.type, 'cast', 'community events must be casts');
      assert.ok(e.abilityName, 'event needs abilityName');
      assert.ok(e.context, 'event needs a boss-ability context');
    }
  }
});

test('WCL: getEncounterEvents builds a timeline from a discovered real report', { skip, timeout: 120000 }, async () => {
  const encounterId = await service._resolveEncounterId(ENCOUNTER);
  const search = await service.executeQuery(
    'query S($id: Int!) { worldData { encounter(id: $id) { name characterRankings(page: 1) } } }',
    { id: encounterId },
  );
  const rankings = search.worldData.encounter.characterRankings.rankings ?? [];
  assert.ok(rankings.length > 0, 'expected rankings for the encounter');

  const top = rankings[0];
  assert.ok(top.report && top.report.code && top.report.fightID != null,
    'ranking should expose report.code + fightID');

  const timeline = await service.getEncounterEvents(top.report.code, top.report.fightID);
  assert.ok(Array.isArray(timeline), 'expected timeline array');
  assert.ok(timeline.length > 0, 'expected at least the encounter_start event');
  assert.equal(timeline[0].type, 'encounter_start', 'timeline should start with encounter_start');

  const casts = timeline.filter(e => e.type === 'cast');
  assert.ok(casts.length > 0, 'expected boss cast events');
  for (const c of casts) {
    assert.ok(typeof c.timestamp === 'number', 'cast needs timestamp');
    assert.ok(c.name, 'cast needs an ability name');
    assert.ok(typeof c.damage === 'number', 'cast needs a numeric damage estimate');
  }
});

test('WCL: unknown report surfaces a typed WCLServiceError', { skip }, async () => {
  await assert.rejects(
    service.getEncounterEvents('THISREPORTDOESNOTEXIST', 1),
    (err: any) => err && err.code === 'NOT_FOUND' && /not found/i.test(err.message),
    'expected a NOT_FOUND WCLServiceError',
  );
});
