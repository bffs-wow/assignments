/**
 * Formats AI JSON output into TSV matching the requested spreadsheet schema.
 */

class CSVFormatter {
  static formatToTSV(assignments, roleMappings) {
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

module.exports = CSVFormatter;
