/**
 * Mock Warcraft Logs API Service
 *
 * Fetches encounter data and pre-processes enemy casts and major damage events.
 */

class WCLService {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  async getEncounterEvents(reportId, fightId) {
    // In a real implementation, this would authenticate using Client Credentials
    // and execute a GraphQL query against https://www.warcraftlogs.com/api/v2/client

    console.log(`Fetching WCL data for report: ${reportId}, fight: ${fightId}...`);

    // Mocking an encounter timeline (e.g., Immerseus / Fallen Protectors hybrid)
    // The AI will use this timeline to assign abilities.
    return [
      {
        timestamp: 0,
        type: "encounter_start",
        name: "Encounter Start (FAL)",
        description: "The fight begins.",
        damage: 0
      },
      {
        timestamp: 15000,
        type: "cast",
        name: "Desperate Measures Sun",
        description: "High incoming raid damage phase.",
        damage: 250000
      },
      {
        timestamp: 45000,
        type: "cast",
        name: "Desperate Measures Sun",
        description: "High incoming raid damage phase.",
        damage: 250000
      },
      {
        timestamp: 75000,
        type: "cast",
        name: "Calamity",
        description: "Massive raid-wide damage.",
        damage: 500000
      },
      {
        timestamp: 105000,
        type: "cast",
        name: "Shadow Word: Bane",
        description: "Raid-wide DoT application needing dispels.",
        damage: 100000
      },
      {
        timestamp: 135000,
        type: "cast",
        name: "Mark of Anguish",
        description: "Heavy single target physical damage on fixed target.",
        damage: 600000
      }
    ];
  }
}

module.exports = WCLService;
