# Raid-Night Runbook

Operational command chain and recovery procedures for the raid leader on Tuesday / Thursday raid nights.

---

## 1. Prerequisites

### Environment & Toolchain
- **Node.js**: `>= 22.19.0` (`node -v`)
- **Dependencies & Build**:
  ```bash
  npm install
  npm run build
  ```

### `.env` Configuration
Ensure `.env` in the repository root has all required tokens:

```env
# AI Agent Providers (at least one required for generate/refine)
GEMINI_API_KEY=your_gemini_api_key
OPENCODE_API_KEY=your_opencode_api_key

# Roster & Logs
RAID_HELPER_API_KEY=your_raid_helper_token
WCL_CLIENT_ID=your_wcl_client_id
WCL_CLIENT_SECRET=your_wcl_client_secret

# Google Sheets Push (Test Raid Sheet: "AI BFFS SOO Assigns")
GOOGLE_CLIENT_ID=your_oauth_client_id
GOOGLE_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_REFRESH_TOKEN=your_oauth_refresh_token
GOOGLE_SHEET_ID=1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms
```

### Google OAuth Token Refresh
If `push` fails with `NOT_AUTHENTICATED` (expired or missing refresh token):
```bash
bash scripts/google-oauth-wizard.sh
```
*Note for headless/remote servers*: forward the printed loopback port before opening the auth URL in your browser:
```bash
ssh -L <PORT>:127.0.0.1:<PORT> <remote-host>
```

---

## 2. Full Pipeline Command Chain (Tue/Thu Flow)

All commands run from the repository root. Artifacts persist in `.cache/cli/` (override with `--state <dir>`).

### Step 1: Ingest Raid-Helper Roster
Resolves player signups to canonical sheet role tags (`DISC1`, `PROTPALA1`, `RSHAM1`, etc.):
```bash
node dist/src/index.js mappings -R <raidhelper-event-id> -e "<encounter-name>"
```
*Output*: `.cache/cli/rolemappings.json`

### Step 2: Fetch Community Kill Strategy
Pulls defensive rotation and cooldown patterns from top community parses:
```bash
node dist/src/index.js community -e "<encounter-name>" -i classic
```
*Output*: `.cache/cli/community.json`

### Step 3: (Optional) Ingest Encounter Timeline
*Optional — generation works report-lessly from roster + community alone.* Only use if logs exist from prep/previous pulls:
```bash
node dist/src/index.js timeline -r <wcl-report-code> -f <fight-id> -i classic
```
*Output*: `.cache/cli/timeline.json`

### Step 4: Generate Assignments
Generates the assignment matrix against the canonical boss vocabulary and roster:
```bash
node dist/src/index.js generate -e "<encounter-name>" -R <raidhelper-event-id>
```
*Outputs*:
- `.cache/cli/committed.json` (canonical assignment state)
- `.cache/cli/assignments.csv` (13-column sheet-compliant export grid)
- `.cache/cli/assignments.tsv` (legacy fallback)

*Auto-push note*: When Google credentials are configured in `.env`, `generate` automatically pushes to the sheet. If push fails, local artifacts remain intact.

### Step 5: Review & Refine

#### Review current committed plan:
```bash
node dist/src/index.js review
```
Prints the rendered CSV and TSV tables to stdout.

#### Refine with tactical adjustments:
```bash
node dist/src/index.js refine --feedback "<instructions>"
```
*Examples*:
```bash
node dist/src/index.js refine --feedback "Move Bloodlust to second Corrosive Blast"
node dist/src/index.js refine --feedback "Assign Shield Wall on Reave count 2 to PROTPALA1"
```
*Outputs*: Overwrites `.cache/cli/committed.json`, `.cache/cli/assignments.csv`, and `.cache/cli/assignments.tsv`.

### Step 6: Push to Google Sheet
Pushes the committed plan directly into the target boss's `COUNT` block:
```bash
node dist/src/index.js push -e "<encounter-name>" --yes
```
*Flags*:
- `-e, --encounter <name|id>`: Target encounter (e.g. `"Paragons of the Klaxxi"`, `"paragons-of-the-klaxxi"`, `"Immerseus"`). Defaults to committed encounter.
- `--yes`: Bypasses the interactive confirmation prompt.
- `--state <dir>`: Optional state directory (default: `.cache/cli`).

---

## 3. Single-Shot & Interactive Alternatives

### One-Command Pipeline (`run`)
Runs mappings, optional timeline, community analysis, and generation in one pass:
```bash
node dist/src/index.js run -R <raidhelper-event-id> -e "<encounter-name>"
```

### Interactive Menu
Interactive TTY wizard for step-by-step execution:
```bash
npm start
```

---

## 4. CSV Fallback Path (Manual Paste)

If the Google Sheets API push is unavailable or fails (e.g., Google service outage, bad token, permission error):

1. **Verify local artifact generation**:
   Confirm `.cache/cli/assignments.csv` exists and was rendered without validation errors.
2. **Open the Google Sheet**:
   Navigate to the workbook and switch to the **`SOO-Assigns-Import`** tab.
3. **Locate the boss section**:
   Find the boss display name in Column B (e.g. `PARAGONS OF THE KLAXXI`).
4. **Locate the COUNT block**:
   Find the header row where Column D is `COUNT`. Data rows start immediately on the next row.
