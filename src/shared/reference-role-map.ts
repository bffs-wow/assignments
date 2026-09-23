/**
 * Reference kill-set role-tag to live-sheet roster mapper (Issue #35).
 *
 * Translates reference role tags (from community strategies and reference kill
 * sets) onto the live sheet's bound roles, preventing silent unmapped player
 * bindings in the sheet export grid.
 *
 * Source: docs/working-session-2026-08-22.md (roster drift findings).
 */

export interface ResolveResult {
  liveTag: string;
  warning?: string;
}

/**
 * Baked mapping from reference kill-set role tags to the live sheet roster bindings.
 * Derived from observed drift (2026-08-22):
 *   - DISC1/2/3 priest rows -> HOLYPRIEST1 / HOLYPRIEST2 / SPRIEST1
 *   - BOOMIE1/2 slot drift -> BOOMIE2 / BOOMIE1
 *   - 3rd/2nd slot surplus in reference -> lower slot in live roster
 */
export const REFERENCE_ALIASES: Record<string, string> = {
  DISC1: 'HOLYPRIEST1',
  DISC2: 'HOLYPRIEST2',
  DISC3: 'SPRIEST1',
  BOOMIE1: 'BOOMIE2',
  BOOMIE2: 'BOOMIE1',
  CDSHA3: 'CDSHA2',
  DPSWARR2: 'DPSWARR1',
  DPSWARR3: 'DPSWARR1',
  RSHAM2: 'RSHAM1',
};

/**
 * Map a reference kill-set role tag onto live sheet roster bindings.
 *
 * Rules:
 *   1. If roleTag exists in liveRoleMappings -> return it (no warning).
 *   2. Else if roleTag in REFERENCE_ALIASES and the alias resolves in liveRoleMappings
 *      -> return live mapped tag + warning.
 *   3. Else -> return tag unchanged + loud warning noting it is unresolved.
 */
export function resolveToLiveRoster(
  roleTag: string,
  liveRoleMappings: Record<string, { name?: string } | unknown>,
): ResolveResult {
  if (roleTag in liveRoleMappings) {
    return { liveTag: roleTag };
  }

  const alias = REFERENCE_ALIASES[roleTag];
  if (alias && alias in liveRoleMappings) {
    return {
      liveTag: alias,
      warning: `reference role ${roleTag} mapped to live ${alias}`,
    };
  }

  return {
    liveTag: roleTag,
    warning: `unresolved reference role ${roleTag} — not in live roster`,
  };
}

/**
 * Batch diff reference role tags against the live roster.
 * Deduplicates warnings with one loud warning per divergent tag.
 */
export function diffReferenceRoster(
  reference: string[],
  live: Record<string, unknown>,
): { mapped: string[]; unresolved: string[]; warnings: string[] } {
  const mapped = new Set<string>();
  const unresolved = new Set<string>();
  const warnings: string[] = [];
  const seenWarnings = new Set<string>();

  for (const tag of reference) {
    const res = resolveToLiveRoster(tag, live);
    if (res.warning) {
      if (!seenWarnings.has(res.warning)) {
        seenWarnings.add(res.warning);
        warnings.push(res.warning);
      }
      if (res.liveTag !== tag) {
        mapped.add(res.liveTag);
      } else {
        unresolved.add(tag);
      }
    }
  }

  return {
    mapped: Array.from(mapped),
    unresolved: Array.from(unresolved),
    warnings,
  };
}
