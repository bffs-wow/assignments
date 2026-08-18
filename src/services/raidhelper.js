/**
 * Mock RaidHelper API Service
 *
 * Fetches data from RaidHelper (mocked for this iteration)
 * and maps players to abstract role tags (e.g., DISC1, PROTPALA1).
 */

class RaidHelperService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async getEventRoster(eventId) {
    // In a real implementation, this would call:
    // https://raidhelper.studio/api/v2/events/{eventId}

    console.log(`Fetching RaidHelper roster for event: ${eventId}...`);

    // Mock response based on the provided screenshots and data
    return [
      { name: "Marenjok", class: "Priest", spec: "Discipline" },
      { name: "Sjue", class: "Shaman", spec: "Restoration" },
      { name: "Applepi", class: "Paladin", spec: "Protection" },
      { name: "Seph", class: "Paladin", spec: "Holy" },
      { name: "Money", class: "Paladin", spec: "Holy" },
      { name: "Hexdaddy", class: "Shaman", spec: "Enhancement" }, // Example: CD Shaman
      { name: "Goatlord", class: "Warrior", spec: "Arms" }, // Example: DPS Warrior
      { name: "Emofive", class: "Death Knight", spec: "Unholy" },
      { name: "Lurkin", class: "Rogue", spec: "Assassination" },
      { name: "Clueles", class: "Priest", spec: "Shadow" },
      { name: "Ñgñ", class: "Hunter", spec: "Survival" }
    ];
  }

  async getRoleMappings(eventId) {
    const roster = await this.getEventRoster(eventId);
    const mappings = {};
    const counters = {
      DISC: 1,
      PROTPALA: 1,
      HPALA: 1,
      CDSHA: 1,
      RSHAM: 1,
      DPSWARR: 1,
      UHDK: 1,
      ROGUE: 1,
      SPRIEST: 1,
      SURVIVAL: 1
    };

    for (const player of roster) {
      let roleTag = null;

      // Determine base tag based on class/spec
      if (player.class === "Priest" && player.spec === "Discipline") {
        roleTag = `DISC${counters.DISC++}`;
      } else if (player.class === "Paladin" && player.spec === "Protection") {
        roleTag = `PROTPALA${counters.PROTPALA++}`;
      } else if (player.class === "Paladin" && player.spec === "Holy") {
        roleTag = `HPALA${counters.HPALA++}`;
      } else if (player.class === "Shaman" && player.spec === "Restoration") {
        roleTag = `RSHAM${counters.RSHAM++}`;
      } else if (player.class === "Shaman" && (player.spec === "Enhancement" || player.spec === "Elemental")) {
        roleTag = `CDSHA${counters.CDSHA++}`;
      } else if (player.class === "Warrior" && (player.spec === "Arms" || player.spec === "Fury")) {
        roleTag = `DPSWARR${counters.DPSWARR++}`;
      } else if (player.class === "Death Knight" && player.spec === "Unholy") {
        roleTag = `UHDK${counters.UHDK++}`;
      } else if (player.class === "Rogue") {
        roleTag = `ROGUE${counters.ROGUE++}`;
      } else if (player.class === "Priest" && player.spec === "Shadow") {
        roleTag = `SPRIEST${counters.SPRIEST++}`;
      } else if (player.class === "Hunter" && player.spec === "Survival") {
        roleTag = `SURVIVAL${counters.SURVIVAL++}`;
      }

      if (roleTag) {
        mappings[roleTag] = player;
      }
    }

    return mappings;
  }
}

module.exports = RaidHelperService;
