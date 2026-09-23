/**
 * Unit tests for reference-role to live-roster mapping helper (Issue #35).
 *
 * Contract tests: exact-match passthrough, aliased mapping with warning,
 * unresolved fallthrough with warning, batch diff deduplication, and no false positives.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import {
  resolveToLiveRoster,
  diffReferenceRoster,
  REFERENCE_ALIASES,
} from '../../src/shared/reference-role-map.ts';

const mockLiveRoster = {
  PROTPALA1: { name: 'Paladino' },
  PROTWARR1: { name: 'Tankwarr' },
  HOLYPRIEST1: { name: 'Nutmeg' },
  SPRIEST1: { name: 'Shadow' },
  UHDK1: { name: 'Zurrash' },
  BOOMIE2: { name: 'Pwndruid' },
  LOCK2: { name: 'Sloptard' },
  CDSHA2: { name: 'Ele' },
  DPSWARR1: { name: 'Arms' },
  RSHAM1: { name: 'Totem' },
};

test('T35: exact-match passthrough returns roleTag unchanged with no warning', () => {
  // PROTPALA1 is in live roster -> exact match
  const res1 = resolveToLiveRoster('PROTPALA1', mockLiveRoster);
  assert.equal(res1.liveTag, 'PROTPALA1');
  assert.equal(res1.warning, undefined);

  // UHDK1 exists in live roster (bound to Zurrash) -> exact match
  const res2 = resolveToLiveRoster('UHDK1', mockLiveRoster);
  assert.equal(res2.liveTag, 'UHDK1');
  assert.equal(res2.warning, undefined);

  // LOCK2 exists in live roster (bound to Sloptard) -> exact match
  const res3 = resolveToLiveRoster('LOCK2', mockLiveRoster);
  assert.equal(res3.liveTag, 'LOCK2');
  assert.equal(res3.warning, undefined);
});

test('T35: aliased mapping returns live tag and loud warning when alias exists in live roster', () => {
  // DISC1 maps to HOLYPRIEST1 (Nutmeg) in mockLiveRoster
  const res1 = resolveToLiveRoster('DISC1', mockLiveRoster);
  assert.equal(res1.liveTag, 'HOLYPRIEST1');
  assert.equal(res1.warning, 'reference role DISC1 mapped to live HOLYPRIEST1');

  // BOOMIE1 maps to BOOMIE2 (Pwndruid) in mockLiveRoster
  const res2 = resolveToLiveRoster('BOOMIE1', mockLiveRoster);
  assert.equal(res2.liveTag, 'BOOMIE2');
  assert.equal(res2.warning, 'reference role BOOMIE1 mapped to live BOOMIE2');

  // CDSHA3 maps to CDSHA2 in mockLiveRoster
  const res3 = resolveToLiveRoster('CDSHA3', mockLiveRoster);
  assert.equal(res3.liveTag, 'CDSHA2');
  assert.equal(res3.warning, 'reference role CDSHA3 mapped to live CDSHA2');

  // DPSWARR2 maps to DPSWARR1 in mockLiveRoster
  const res4 = resolveToLiveRoster('DPSWARR2', mockLiveRoster);
  assert.equal(res4.liveTag, 'DPSWARR1');
  assert.equal(res4.warning, 'reference role DPSWARR2 mapped to live DPSWARR1');

  // RSHAM2 maps to RSHAM1 in mockLiveRoster
  const res5 = resolveToLiveRoster('RSHAM2', mockLiveRoster);
  assert.equal(res5.liveTag, 'RSHAM1');
  assert.equal(res5.warning, 'reference role RSHAM2 mapped to live RSHAM1');
});

test('T35: unresolved fallthrough returns tag unchanged with warning when tag and alias are absent in live roster', () => {
  // Completely unknown tag
  const res1 = resolveToLiveRoster('UNKNOWN_TAG', mockLiveRoster);
  assert.equal(res1.liveTag, 'UNKNOWN_TAG');
  assert.equal(res1.warning, 'unresolved reference role UNKNOWN_TAG — not in live roster');

  // DISC2 maps to HOLYPRIEST2, which is NOT in mockLiveRoster -> unresolved fallthrough
  const res2 = resolveToLiveRoster('DISC2', mockLiveRoster);
  assert.equal(res2.liveTag, 'DISC2');
  assert.equal(res2.warning, 'unresolved reference role DISC2 — not in live roster');

  // Empty live roster -> falls through
  const res3 = resolveToLiveRoster('DISC1', {});
  assert.equal(res3.liveTag, 'DISC1');
  assert.equal(res3.warning, 'unresolved reference role DISC1 — not in live roster');
});

test('T35: batch diff groups mapped and unresolved tags with one warning per divergent tag', () => {
  const referenceTags = [
    'DISC1',     // aliased -> HOLYPRIEST1
    'PROTPALA1', // exact match -> no warning
    'BOGUS_ROLE',// unresolved
    'DISC1',     // duplicate aliased -> should deduplicate warnings
    'BOGUS_ROLE',// duplicate unresolved -> should deduplicate warnings
  ];

  const diff = diffReferenceRoster(referenceTags, mockLiveRoster);
  assert.deepEqual(diff.mapped, ['HOLYPRIEST1']);
  assert.deepEqual(diff.unresolved, ['BOGUS_ROLE']);
  assert.equal(diff.warnings.length, 2);
  assert.equal(diff.warnings[0], 'reference role DISC1 mapped to live HOLYPRIEST1');
  assert.equal(diff.warnings[1], 'unresolved reference role BOGUS_ROLE — not in live roster');
});

test('T35: no false positives when all reference roles exist in live roster', () => {
  const referenceTags = ['PROTPALA1', 'PROTWARR1', 'HOLYPRIEST1'];
  const diff = diffReferenceRoster(referenceTags, mockLiveRoster);

  assert.deepEqual(diff.mapped, []);
  assert.deepEqual(diff.unresolved, []);
  assert.deepEqual(diff.warnings, []);
});
