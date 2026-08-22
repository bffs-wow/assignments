/**
 * Artifact store — the JSON/markdown files through which CLI operations
 * exchange state. Every operation reads its inputs from artifacts and writes
 * its outputs as artifacts, so one-shot invocations and the menu share state
 * without any in-memory coupling.
 */
import fs from 'node:fs';
import path from 'node:path';

import CSVFormatter from './utils/csv_formatter.js';

export const ARTIFACTS = {
  timeline: 'timeline.json',
  roleMappings: 'role_mappings.json',
  community: 'community_strategy.md',
  assignments: 'assignments.json',
  tsv: 'assignments.tsv',
};

export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}

export function defaultStateDir() {
  return path.join(process.cwd(), '.cache', 'cli');
}

export function resolveStateDir(opts = {}) {
  return opts.state ? path.resolve(opts.state) : defaultStateDir();
}

export function artifactPath(stateDir, name) {
  return path.join(stateDir, name);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function saveJson(stateDir, name, data) {
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, name), JSON.stringify(data, null, 2) + '\n');
}

export function loadJson(stateDir, name) {
  const file = artifactPath(stateDir, name);
  if (!fs.existsSync(file)) {
    throw new StateError('MISSING_ARTIFACT', `missing artifact: ${name} — run the operation that produces it first`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveText(stateDir, name, text) {
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, name), text);
}

export function loadText(stateDir, name) {
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
export function commitAssignments(stateDir, assignments, roleMappings) {
  saveJson(stateDir, ARTIFACTS.assignments, assignments);
  const tsv = CSVFormatter.formatToTSV(assignments, roleMappings);
  ensureDir(stateDir);
  fs.writeFileSync(artifactPath(stateDir, ARTIFACTS.tsv), tsv);
}