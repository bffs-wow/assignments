/**
 * Live integration test for the CommunityAnalyst agent — boots the real Flue
 * runtime (in-memory db), dispatches a real prompt to google/gemini-2.5-flash
 * using GEMINI_API_KEY from .env, and asserts a sensible free-text summary.
 *
 * Skips (with a reason) when GEMINI_API_KEY is absent. Consumes real Gemini
 * quota. Run: npm run test:integration
 */
import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert';
import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';
import { CommunityAnalyst } from '../../src/agents/community-analyst.ts';

const hasKey = Boolean(process.env.GEMINI_API_KEY && !/your_/.test(process.env.GEMINI_API_KEY));
const skip = !hasKey && 'GEMINI_API_KEY not set in .env';

const flue = await start({ agents: [CommunityAnalyst], db: sqlite() });
after(async () => {
  await flue.stop();
});

// Small canned "top guild" log payload — the shape WCLService.getCommunityPulls returns.
const fakeLogs = [
  {
    guild: 'Method Test',
    events: [
      { timestamp: 1000, type: 'cast', abilityName: 'Healing Tide Totem', context: 'Desperate Measures Sun' },
      { timestamp: 5000, type: 'cast', abilityName: 'Spirit Link Totem', context: 'Desperate Measures Sun' },
      { timestamp: 9000, type: 'cast', abilityName: 'Power Word: Barrier', context: 'Calamity' },
    ],
  },
  {
    guild: 'Limit Test',
    events: [
      { timestamp: 2000, type: 'cast', abilityName: 'Hand of Sacrifice', context: 'Mark of Anguish' },
      { timestamp: 2000, type: 'cast', abilityName: 'Pain Suppression', context: 'Mark of Anguish' },
    ],
  },
];

test('CommunityAnalyst: real prompt -> text summary of community practices', { skip, timeout: 120000 }, async () => {
  const agent = init(CommunityAnalyst, { id: 'it-community-analyst' });
  const receipt = await agent.dispatch(JSON.stringify(fakeLogs));
  const reply = await agent.read(receipt);

  assert.ok(reply.text && reply.text.length > 0, 'expected a non-empty text reply');
  assert.match(
    reply.text,
    /Healing Tide|Spirit Link|Desperate Measures|Mark of Anguish/i,
    `summary should reference the practice spells, got: ${reply.text.slice(0, 200)}`,
  );
});
