/**
 * One-shot encounter planning tool (bypasses the in-progress cli.js handler
 * layer). Fetches real WCL community pulls + timeline + RaidHelper roster and
 * runs the CommunityAnalyst and AssignmentGenerator agents to produce a raid
 * cooldown plan.
 *
 * Usage:
 *   node dist/scripts/plan-encounter.js --report CODE --fight N --encounter NAME|ID
 *     [--roster-event ID]          (default: $RAID_HELPER_EVENT_ID)
 *     [--ranks "START-END"]        ranking band for community kills (default: top-tier)
 *     [--max-pulls N]              distinct kills to analyse (default: 5)
 *     [--out path.tsv]             (default: assignments_plan.tsv)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { init } from '@flue/runtime';
import { start, sqlite } from '@flue/runtime/node';

import { getWCLService } from '../src/services/wcl.ts';
import RaidHelperService from '../src/services/raidhelper.ts';
import CSVFormatter from '../src/utils/csv_formatter.ts';
import { CommunityAnalyst } from '../src/agents/community-analyst.ts';
import { AssignmentGenerator } from '../src/agents/assignment-generator.ts';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : undefined; };
const report = arg('report');
const fight = arg('fight') ? Number(arg('fight')) : undefined;
const encounter = arg('encounter');
const rosterEventId = arg('roster-event') || process.env.RAID_HELPER_EVENT_ID;
const outPath = arg('out') || path.join(process.cwd(), 'assignments_plan.tsv');

// Parse --ranks "100-500" into { rankStart, rankEnd } (null/null => top tier).
let rankStart: number | null = null, rankEnd: number | null = null;
const ranksArg = arg('ranks');
if (ranksArg) {
  const m = ranksArg.match(/^(\d*)\s*-\s*(\d+)$/);
  if (!m) { console.error('--ranks must be "START-END", e.g. "100-500"'); process.exit(1); }
  rankStart = m[1] ? Number(m[1]) : null;
  rankEnd = m[2] ? Number(m[2]) : null;
}
const maxPulls = arg('max-pulls') ? Number(arg('max-pulls')) : 5;

if (!report || !fight || !encounter) {
  console.error('usage: node dist/scripts/plan-encounter.js --report CODE --fight N --encounter NAME|ID [--roster-event ID] [--ranks "START-END"] [--max-pulls N] [--out path]');
  process.exit(1);
}
if (!rosterEventId) {
  console.error('--roster-event or RAID_HELPER_EVENT_ID is required');
  process.exit(1);
}

const wcl = getWCLService();
const skillsData = JSON.parse(
  fs.readFileSync(new URL('../src/data/mop_skills.json', import.meta.url), 'utf8'),
);

const flue = await start({ agents: [CommunityAnalyst, AssignmentGenerator], db: sqlite() });
try {
  console.log('=== 1. Community pulls (WCL) ===');
  const communityLogs = await wcl.getCommunityPulls(encounter, { rankStart, rankEnd, maxPulls });
  const bandDesc = rankEnd ? ` (ranks ${rankStart ?? 1}..${rankEnd})` : '';
  console.log(`  analysed ${communityLogs.length} average-guild kill pull(s)${bandDesc}`);

  console.log('\n=== 2. Community strategy (CommunityAnalyst) ===');
  const community = init(CommunityAnalyst, { id: `plan-community-${encounter}` });
  const communityReply = await community.dispatch(JSON.stringify(communityLogs));
  const communityStrategy = (await community.read(communityReply)).text;
  console.log(communityStrategy);

  console.log('\n=== 3. Roster role mappings (RaidHelper) ===');
  const rh = new RaidHelperService(process.env.RAID_HELPER_API_KEY);
  const roleMappings = await rh.getRoleMappings(rosterEventId);
  console.log(`  mapped ${Object.keys(roleMappings).length} roles (event ${rosterEventId})`);
  console.log('  tags:', Object.keys(roleMappings).join(', '));

  console.log('\n=== 4. Encounter timeline (WCL) ===');
  const timeline = await wcl.getEncounterEvents(report, fight);
  console.log(`  ${timeline.length} events (${timeline.filter(e => e.type === 'cast').length} boss casts)`);

  console.log('\n=== 5. Generate assignments (AssignmentGenerator) ===');
  const generator = init(AssignmentGenerator, { id: `plan-gen-${encounter}` });
  const generateReply = await generator.dispatch({
    message: 'Generate the raid cooldown assignment matrix for this encounter.',
    initialData: { timeline, roleMappings, skillsData, communityStrategy },
  });
  const assignments = (await generator.read(generateReply)).data?.assignments?.[0];
  if (!Array.isArray(assignments)) throw new Error('AssignmentGenerator did not submit assignments');

  console.log(`  generated ${assignments.length} assignments`);
  console.log(JSON.stringify(assignments, null, 2));

  fs.writeFileSync(outPath, CSVFormatter.formatToTSV(assignments, roleMappings));
  console.log(`\n-> plan written to ${outPath}`);
} finally {
  await flue.stop();
}
