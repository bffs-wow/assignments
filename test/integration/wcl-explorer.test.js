/**
 * Live integration test for the WCLExplorer agent — proves the tool-call loop
 * end-to-end: the model (opencode-go/deepseek-v4-flash via OPENCODE_API_KEY)
 * must call execute_wcl_query against the real Warcraft Logs API and answer.
 * The module-level toolCalls array proves at least one tool call happened.
 *
 * Skips when OPENCODE_API_KEY is absent (the OpenCode Go key is not in .env
 * yet — paste it to enable). Consumes real OpenCode + WCL quota.
 * Run: npm run test:integration
 */
import 'dotenv/config';
import { after, test } from 'node:test';
import assert from 'node:assert';
import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';
import { WCLExplorer, toolCalls } from '../../src/agents/wcl-explorer.ts';

const hasOpenCode = Boolean(process.env.OPENCODE_API_KEY && !/your_/.test(process.env.OPENCODE_API_KEY));
const skip = !hasOpenCode && 'OPENCODE_API_KEY not set in .env (OpenCode Go key)';

const hasWCL = Boolean(
  process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET
  && !/your_/.test(process.env.WCL_CLIENT_ID) && !/your_/.test(process.env.WCL_CLIENT_SECRET),
);

const flue = await start({ agents: [WCLExplorer], db: sqlite() });
after(async () => {
  await flue.stop();
});

test('WCLExplorer: model calls execute_wcl_query against the live WCL API and answers', { skip, timeout: 240000 }, async () => {
  const before = toolCalls.length;
  const agent = init(WCLExplorer, { id: 'it-wcl-explorer' });
  const receipt = await agent.dispatch(
    'Use the execute_wcl_query tool to query worldData.expansions { id name }. ' +
    'Then report how many expansions exist and name the first three.',
  );
  const reply = await agent.read(receipt);

  assert.ok(reply.text && reply.text.length > 0, 'expected a non-empty text reply');
  assert.ok(
    toolCalls.length > before,
    `expected the model to call execute_wcl_query (toolCalls went ${before} -> ${toolCalls.length})`,
  );

  if (hasWCL) {
    // With live WCL creds the query should have succeeded and the answer should
    // reference real expansion names (e.g. Wrath of the Lich King).
    assert.match(reply.text, /expansion|wrath|classic|legion|dragonflight/i,
      `expected real expansion data in the answer, got: ${reply.text.slice(0, 200)}`);
  } else {
    // Without WCL creds the tool errors and the model should still answer
    // coherently about the failure.
    assert.match(reply.text, /error|fail|credential|token|auth/i,
      `expected the model to report the tool failure, got: ${reply.text.slice(0, 200)}`);
  }
});
