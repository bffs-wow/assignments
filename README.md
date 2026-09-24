# WoW Classic Raid Assignment Automation

Node.js CLI application designed to automate raid cooldown assignments for World of Warcraft Classic (Mists of Pandaria). It bridges signups from Raid-Helper and combat timelines from Warcraft Logs, leveraging Flue/Gemini AI agents to generate and refine optimal cooldown matrices targeting the guild's shared Google Sheets workbook ("AI BFFS SOO Assigns") and the in-game RAIDLEAD WeakAura pack.

---

## Architecture & Flow

The pipeline executes through defined, state-persisted operational steps:

1. **Roster Mapping (`mappings`)**: Ingests signups from Raid-Helper and resolves individual players to canonical sheet role tags (e.g., `DISC1`, `PROTPALA1`, `RSHAM1`).
2. **Timeline Ingestion (`timeline`)**: Extracts boss ability timelines, phase markers, and encounter events from Warcraft Logs.
3. **Community Strategy Analysis (`community`)**: Analyzes top-ranking kill logs to extract community cooldown patterns and defensive rotations.
4. **Plan Generation (`generate`)**: Prompts the `AssignmentGenerator` agent against the roster, skills catalog, community strategy, and encounter canonical event whitelist.
5. **Interactive & Directed Refinement (`refine`)**: Applies natural-language leader feedback (e.g. "move everyone to blue marker on Calamity") through the `AssignmentRefiner` agent while maintaining event whitelist conformance.
6. **Log Exploration (`explore`)**: Ad-hoc questions answered by the `WCLExplorer` agent via Warcraft Logs queries.
7. **Sheet Sync (`push`)**: Writes assignment rows directly to the test raid sheet's `SOO-Assigns-Import` COUNT block with automatic timestamped CSV backups.

---

## Sheet-Compliant CSV Artifact (`assignments.csv`)

The primary deliverable of the pipeline is a 13-column, sheet-compliant CSV artifact designed for lossless pasting and direct import into the `SOO-Assigns-Import` tab of the guild's raid workbook.

### Where it lands
- Default path: `.cache/cli/assignments.csv`
- Custom state directory: `<state-dir>/assignments.csv` (configured via `--state <dir>`)

### What commands emit it
- **`generate`**: Generates a new plan and renders `assignments.csv` upon successful validation.
- **`run`**: Executes the full pipeline (roster + timeline + community + generate), producing `assignments.csv`.
- **`refine`**: Modifies the committed plan based on leader feedback and emits an updated `assignments.csv`.
- **`review`**: Re-renders `assignments.csv` directly from `committed.json` using the persisted encounter, printing the CSV and TSV to stdout.

### Grid Layout & Conventions
The emitted CSV adheres strictly to the 13-column export grid format:

| Column | Header | Description |
|---|---|---|
| A (0) | `Player` | Player name resolved from role mappings (blank on `ALL` / group tag rows) |
| B (1) | `CD #` | Cooldown slot number (optional/empty in data rows) |
| C (2) | `BOSS HEALTH / SPELL` | Closed canonical event name (e.g. `Encounter Start (PAR)`, `Reave`, `Death from Above (PAR)`) |
| D (3) | `COUNT / HEALTH %` | Occurrence count (`1`, comma list `"1,4"`, or lone `-1` pre-event sentinel) |
| E (4) | `PLAYER/CLASS/ALL` | Resolved role tag (`PROTPALA1`, `RSHAM1`, `ALL`, `MELEEDPS`, `HEALERS`, etc.) |
| F (5) | `TIME` | Timing offset in seconds (supports negative pre-casts like `-20` and decimals like `0.5`) |
| G (6) | `COOLDOWN SPELL` | Canonical cooldown name, or literal `"Custom Spell Assignment"` |
| H (7) | *(blank)* | Reserved column |
| I (8) | `NPC NAME` | Scaffold markers (`<Boss Name>` on row 1, `LEAVE BLANK` on row 16; blank in data rows) |
| J (9) | `ADDITIONAL TEXT` | Notes and tactical instructions (e.g. `tank external`, `Pop SLT`) |
| K (10) | `OVERRIDE TTS` | TTS override; for custom spells, carries the actual spell name (e.g. `Lay on Hands`, `Void Shift`) |
| L (11) | `CUSTOM NAME` | Blank by live sheet convention |
| M (12) | `CUSTOM ICON` | Spell ID for custom assignments (e.g. `633`, `135739`) |

### Structural Determinism & Validation
- **14-Boss Scaffold**: Pre-populates all 14 Siege of Orgrimmar bosses in sheet order with their 15 `Health % (<abbr>)` template rows, `LEAVE BLANK` separator, and `COUNT` block header.
- **Closed Vocabulary Gate**: Every assignment is validated against the boss's canonical event list and allowed roster tags. If validation fails, all grouped errors are output to stderr, exit code `1` is set, and no invalid/empty CSV is written.
- **Legacy Fallback**: The legacy `assignments.tsv` is still written alongside `assignments.csv` during the transition period (marked `@deprecated`).

---

## CLI Usage

Run directly or inspect commands:

```bash
# Interactive menu
npm start

# Standalone subcommands
node dist/src/index.js mappings -R <raidhelper-event-id> -e "Paragons of the Klaxxi"
node dist/src/index.js generate -e "Paragons of the Klaxxi"
node dist/src/index.js refine --feedback "add shield wall for tank on reave"
node dist/src/index.js review
node dist/src/index.js push --encounter "paragons-of-the-klaxxi" --yes
```

---

## Environment Setup

Create a `.env` file in the repo root:

```env
OPENCODE_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
WCL_CLIENT_ID=your_client_id
WCL_CLIENT_SECRET=your_client_secret
RAID_HELPER_API_KEY=your_token
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REFRESH_TOKEN=your_google_oauth_refresh_token
GOOGLE_SHEET_ID=1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms
```

#### Refreshing the Google tokens

Google refresh tokens are **per-clone**: each checkout has its own `.env`, so a
token minted for one clone does not refresh the others. When `push` fails with
`NOT_AUTHENTICATED` (HTTP 401 on `oauth2.googleapis.com/token`, `invalid_grant`),
re-run the wizard:

```bash
bash scripts/google-oauth-wizard.sh
```

It remembers saved values and only re-consents the refresh token (Stages 1–4
are pure confirmations on re-runs; one-time browser consent on Stage 5). Key
facts the wizard handles for you:

*   Callback listener auto-picks a **free loopback port** (8790–8899,
    override `OAUTH_PORT=<n>`) — the 878x range is occupied by other tools
    on this host.
*   Redirect stays `127.0.0.1:<port>/`: Google's Desktop-type OAuth client
    accepts only loopback. Do **not** rewrite the redirect to a LAN IP in the
    auth URL — the token exchange must see the byte-identical `redirect_uri`
    or Google rejects it with `redirect_uri_mismatch`/`invalid_request`.
*   Headless box? Open the auth URL from a machine that has a browser and
    forward the loopback port first: `ssh -L <port>:127.0.0.1:<port>
    <this-host>`. The wizard prints this when it detects no local browser.
*   Result files (`oauth-url.txt`, `oauth-refresh.txt`, `oauth-result.txt`)
    land in `.cache/`; the refresh token persists in `.env` via the wizard.
