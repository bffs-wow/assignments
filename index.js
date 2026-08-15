require('dotenv').config();
const fs = require('fs');
const path = require('path');

const RaidHelperService = require('./src/services/raidhelper');
const WCLService = require('./src/services/wcl');
const AIAgent = require('./src/agent');
const CSVFormatter = require('./src/utils/csv_formatter');

async function main() {
  console.log("Starting WoW Classic Raid Assignment Automation...");

  // Load configuration
  const eventId = "MOCK_EVENT_ID";
  const reportId = "MOCK_REPORT_ID";
  const fightId = "MOCK_FIGHT_ID";

  // Check critical API keys
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.error("ERROR: GEMINI_API_KEY is not set in .env");
    process.exit(1);
  }

  // Initialize Services
  const rhService = new RaidHelperService(process.env.RAIDHELPER_API_KEY);
  const wclService = new WCLService(process.env.WCL_CLIENT_ID, process.env.WCL_CLIENT_SECRET);
  const agent = new AIAgent(process.env.GEMINI_API_KEY);

  try {
    // 1. Get Role Mappings from RaidHelper
    const roleMappings = await rhService.getRoleMappings(eventId);
    console.log(`Successfully mapped ${Object.keys(roleMappings).length} roster roles.`);

    // 2. Get Encounter Timeline from Warcraft Logs
    const timeline = await wclService.getEncounterEvents(reportId, fightId);
    console.log(`Successfully fetched ${timeline.length} encounter events.`);

    // 3. Load Skill Data
    const skillsPath = path.join(__dirname, 'src', 'data', 'mop_skills.json');
    const skillsData = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));

    // 4. Generate Assignments via AI
    const assignments = await agent.generateAssignments(timeline, roleMappings, skillsData);
    console.log(`AI successfully generated ${assignments.length} assignments.`);

    // 5. Format and Output
    const tsvOutput = CSVFormatter.formatToTSV(assignments, roleMappings);

    const outputPath = path.join(__dirname, 'assignments_output.tsv');
    fs.writeFileSync(outputPath, tsvOutput);

    console.log(`\nSuccess! Assignments written to: ${outputPath}`);
    console.log(`You can now copy and paste the contents into your Google Sheet.`);

  } catch (err) {
    console.error("An error occurred during automation:", err);
  }
}

main();
