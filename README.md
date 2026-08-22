# WoW Classic Raid Assignment Automation

This project is a Node.js CLI application designed to automate raid cooldown assignments for World of Warcraft Classic (Mists of Pandaria). It bridges data from Discord/Raid-Helper and Warcraft Logs, using Google's Gemini AI to dynamically generate optimal cooldown rotations.

## Architecture & Flow

The application is built around a multi-stage pipeline:

1. **Roster Ingestion (`RaidHelperService`)**: Fetches signups from Raid-Helper and maps specific players and their specs to abstract role tags (e.g., `DISC1`, `PROTPALA2`).
2. **Timeline Extraction (`WCLService`)**: Pulls encounter events, enemy casts, and major damage phases from the Warcraft Logs GraphQL API.
3. **Community Practice Learning**: Before generating assignments, the AI analyzes top guild logs to extract a baseline "community strategy" (e.g., establishing that _Calamity_ is typically countered by _Power Word: Barrier_ and _Rallying Cry_).
4. **AI Generation (`AIAgent`)**: Uses `@google/genai` (specifically `gemini-2.5-flash` for its large context window) to map the roster's available skills against the encounter timeline, adhering to the community strategy and respecting spell cooldowns.
5. **Interactive Feedback Loop**: The CLI pauses after generating the initial assignment matrix, allowing the user to provide natural language feedback (e.g., "Add an assignment for everyone to stack on blue marker during Phase 2"). The AI refines the JSON data accordingly.
6. **WCL Explorer Agent**: Includes an autonomous tool-calling agent (`WCLExplorerAgent`) capable of writing and executing GraphQL queries against the WCL API to answer ad-hoc log questions.
7. **TSV Output (`CSVFormatter`)**: Formats the final JSON matrix into a Tab-Separated Values string, formatted perfectly for pasting directly into a Google Sheets assignment sheet.

## Current State & Next Steps

- **State:** The current implementation is a "Release Candidate Skeleton". The core architecture, AI prompting, and data formatting pipelines are fully built and validated using mocked data returns from the API services.
- **Next Steps:** Implement the actual API requests inside `src/services/wcl.js` (GraphQL Client Credentials flow) and `src/services/raidhelper.js`.

## Environment Setup

Requires a `.env` file containing:
\`\`\`env
GEMINI_API_KEY=your_gemini_api_key_here
WCL_CLIENT_ID=your_wcl_client_id_here
WCL_CLIENT_SECRET=your_wcl_client_secret_here
RAID_HELPER_API_KEY=your_raidhelper_token_here
\`\`\`
