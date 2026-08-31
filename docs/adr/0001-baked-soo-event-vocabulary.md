# Baked SOO event vocabulary

The raid sheet holds the canonical per-boss event vocabulary (MoP-Data-Assigns,
the display-name side of the event key lookups). We decided to bake a snapshot
of it into `src/data/soo-encounters.json` instead of reading it from the sheet
at generation time: the generator and any event validation stay deterministic
and offline, matching the plan's static per-encounter allowlist, and WCL lookup
already resolves encounters dynamically so no extra sheet reads are needed.

The snapshot was generated verbatim from the live sheet (2025-08-25), preserving
sheet order and exact spelling — including quirks like `Death From Above (BLA)`
vs `Death from Above (PAR)`, suffix-less Garrosh phase starts, and `SPOILS OF
PANDAREN` in the sheet header vs WCL's "Spoils of Pandaria".

**Considered options**

- *Read from the sheet at runtime*: single source of truth and self-validating,
  but couples generation to sheet access, needs the vocabulary before any
  offline runs, and adds a failure mode on a human-maintained document.

**Consequences**

- The sheet stays the source of truth; if the owner adds or renames events, the
  snapshot drifts until refreshed. Refresh by re-exporting the SOO display-name
  column from MoP-Data-Assigns and regenerating the file.
- `docs/tot-assigns-csv-format.md` compresses Blackfuse overloads to `Overload
  1..10`; the baked file expands them to ten distinct events.