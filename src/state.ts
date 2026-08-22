/**
 * Artifact store — the JSON/markdown files through which CLI operations
 * exchange state. Every operation reads its inputs from artifacts and writes
 * its outputs as artifacts, so one-shot invocations and the menu share state
 * without any in-memory coupling.
 */
import fs from 'node:fs';
import path from 'node:path';

import CSVFormatter from './utils/csv_formatter.ts';
import type { Assignment } from './shared/assignments-schema.ts';
import type { RoleMappings } from './shared/roster-roles.ts';

export const ARTIFACTS = {
  timeline: 'timeline.json',
  roleMappings: 'role_mappings.json',
  community: 'community_strategy.md',
  assignments: 'assignments.json',
  tsv: 'assignments.tsv',
} as const;

export class StateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}

export function defaultStateDir(): string {
  return path.join(process.cwd(), '.cache', 'cli');
}

export function resolveStateDir(opts: { state?: string } = {}): string {
  return opts.state ? path.resolve(opts.state) : defaultStateDir();
}

export function artifactPath(stateDir: string, name: string): string {
  return path.join(stateDir, name);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveJson(stateDir: string, name: string, data: unknown): void {
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, name), JSON.stringify(data, null, 2) + '\n');
}

export function loadJson(stateDir: string, name: string): unknown {
  const file = artifactPath(stateDir, name);
  if (!fs.existsSync(file)) {
    throw new StateError('MISSING_ARTIFACT', `missing artifact: ${name} — run the operation that produces it first`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveText(stateDir: string, name: string, text: string): void {
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, name), text);
}

export function loadText(stateDir: string, name: string): string {
  const file = artifactPath(stateDir, name);
  if (!fs.existsSync(file)) {
    throw new StateError('MISSING_ARTIFACT', `missing artifact: ${name} — run the operation that produces it first`);
  }
  return fs.readFileSync(file, 'utf8');
}

/**
 * Promote a generated assignment set to the canonical state: the raw
 * assignments array as assignments.json plus the rendered TSV, so the file on
 * disk always matches what was accepted.
 */
export function commitAssignments(stateDir: string, assignments: Assignment[], roleMappings: RoleMappings): void {
  saveJson(stateDir, ARTIFACTS.assignments, assignments);
  const tsv = CSVFormatter.formatToTSV(assignments, roleMappings);
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, ARTIFACTS.tsv), tsv);
}