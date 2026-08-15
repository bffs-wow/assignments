const { GoogleGenAI, Type, Schema } = require('@google/genai');

class AIAgent {
  constructor(apiKey) {
    this.ai = new GoogleGenAI({ apiKey: apiKey });
  }

  async analyzeCommunityPractices(communityLogs) {
    console.log("Analyzing community practices from top guild logs...");

    const prompt = `
You are an expert World of Warcraft combat log analyst.
Review the following log data from successful pulls by top guilds.
Extract the "community practices"—specifically, which major cooldowns are used in response to which boss abilities or phases.

Community Logs:
${JSON.stringify(communityLogs, null, 2)}

Provide a concise summary of the standard strategy. For example:
- "Desperate Measures Sun: Typically covered by Healing Tide Totem and Spirit Link Totem."
- "Mark of Anguish: Tanks receive Hand of Sacrifice and Pain Suppression."
`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt
      });

      return response.text;
    } catch (error) {
      console.error("Error analyzing community practices:", error);
      throw error;
    }
  }

  async refineAssignments(currentAssignments, humanFeedback) {
    console.log(`Refining assignments based on feedback: "${humanFeedback}"...`);

    const prompt = `
You are an expert World of Warcraft raid leader.
Below is the current JSON array of raid cooldown assignments.

Current Assignments:
${JSON.stringify(currentAssignments, null, 2)}

The raid leader (user) has provided the following feedback/instructions to modify these assignments:
"${humanFeedback}"

Please apply these instructions to the JSON array.
You may need to add new assignments, remove existing ones, or change timings/spells.
If the user asks for a completely arbitrary assignment (e.g., "everyone say 'move to blue'"), create an assignment with roleTag "ALL" and the requested action as the spellName or notes.

Output format MUST be valid JSON in this EXACT schema:
[
  {
    "event": "Event Name",
    "occurrence": 1,
    "roleTag": "Role Tag (e.g., PROTPALA1, DISC1, ALL)",
    "timingOffset": 1,
    "spellName": "Name of the spell assigned",
    "notes": "Any notes or context",
    "spellId": ""
  }
]
`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                event: { type: Type.STRING },
                occurrence: { type: Type.INTEGER },
                roleTag: { type: Type.STRING },
                timingOffset: { type: Type.INTEGER },
                spellName: { type: Type.STRING },
                notes: { type: Type.STRING },
                spellId: { type: Type.STRING }
              },
              required: ["event", "occurrence", "roleTag", "timingOffset", "spellName", "notes"]
            }
          }
        }
      });

      return JSON.parse(response.text);
    } catch (error) {
      console.error("Error refining assignments with AI:", error);
      throw error;
    }
  }

  async generateAssignments(timeline, availableRoles, skillsData, communityStrategy = "") {
    console.log("Analyzing encounter timeline with AI...");

    const strategySection = communityStrategy ? `
Community Practices (Highly Recommended Strategy to Mimic):
${communityStrategy}
` : "";

    const prompt = `
You are an expert World of Warcraft: Mists of Pandaria raid leader.
Your task is to assign raid cooldowns to major boss events based on the provided encounter timeline and the available raid roster.

Available Roles and their toolkits:
${JSON.stringify(skillsData, null, 2)}

Current Raid Roster Roles Available:
${JSON.stringify(Object.keys(availableRoles))}

Encounter Timeline:
${JSON.stringify(timeline, null, 2)}
${strategySection}
Rules for assignment:
1. Assign appropriate defensive and utility cooldowns to high-damage or high-risk events (like "Desperate Measures Sun", "Calamity", "Mark of Anguish").
2. Respect cooldown durations. If a spell has a 180s cooldown, do not assign that exact player (e.g., DISC1) to use it again within 180 seconds.
3. For heavy single target damage (like "Mark of Anguish"), assign tank externals like "Hand of Sacrifice" or "Pain Suppression", or personal tank cooldowns like "Shield Wall".
4. For heavy raid damage (like "Calamity"), assign raid cooldowns like "Devotion Aura", "Healing Tide Totem", "Power Word: Barrier", or "Spirit Link Totem".
5. For "Encounter Start", always assign "ALL" -> "Bloodlust".
6. Do your best to spread out cooldowns so the raid is covered across all dangerous events.
7. If Community Practices are provided, strongly prioritize mimicking those cooldown assignments for the respective events, assuming the required roles are available in the current roster.

Output format MUST be valid JSON in this EXACT schema:
[
  {
    "event": "Event Name",
    "occurrence": 1,
    "roleTag": "Role Tag (e.g., PROTPALA1, DISC1, ALL)",
    "timingOffset": 1,
    "spellName": "Name of the spell assigned",
    "notes": "Any notes or context",
    "spellId": ""
  }
]
`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                event: { type: Type.STRING },
                occurrence: { type: Type.INTEGER },
                roleTag: { type: Type.STRING },
                timingOffset: { type: Type.INTEGER },
                spellName: { type: Type.STRING },
                notes: { type: Type.STRING },
                spellId: { type: Type.STRING }
              },
              required: ["event", "occurrence", "roleTag", "timingOffset", "spellName", "notes"]
            }
          }
        }
      });

      return JSON.parse(response.text);
    } catch (error) {
      console.error("Error generating assignments with AI:", error);
      throw error;
    }
  }
}

module.exports = AIAgent;
