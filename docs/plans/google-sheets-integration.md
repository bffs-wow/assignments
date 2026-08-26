# Plan: Google Sheets Integration

**Status:** Approved for Planning
**Date:** 2024-07-30
**Owner:** @seanm

## Problem Statement

The current raid assignment automation CLI generates `.tsv` files locally. Raid leaders manually copy the contents of these files and paste them into a specific "SOO-Assigns-Import" tab within their Google Sheet. This manual copy-paste process is time-consuming, prone to human error, and introduces friction into the raid preparation workflow.

## Solution

Automate the direct push of generated WoW Classic raid assignments to the designated Google Sheet tab. This feature will streamline the assignment process, ensuring the Google Sheet always reflects the latest generated assignments for a given encounter, reducing manual effort and potential errors.

## User Stories

1.  As a raid leader, I want to automatically push generated raid assignments to my Google Sheet, so that I no longer have to manually copy-paste data from local TSV files.
2.  As a raid leader, I want the assignments to be pushed to the sheet at each pipeline save point (initial generation and each refinement turn), so that the Google Sheet reflects the most up-to-date assignment state.
3.  As a raid leader, I want to authenticate with my personal Google account using OAuth, so that I can manage access securely via browser-based consent.
4.  As a raid leader, I want to configure the target Google Sheet ID and API credentials via environment variables, so that I don't have to specify them in the CLI for every run.
5.  As a raid leader, I want the assignments to be written into the correct "COUNT" section of the specified encounter in the sheet, so that they appear in the expected location.
6.  As a raid leader, I want the application to produce a full "spread" of assignments up to the detected capacity for each encounter, based on the roles discovered in the signup and their relevant spells, so that I have comprehensive coverage for flexible roster management.
7.  As a raid leader, I want to be warned loudly if the generated assignments exceed the available capacity in the Google Sheet for a given encounter, so that I can adjust the generation parameters or the sheet's layout.
8.  As a raid leader, I want all other encounter assignment blocks in the Google Sheet to remain untouched when only one encounter is being updated, so that existing manual configurations for other fights are preserved.
9.  As a raid leader, I want a backup of the existing encounter's assignments to be created locally before any write operation, so that I can revert to a previous state if necessary.
10. As a raid leader, I want the AI-generated assignments to accurately reflect the sheet's specific column structure, including support for comma-separated multi-cast counts and proper placement of custom spell notes and icons.
11. As a raid leader, I want assignments within an encounter's block in the sheet to be sorted by event and then by time, so that they are easy to review and understand.
12. As a raid leader, I want the CLI to map WoW Classic encounter names/IDs to the full encounter names used in the Google Sheet, so that I can use standard CLI arguments.

## Implementation Decisions

### 1. Authentication

*   **Method:** OAuth 2.0 using the user's personal Google identity.
*   **Flow:** On first use, a `--login` CLI flag will initiate a browser-based consent flow.
*   **Token Storage:** The obtained refresh token (along with `client_id` and `client_secret`) will be persisted in the local `.env` file.
*   **New `.env` Keys:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

### 2. Target Sheet & Tab Configuration

*   **Sheet ID:** Configured via `GOOGLE_SHEET_ID` environment variable.
*   **Tab Name:** Fixed to `"SOO-Assigns-Import"`.

### 3. Write Trigger & Failure Behavior

*   **Trigger Points:** The Google Sheets push logic will be integrated into `index.js` at the existing `writeAssignments()` calls, which occur after initial generation and after each refinement turn in the interactive loop.
*   **Failure Behavior:** If the Google Sheets API push fails (e.g., network error, API rate limit, invalid credentials), the system will issue a loud warning to the user and fall back to writing the assignments to the local `.tsv` files. The pipeline will not hard-fail.

### 4. Sheet Interaction Strategy

*   **Targeting:** The tool will operate on a single encounter's assignment block, specified via the `-e` CLI argument. All other encounters in the sheet will remain untouched.
*   **Backup:** Before any write operation to an encounter's section-2 block, the existing non-blank rows within that block will be read and saved to a local, timestamped CSV backup file (e.g., `backups/<encounter_full_name>-<YYYYMMDDHHMMSS>.csv`).
*   **Block Detection:**
    *   The tool will scan the Google Sheet to dynamically locate the target encounter's assignment block. This involves looking for the full encounter name in **Column B** (e.g., "IMMERSEUS", "THE FALLEN PROTECTORS") and then identifying its associated "COUNT" header in **Column D**.
    *   The data region for Section 2 (the "COUNT" section) is defined as the rows immediately following the "COUNT" header up to the row just before the next encounter's "HEALTH %" header (or the end of the sheet).
*   **Capacity Detection:** The usable capacity of the section-2 block for an encounter will be dynamically determined by counting the maximum number of rows available within the detected data region. This value will be communicated to the AI generator.
*   **Clear & Replace:** The entire detected section-2 data block for the target encounter will be cleared (all rows within the span will be emptied).
*   **Write Data:** Fresh assignments, generated by the AI, will be written into the cleared block, starting from the first data row.
*   **Truncation:** If the number of generated assignments exceeds the detected block capacity, the assignments will be truncated, and a loud warning will be issued to the user, listing any assignments that were dropped.
*   **Column Handling:** Columns B, H, I, J, L are generally untouched; however, Column J (`ADDITIONAL TEXT`) may be written if the AI explicitly generates content for it (though human data tends to use K).

### 5. Data Model & Column Mapping

The tool will map the internal assignment schema fields to the Google Sheet's 13-column layout (A-M) as follows:

