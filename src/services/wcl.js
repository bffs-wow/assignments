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

  async getCommunityPulls(encounterId) {
    // In a real implementation, this would search WCL for top parses or
    // successful kills of the given encounterId and extract their cast events.

    console.log(`Fetching community logs for encounter: ${encounterId}...`);

    // Mocking a successful pull from a top guild
    return [
      {
        guild: "Method",
        events: [
          { timestamp: 0, type: "cast", abilityName: "Bloodlust" },
          { timestamp: 15500, type: "cast", abilityName: "Healing Tide Totem", context: "Desperate Measures Sun" },
          { timestamp: 16000, type: "cast", abilityName: "Spirit Link Totem", context: "Desperate Measures Sun" },
          { timestamp: 46000, type: "cast", abilityName: "Devotion Aura", context: "Desperate Measures Sun" },
          { timestamp: 74000, type: "cast", abilityName: "Rallying Cry", context: "Calamity" },
          { timestamp: 75500, type: "cast", abilityName: "Power Word: Barrier", context: "Calamity" },
          { timestamp: 135000, type: "cast", abilityName: "Hand of Sacrifice", context: "Mark of Anguish" },
          { timestamp: 135500, type: "cast", abilityName: "Pain Suppression", context: "Mark of Anguish" }
        ]
      }
    ];
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
