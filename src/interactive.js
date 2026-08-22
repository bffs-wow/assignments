/**
 * Interactive orchestration: the main menu and the review/commit sub-process.
 *
 * All I/O goes through an injected `io` ({ print, prompt, isTTY }) so unit tests
 * can script the conversation and assert what was printed/dispatched without a
 * real terminal.
 *
 * Dispatch contract: each menu action runs one operation (ops.*) which may
 * return { assignments, roleMappings, ... }. Operations that produce assignments
 * enter the review/commit sub-process on a TTY, or commit directly and finish on
 * a non-TTY stdin (piped/CI) so scripts never hang at a prompt.
 */
import path from 'node:path';

import { ARTIFACTS } from './state.js';

export function renderTable(assignments, roleMappings) {
  const lines = assignments.map((a) => {
    const player = (roleMappings[a.roleTag] && roleMappings[a.roleTag].name) || a.roleTag;
    return `${player}\t${a.event}\t${a.occurrence}\t${a.roleTag}\t${a.timingOffset ?? 1}\t${a.spellName}`;
  });
  return lines.join('\n');
}

async function promptInt(io, label) {
  for (;;) {
    const raw = await io.prompt(label);
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && String(n) === raw.trim()) return n;
    io.print(`${raw} is not a whole number — try again.`);
  }
}

export async function reviewCommit({ io, ops, result, ctx, onBack }) {
  let current = result;
  for (;;) {
    io.print('\n--- Review / Commit ---');
    io.print('1  Review in console (table)');
    io.print('2  Write files to disk (TSV + JSON)');
    io.print('3  Commit as current output');
    io.print('4  Suggest changes (refine)');
    io.print('5  Back to main menu');
    const choice = (await io.prompt('Choose (1-5): ')).trim();
    switch (choice) {
      case '1': io.print(renderTable(current.assignments, current.roleMappings)); break;
      case '2': await ops.writeFiles(current, ctx); break;
      case '3': await ops.commit(current, ctx); io.print('Committed.'); break;
      case '4': {
        const feedback = await io.prompt('Describe the changes: ');
        current = await ops.refine({ feedback }, ctx);
        io.print('Refined — review again or commit.');
        break;
      }
      case '5': onBack(); return;
      default: io.print('Invalid option, try again.'); break;
    }
  }
}

export async function runMenu({ io, ops, ctx, onResult = () => {} }) {
  let running = true;
  while (running) {
    io.print('\n--- Raid Assignment Tool ---');
    io.print('1  Fetch role mappings (needs encounter)');
    io.print('2  Fetch encounter timeline (needs report + fight)');
    io.print('3  Analyze community strategy (needs encounter)');
    io.print('4  Generate assignments (from state artifacts)');
    io.print('5  Full run (fetch everything + generate)');
    io.print('6  Review committed assignments');
    io.print('7  Refine assignments (feedback)');
    io.print('8  Ask the WCL Explorer a question');
    io.print('9  Exit');
    const choice = (await io.prompt('Select an option (1-9): ')).trim();

    let result;
    switch (choice) {
      case '1':
        result = await ops.mappings({ encounter: await io.prompt('Encounter name or id: ') }, ctx);
        break;
      case '2':
        result = await ops.timeline({ report: await io.prompt('Report code: '), fight: await promptInt(io, 'Fight ID: ') }, ctx);
        break;
      case '3':
        result = await ops.community({ encounter: await io.prompt('Encounter name or id: ') }, ctx);
        break;
      case '4':
        result = await ops.generate({}, ctx);
        break;
      case '5':
        result = await ops.run({}, ctx);
        break;
      case '6':
        result = await ops.review({}, ctx);
        break;
      case '7':
        result = await ops.refine({}, ctx);
        break;
      case '8':
        result = await ops.explore({}, ctx);
        break;
      case '9':
      case 'exit':
      case 'quit':
        io.print('Bye.');
        running = false;
        continue;
      default:
        io.print('Invalid option, try again.');
        continue;
    }
    onResult(result);
    if (result && result.assignments) {
      if (io.isTTY) await reviewCommit({ io, ops, result, ctx, onBack: () => {} });
      else await ops.commit(result, ctx);
    }
    // Non-TTY (piped/CI): finish the operation and exit rather than looping at a menu.
    if (!io.isTTY) {
      io.print('Bye.');
      running = false;
    }
  }
  io.close?.();
}