| Sheet Column | Header (from Row 2)     | Assignment Schema Field | Notes                                                              |
| :----------- | :---------------------- | :---------------------- | :----------------------------------------------------------------- |
| A            | `Player`                | `player`                | Resolved player name from the roster map (blank for group tags).   |
| B            | `CD #`                  | —                       | Untouched.                                                         |
| C            | `BOSS HEALTH / SPELL`   | `event`                 | **Must match WA trigger strings exactly.**                         |
| D            | `COUNT / HEALTH %`      | `occurrence`            | Formatted as `1,3,5` for multi-cast; single number for single-cast. |
| E            | `PLAYER / CLASS / ALL`  | `roleTag`               | E.g., `PROTPALA1`, `ALL`, `MELEEDPS`.                              |
| F            | `TIME`                  | `timingOffset`          | Signed integer/float (negative = seconds before trigger).          |
| G            | `COOLDOWN SPELL`        | `spellName`             | The spell name. For custom spells, this will be `Custom Spell Assignment`. |
| H            | (blank)                 | —                       | Untouched.                                                         |
| I            | (blank)                 | —                       | Untouched.                                                         |
| J            | `ADDITIONAL TEXT`       | —                       | Left empty (human data primarily uses K).                          |
| K            | `OVERRIDE TTS`          | `notes`                 | AI-generated free-form notes, used for custom spell names (e.g., "Healthstone") or tactical instructions ("Bop Priest 1"). |
| L            | `CUSTOM NAME`           | —                       | Untouched.                                                         |
| M            | `CUSTOM ICON`           | `spellId`               | WoW Spell ID (e.g., `538745`).                                     |

### 6. Generator Output Adaptation & Governance

*   **Multi-cast Counts:** The AI generator will be prompted to produce `occurrence` values as comma-separated lists (e.g., `"1,3,5"`) when a single assignment covers multiple casts.
*   **Custom Spells:** For assignments involving custom spells, the generator will output `spellName` as `"Custom Spell Assignment"`, with the actual custom spell name placed in `notes` (which maps to Column K), and the relevant `spellId` placed in Column M.
*   **Event-Name Governance:**
    *   A static, per-encounter allowlist of event trigger names will be curated from the provided CSV export. This list (e.g., `Encounter Start (IMM)`, `Swelling Corruption` for Immerseus) will be baked into the application's configuration.
    *   The AI generator will be strictly constrained to use only event names from this allowlist.
    *   The generator's prompt will explicitly include the detected block capacity, the per-encounter event allowlist, the roster's role-tag allowlist (including group tags like `ALL`, `MELEEDPS`), and a map of encounter abbreviations (e.g., `IMM` for Immerseus).
*   **Encounter Mapping:** A static internal map will be maintained to translate WCL encounter names/IDs (as used by the CLI's `-e` flag) to the full encounter names used in the Google Sheet's Column B headers (e.g., "The Fallen Protectors" CLI arg maps to "THE FALLEN PROTECTORS" in the sheet).

### 7. Assignment Ordering

*   Within the target encounter's section-2 block, the written assignments will be sorted for human reviewability. The default sorting order will be by `event` (using a predefined encounter-specific event order) and then by `TIME` (`timingOffset`).

## Testing Decisions

### 1. What Makes a Good Test

Tests will focus on verifying the external behavior and outcomes of the Google Sheets integration, rather than internal implementation details. This includes:
*   Confirming correct data is written to the Google Sheet.
*   Verifying that local backups are created accurately before a write.
*   Ensuring appropriate warnings are issued (e.g., for truncation, API failures).
*   Validating that other encounter blocks remain untouched.

### 2. Modules to be Tested

*   **Google Sheets API Wrapper/Service:** New module(s) responsible for authenticating with Google, reading from, and writing to the Google Sheets API. These will have dedicated unit tests.
*   **Assignment Pipeline (`index.js`):** Integration tests will be extended to cover the full flow, from CLI invocation through Google Sheet output.
*   **Sheets Formatter/Writer:** A new module responsible for transforming the internal assignment schema into the Google Sheet's specific 13-column row format. This will have unit tests.

### 3. Prior Art for Tests

Existing `test/unit/*.test.js` and `test/integration/*.test.js` files will serve as models. Specifically, the integration tests that verify the output of `index.js` (e.g., checking TSV file contents) will be adapted to assert against Google Sheet contents (mocking the API for speed, using actual API calls in dedicated E2E tests if necessary).

## Out of Scope

*   **WeakAura Direct Interaction:** The tool will write assignments to the Google Sheet. The manual step of copying the "WeakAura box" from the sheet and pasting it into the game's WeakAura will remain a user responsibility.
*   **Strict Sheet Data Validation Enforcement:** While the AI generator will receive allowed value lists, the tool will not implement complex client-side validation against Google Sheet's data validation rules at write time, beyond issuing warnings based on potential conflicts.
*   **Complex Merge/Preservation Logic:** The previously discussed strategy to merge AI-generated assignments with and preserve *unmatched* manual configurations (Option B for Q15) is out of scope. The chosen strategy is "backup, clear, and replace" for the target encounter block.
*   **Generating New Event Names:** The tool will not generate event names that are not present in the curated, static allowlist.
*   **Section 1 (Health % Assignments) Support:** This feature focuses exclusively on writing assignments to the "COUNT" (Section 2) blocks. Section 1 rows will be ignored for writing.

## Further Notes

*   The implementation will leverage the official `googleapis` Node.js client library for interacting with Google Sheets.
*   Error handling will prioritize robustness, with local TSV backups and warnings serving as critical fallbacks for API failures or other issues.
*   The system will be designed to gracefully handle scenarios such as the target Google Sheet or tab not being found.
*   The `backups/` directory will be created if it doesn't exist and should be added to `.gitignore`.
*   The encounter abbreviation map (e.g., IMM, FAL, NOR, etc.) derived from the CSV will be explicitly documented and used for event name generation and parsing.
