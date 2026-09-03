/**
 * Commander.js CLI definition — the single source of truth for how this tool
 * is invoked. The bare program opens the main menu; every operation is a
 * one-shot subcommand declaring exactly the options it needs.
 *
 * Handlers are injected so index.ts can wire real operations and unit tests
 * can spy on dispatch. Tests build fresh programs via createProgram() so
 * option/env state never leaks between cases.
 */
import { Command, Option, InvalidArgumentError } from 'commander';

const INSTANCE_CHOICES = ['retail', 'classic', 'fresh', 'vanilla', 'sod'];

/** Options as dispatched to a handler (commander's parsed option bag). */
export type CliOptions = Record<string, any>;

/** One handler per subcommand; wired by the entry point, spied on by tests. */
export interface Handlers {
  /** Bare invocation — the entry point's menu (not dispatched by the program itself). */
  menu?: () => void | Promise<void>;
  timeline: (opts: CliOptions) => void | Promise<void>;
  mappings: (opts: CliOptions) => void | Promise<void>;
  community: (opts: CliOptions) => void | Promise<void>;
  generate: (opts: CliOptions) => void | Promise<void>;
  run: (opts: CliOptions) => void | Promise<void>;
  review: (opts: CliOptions) => void | Promise<void>;
  refine: (opts: CliOptions) => void | Promise<void>;
  explore: (opts: CliOptions) => void | Promise<void>;
  /** Push the committed assignments to the test raid sheet's COUNT block (B4). */
  push: (opts: CliOptions) => void | Promise<void>;
}

// Strict integer coercion: rejects "1.5" and "abc" outright instead of letting
// parseInt silently produce NaN/truncation (the old manual parser turned such
// values into a misleading "missing required input" error).
function parseFightId(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || String(n) !== value.trim()) {
    throw new InvalidArgumentError('must be an integer');
  }
  return n;
}

// Fresh Option per command: a shared Option instance is stateful in commander.
function instanceOption(): Option {
  return new Option('-i, --instance <x>', 'WCL instance: retail | classic | fresh | vanilla | sod')
    .env('WCL_INSTANCE')
    .choices(INSTANCE_CHOICES)
    .default('classic');
}

function stateOption(): Option {
  return new Option('--state <dir>', 'state directory for artifacts (default: .cache/cli)');
}

function raidhelperEventOption(): Option {
  return new Option('-R, --raidhelper-event <id>', 'RaidHelper event id for the roster (no WCL report needed)');
}

export function createProgram(handlers: Handlers): Command {
  const program = new Command();
  program
    .name('index.js')
    .description('WoW Classic Raid Assignment Automation');
  // No root action: bare invocation is the entry point's job (it calls the
  // menu directly). Without an action handler, commander errors on unknown
  // commands instead of letting them fall through to a menu.

  program
    .command('timeline')
    .description('Fetch the encounter timeline for a report/fight into state')
    .requiredOption('-r, --report <code>', 'Warcraft Logs report code')
    .requiredOption('-f, --fight <id>', 'Fight ID within the report', parseFightId)
    .addOption(instanceOption())
    .addOption(stateOption())
    .action((opts) => handlers.timeline(opts));

  program
    .command('mappings')
    .description('Fetch the RaidHelper role mappings for an encounter into state')
    .option('-e, --encounter <name|id>', 'Encounter name or id for community pulls')
    .addOption(raidhelperEventOption())
    .addOption(stateOption())
    .action((opts) => handlers.mappings(opts));

  program
    .command('community')
    .description('Fetch community pulls and analyse the strategy into state')
    .requiredOption('-e, --encounter <name|id>', 'Encounter name or id for community pulls')
    .addOption(raidhelperEventOption())
    .addOption(instanceOption())
    .addOption(stateOption())
    .action((opts) => handlers.community(opts));

  program
    .command('generate')
    .description('Generate assignments from the artifacts in state (no WCL report needed)')
    .option('-e, --encounter <name|id>', 'Encounter name or id (for boss resolution / the sheet push)')
    .addOption(raidhelperEventOption())
    .addOption(stateOption())
    .action((opts) => handlers.generate(opts));

  program
    .command('run')
    .description('Full pipeline: mappings + (timeline) + community + generate')
    .option('-r, --report <code>', 'Warcraft Logs report code (optional — generation can run from the roster alone)')
    .option('-f, --fight <id>', 'Fight ID within the report (only with -r)', parseFightId)
    .option('-R, --raidhelper-event <id>', 'RaidHelper event id for the roster (no WCL report needed)')
    .option('-e, --encounter <name|id>', 'Encounter name or id (prompted if missing)')
    .addOption(instanceOption())
    .addOption(stateOption())
    .action((opts) => handlers.run(opts));

  program
    .command('review')
    .description('Review the committed assignments from state')
    .addOption(stateOption())
    .action((opts) => handlers.review(opts));

  program
    .command('refine')
    .description('Refine the committed assignments with feedback')
    .requiredOption('--feedback <text>', 'Instruction describing the changes to make')
    .addOption(stateOption())
    .action((opts) => handlers.refine(opts));

  program
    .command('explore')
    .description('Ask the WCL Explorer a question about a report')
    .requiredOption('-q, --query <text>', 'Question for the WCL Explorer')
    .addOption(instanceOption())
    .addOption(stateOption())
    .action((opts) => handlers.explore(opts));

  program
    .command('push')
    .description('Push the committed assignments to the test raid sheet COUNT block (no regeneration)')
    .option('-e, --encounter <name|id>', 'Encounter name or id (defaults to the committed boss)')
    .option('--yes', 'Skip the confirmation prompt')
    .addOption(stateOption())
    .action((opts) => handlers.push(opts));

  return program;
}