/**
 * "RaidHelper => sheet role" mapping layer.
 *
 * Translates a RaidHelper sign-up roster into the sheet's abstract role tags
 * (DISC1, HPALA1, PROTPALA1, PROTWARR1, RSHAM1, ...).
 *
 * This layer is deliberately NAME-AGNOSTIC: role derivation uses only the
 * RaidHelper (className, roleName, specName) combination, not player names.
 *
 * Two layers, in priority order:
 *   1. ROSTER_RULE_TUPLES  — combinational pins keyed by "class|role|spec",
 *      for guild-specific/ambiguous labels. RaidHelper labels both tanks with
 *      className="Tank" / role="Tanks"; the spec suffix disambiguates:
 *      spec "Protection"  = protection warrior -> PROTWARR
 *      spec "Protection1" = protection paladin -> PROTPALA
 *   2. SPEC_RULES          — automatic class+spec => role-tag-base rules for
 *      real classes (handles spec suffix/alias normalization).
 *
 * All role tags here are the sheet's actual tags (docs/tot-assigns-csv-format.md).
 */

// Combinational pins: "className|roleName|specName" (normalized, suffix kept)
// -> sheet role-tag base. Only add entries where RaidHelper's labels / the
// auto rules can't resolve unambiguously.
export const ROSTER_RULE_TUPLES = {
  'tank|tanks|protection': 'PROTWARR',   // className=Tank, spec=Protection  -> protection warrior
  'tank|tanks|protection1': 'PROTPALA',  // className=Tank, spec=Protection1 -> protection paladin
};

const CLASS_ALIASES = {
  'dk': 'deathknight',
  'hunt': 'hunter',
  'pala': 'paladin',
  'lock': 'warlock',
  'demo': 'warlock',
  'pst': 'priest',
  'sham': 'shaman',
  'war': 'warrior',
};

const normClass = (s) => {
  const v = String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return CLASS_ALIASES[v] ?? v;
};

const normSpec = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/_/g, ' ')   // Unholy_DPS -> unholy dps
  .replace(/\d+$/, '')  // Holy1 / Protection1 -> base spec (for real-class rules)
  .trim();

// Tuple-key normalization: keep spaces/role, keep the trailing spec digit so
// "Protection" and "Protection1" stay distinct.
const tupleClass = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const tupleRole = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const tupleSpec = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ').split(/\s+/).join(' ').trim();

// RaidHelper entries that aren't on the bench of tonight's roster.
const isNonRoster = (p) =>
  p.status === 'Absence' ||
  ['bench', 'absence', 'tentative', 'maybe'].includes(String(p.className ?? '').toLowerCase());

// class (normalized) -> { spec: tagBase }. `'*'` = fallback for any spec.
// `null` = recognized class but no clean sheet tag (left unmapped).
const SPEC_RULES = {
  'priest': { 'discipline': 'DISC', 'holy': 'HOLYPRIEST', 'shadow': 'SPRIEST' },
  'paladin': { 'protection': 'PROTPALA', 'holy': 'HPALA', 'retribution': 'RETPALA' },
  'warrior': { 'protection': 'PROTWARR', 'arms': 'DPSWARR', 'fury': 'DPSWARR' },
  'shaman': { 'restoration': 'RSHAM', 'elemental': 'CDSHA', 'enhancement': 'CDSHA' },
  'deathknight': { 'unholy': 'UHDK', 'frost': 'FROSTDK', 'blood': null },
  'rogue': { '*': 'ROGUE' },
  'hunter': { 'survival': 'SURVIVAL', 'beastmastery': 'RANGEDDPS', 'marksmanship': 'RANGEDDPS' },
  'druid': { 'balance': 'BOOMIE', 'feral': 'FERAL', 'restoration': 'RDRUID', 'guardian': null },
  'monk': { 'mistweaver': 'MISTWEAVE', 'windwalker': 'MELEEDPS', 'brewmaster': null },
  'mage': { '*': 'RANGEDDPS' },
  'warlock': { '*': 'LOCK' },
};

/**
 * @typedef {{ name:string, className?:string, specName?:string, roleName?:string, status?:string, id?:number|string }} RosterEntry
 */

/**
 * Resolve a roster to sheet role tags (name-agnostic).
 *
 * @param {RosterEntry[]} roster normalized roster (getEventRoster / _normalizeMember).
 * @returns {{ mappings: Record<string,{name:string,className?:string,specName?:string,roleName?:string}>, unmapped: RosterEntry[] }}
 */
export function resolveRoleMappings(roster) {
  const mappings = {};
  const unmapped = [];
  const usedTags = new Set();
  const counters = {};

  const assign = (p, base) => {
    counters[base] = (counters[base] ?? 0) + 1;
    let n = counters[base];
    while (usedTags.has(`${base}${n}`)) n = ++counters[base];
    const tag = `${base}${n}`;
    usedTags.add(tag);
    mappings[tag] = {
      name: p.name,
      className: p.className ?? null,
      specName: p.specName ?? null,
      roleName: p.roleName ?? null,
    };
  };

  for (const p of roster ?? []) {
    if (!p || !p.name) continue;
    const tupleKey = [tupleClass(p.className), tupleRole(p.roleName), tupleSpec(p.specName)].join('|');
    const tupleBase = ROSTER_RULE_TUPLES[tupleKey];
    if (tupleBase) { assign(p, tupleBase); continue; }

    const cls = normClass(p.className);
    const spec = normSpec(p.specName);
    const rules = SPEC_RULES[cls];
    const base = rules ? (spec in rules ? rules[spec] : (rules['*'] ?? null)) : null;
    if (base) { assign(p, base); continue; }

    if (!isNonRoster(p)) unmapped.push(p);
  }

  return { mappings, unmapped };
}

export { normClass, normSpec };