5. **Paste data rows**:
   - Open `.cache/cli/assignments.csv` in a text editor or run `node dist/src/index.js review`.
   - Copy only the assignment data rows for that boss.
   - Paste into the sheet starting at **Column C** (`BOSS HEALTH / SPELL`).
   - **CRITICAL**: Do NOT overwrite Column A (`Player`) or Column H (spell icon) — these contain sheet formulas (`=VLOOKUP`, `=IMAGE`).

---

## 5. Sheet Navigation & Inspection

- **Workbook**: `AI BFFS SOO Assigns` (`GOOGLE_SHEET_ID`)
- **Tab**: `SOO-Assigns-Import`
- **Boss Block Structure**:
  - Rows 1–15 of boss section: `Health % (<abbr>)` block — human-maintained threshold triggers (**never touched by automation**).
  - Row 16: `LEAVE BLANK` separator.
  - Row 17: `COUNT` header (`COUNT / HEALTH %` = `COUNT`).
  - Rows 18+: Active assignment data rows (cleared and replaced on each push).

### Column Map

| Column | Header | Written by Automation? | Notes |
|---|---|---|---|
| **A** | `Player` | **NO** | Formula-owned (`=VLOOKUP`). Resolves live from Roster Mappings. |
| **B** | `CD #` | **NO** | Left untouched. |
| **C** | `BOSS HEALTH / SPELL` | **YES** | Closed canonical event name (e.g. `Encounter Start (PAR)`, `Reave`). |
| **D** | `COUNT / HEALTH %` | **YES** | Cast count (e.g. `1`, `"1,4"`, `-1`). |
| **E** | `PLAYER/CLASS/ALL` | **YES** | Role tag (`PROTPALA1`, `ALL`, `MELEEDPS`). |
| **F** | `TIME` | **YES** | Timing offset in seconds (supports negatives like `-20`). |
| **G** | `COOLDOWN SPELL` | **YES** | Canonical spell, or literal `"Custom Spell Assignment"`. |
| **H** | *(icon)* | **NO** | Formula-owned spell icon (`=IMAGE`). |
| **I** | `NPC NAME` | **NO** | Left untouched. |
| **J** | `ADDITIONAL TEXT` | **YES** | Tactical notes and instructions (`stack`, `tank external`). |
| **K** | `OVERRIDE TTS` | **YES** | TTS phrase, or real spell name for custom spells (`Lay on Hands`, `Void Shift`). |
| **L** | `CUSTOM NAME` | **NO** | Left blank per live sheet convention. |
| **M** | `CUSTOM ICON` | **YES** | Numeric spell ID for custom assignments. |

### WeakAura Import Box
- Cell **`H1`** on `SOO-Assigns-Import`:
  `<- COPY THIS BOX AFTER EXPORTING TOT ASSIGNS`
- Automatically generated by sheet formulas from the data rows.
- **Action for Raid Leader**: After push or manual paste, select Cell `H1`, copy the entire text string, and paste into the in-game WeakAura addon (`/wa` → Import).

---

## 6. Known Gotchas & Operational Pitfalls

1. **Test Sheet vs. Production Sheet**:
   - `GOOGLE_SHEET_ID` in `.env` defaults to the **Test Raid Sheet** (`1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms`).
   - Do NOT target the production sheet until human sign-off is completed.
2. **Refresh Token Expiry / Invalidation**:
   - Refresh tokens are tied to individual checkouts / developer accounts.
   - If `push` reports `NOT_AUTHENTICATED` or 401, re-run `bash scripts/google-oauth-wizard.sh`.
3. **Loopback Redirect URI Mismatch**:
   - Google Desktop OAuth clients require `127.0.0.1:<port>/`. Never manually change `127.0.0.1` to a public IP or LAN hostname in the URL.
4. **Pre-Write Backups**:
   - Every `push` creates a timestamped CSV of previous non-blank rows in `backups/<boss>-<timestamp>.csv`.
   - Use these files to restore previous sheet states if an accidental overwrite occurs.
5. **Exact Event Vocabulary**:
   - Event names must match the canonical whitelist (`src/serializer/bosses.ts`). The validator rejects invented or paraphrased names with exit code 1.
6. **Role Tag Aliases**:
   - When community strategies mention reference roles (e.g. `DISC1`, `UHDK1`), the pipeline automatically remaps them to live roster bindings (`HOLYPRIEST1`, etc.) via `resolveToLiveRoster`. Unresolved roles produce loud warnings.

---

## 7. Status & References

### Merged V1 Foundation
- [#43](https://github.com/bffs-wow/assignments/pull/43): Lossless CSV read-back (`parseSooAssigns`)
- [#44](https://github.com/bffs-wow/assignments/pull/44): Refiner canonical event whitelist steering
- [#45](https://github.com/bffs-wow/assignments/pull/45): `resolveToLiveRoster` drift resolution helper
- [#46](https://github.com/bffs-wow/assignments/pull/46): CLI sheet CSV artifact wiring (`assignments.csv`)
- [#51](https://github.com/bffs-wow/assignments/pull/51): Reference-format doc sync & paste-validation gate
- [#52](https://github.com/bffs-wow/assignments/pull/52): MoP event vocabulary snapshot freeze
- [#54](https://github.com/bffs-wow/assignments/pull/54): Google Sheets `COUNT`-block push (`SheetAssignmentsWriter`)
- [#57](https://github.com/bffs-wow/assignments/pull/57): OAuth wizard re-consent UX and headless forwarding

### Pending / In-Flight
- [#55](https://github.com/bffs-wow/assignments/pull/55): Live-follow sheet prototype capture (P1)
- [#27](https://github.com/bffs-wow/assignments/issues/27): Live raid lead HITL sign-off (this runbook)
