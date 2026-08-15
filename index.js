require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RaidHelperService = require('./src/services/raidhelper');
const WCLService = require('./src/services/wcl');
const AIAgent = require('./src/agent');
const WCLExplorerAgent = require('./src/wcl_explorer');
const CSVFormatter = require('./src/utils/csv_formatter');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptUser(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function writeAssignments(assignments, roleMappings, suffix = "") {
  const tsvOutput = CSVFormatter.formatToTSV(assignments, roleMappings);
  const outputPath = path.join(__dirname, `assignments_output${suffix}.tsv`);
  fs.writeFileSync(outputPath, tsvOutput);
  console.log(`\n-> Assignments written to: ${outputPath}`);
}

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
  const explorerAgent = new WCLExplorerAgent(
    process.env.GEMINI_API_KEY,
    process.env.WCL_CLIENT_ID,
    process.env.WCL_CLIENT_SECRET
  );

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

    // 4. Generate Initial Assignments via AI
    let assignments = await agent.generateAssignments(timeline, roleMappings, skillsData);
    console.log(`AI successfully generated ${assignments.length} assignments.`);
    await writeAssignments(assignments, roleMappings, "_initial");

    // 5. Interactive Loop
    while (true) {
      console.log("\n--- Interactive Mode ---");
      console.log("1. Provide feedback to adjust assignments (e.g., 'add an assignment for everyone to move to blue')");
      console.log("2. Ask the WCL Explorer a question (e.g., 'What were the major boss casts in this report?')");
      console.log("3. Exit");

      const choice = await promptUser("Select an option (1-3): ");

      if (choice === '1') {
        const feedback = await promptUser("Enter your feedback/instructions: ");
        assignments = await agent.refineAssignments(assignments, feedback);
        await writeAssignments(assignments, roleMappings, "_refined");
      } else if (choice === '2') {
        const query = await promptUser("Enter your WCL question: ");
        const answer = await explorerAgent.explore(query);
        console.log(`\n[WCL Explorer Answer]:\n${answer}\n`);
      } else if (choice === '3' || choice.toLowerCase() === 'exit' || choice.toLowerCase() === 'quit') {
        console.log("Exiting. Final assignments are saved.");
        break;
      } else {
        console.log("Invalid option, try again.");
      }
    }

  } catch (err) {
    console.error("An error occurred during automation:", err);
  } finally {
    rl.close();
  }
}

main();
