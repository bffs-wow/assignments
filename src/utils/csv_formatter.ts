/**
 * Formats AI JSON output into TSV matching the requested spreadsheet schema.
 *
 * @deprecated The sheet-compliant CSV artifact (renderSooAssigns in src/serializer/render.ts)
 * replaces this TSV formatter once the sheet workflow is trusted. Kept for backwards compatibility.
 */
import type { Assignment } from '../shared/assignments-schema.ts';
import type { RoleMappings } from '../shared/roster-roles.ts';

class CSVFormatter {
  /**
   * @deprecated Replaced by renderSooAssigns in src/serializer/render.ts.
   */
  static formatToTSV(assignments: Assignment[], roleMappings: RoleMappings): string {
    // Header for the specific encounter format
    let tsv = "Player\t\tEvent\tOccurrence\tRole\tTiming\tSpell\tNotes\tSpellID\n";

    for (const assignment of assignments) {
      // Resolve the player name from the role mapping, default to blank if not found (e.g., ALL)
      const playerInfo = roleMappings[assignment.roleTag];
      const playerName = playerInfo ? playerInfo.name : "";

      const row = [
        playerName, // Player Name
        "", // Blank column requested in screenshot
        assignment.event,
        assignment.occurrence,
        assignment.roleTag,
        assignment.timingOffset || 1,
        assignment.spellName,
        assignment.notes || "",
        assignment.spellId || ""
      ];

      tsv += row.join("\t") + "\n";
    }

    return tsv;
  }
}

export default CSVFormatter;