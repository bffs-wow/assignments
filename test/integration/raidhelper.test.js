/**
 * Live integration tests for the RaidHelper service — hit the real Raid-Helper
 * v2 API using RAID_HELPER_API_KEY (and RAID_HELPER_EVENT_ID) from .env.
 * No AI, no mocks.
 *
 * Run: npm test   (or)   node --test "test/integration/*.test.js"
 *
 * Requires both RAID_HELPER_API_KEY and a real RAID_HELPER_EVENT_ID. Skipped
 * (with a reason) when either is missing.
 */
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert';

import RaidHelperService from '../../src/services/raidhelper.js';

const key = process.env.RAID_HELPER_API_KEY;
const eventId = process.env.RAID_HELPER_EVENT_ID;
const hasKey = Boolean(key && !/your_/.test(key));
const missing = [];
if (!hasKey) missing.push('RAID_HELPER_API_KEY');
if (!eventId) missing.push('RAID_HELPER_EVENT_ID');
const skip = missing.length ? `set ${missing.join(' & ')} in .env to run` : false;

const service = new RaidHelperService(key);

test('RaidHelper: getEventRoster hits the live API', { skip }, async () => {
  const roster = await service.getEventRoster(eventId);
  assert.ok(Array.isArray(roster), 'expected an array');
  assert.ok(roster.length > 0, 'expected at least one roster member');
  for (const m of roster) {
    assert.ok(m.name, 'member missing name');
  }
});

test('RaidHelper: getRoleMappings maps the live roster to role tags', { skip }, async () => {
  const mappings = await service.getRoleMappings(eventId);
  const keys = Object.keys(mappings);
  assert.ok(keys.length > 0, 'expected at least one mapped role tag');
  for (const tag of keys) {
    assert.ok(mappings[tag].name, `mapped role ${tag} missing player name`);
  }
});

test('RaidHelper: missing key surfaces NOT_AUTHENTICATED', async () => {
  const noKey = new RaidHelperService('');
  await assert.rejects(
    noKey.getEvent(eventId || '1'),
    (err) => err && err.code === 'NOT_AUTHENTICATED',
    'expected NOT_AUTHENTICATED without a key',
  );
});
