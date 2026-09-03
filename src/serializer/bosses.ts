/**
 * The baked 14-boss SOO catalog (ADR-0001) and boss resolution.
 *
 * Vocabulary is source data — never read from the Google Sheet at runtime.
 * Events are used verbatim (abbr suffixes already embedded, e.g. "Encounter
 * Start (IMM)"); `sheetName` is the block-detection key (e.g. "SPOILS OF
 * PANDAREN" ≠ WCL "Spoils of Pandaria").
 */
import { readFileSync } from 'node:fs';

export interface SooBoss {
  id: string;
  wclName: string;
  abbr: string;
  sheetName: string;
  events: string[];
}

/** Group tags the export grid accepts in the PLAYER/CLASS/ALL column. */
export const GROUP_TAGS = [
  'ALL', 'MELEEDPS', 'RANGEDDPS', 'TANKS', 'HEALERS',
  'DEATHKNIGHT', 'DRUID', 'HUNTER', 'MAGE', 'MONK', 'PALADIN', 'PRIEST', 'ROGUE', 'SHAMAN', 'WARLOCK', 'WARRIOR',
] as const;

let cache: SooBoss[] | undefined;

/** All 14 SOO bosses, in sheet order (from src/data/soo-encounters.json). */
export function allSooBosses(): SooBoss[] {
  if (cache) return cache;
  const url = new URL('../data/soo-encounters.json', import.meta.url);
  cache = (JSON.parse(readFileSync(url, 'utf8')) as { encounters: SooBoss[] }).encounters;
  return cache;
}

/**
 * Resolve an encounter key to a boss definition. Accepts the baked `id`,
 * `wclName`, or `sheetName` — case-insensitive and trimmed. Returns undefined
 * for an unknown or empty key. Abbreviations (e.g. "PAR") are NOT resolution
 * keys — they identify event suffixes, not encounters.
 */
export function resolveBoss(key: string | null | undefined): SooBoss | undefined {
  if (!key) return undefined;
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  return allSooBosses().find(
    (b) =>
      b.id.toLowerCase() === k ||
      b.wclName.toLowerCase() === k ||
      b.sheetName.toLowerCase() === k,
  );
}