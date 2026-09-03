# Project memory — bffs-wow/assignments

## Session captures
- [2026-08-22](2026-08-22.md) — BLA/PAR reference reconciliation; WCL pull analysis (real
  Blackfuse cadence: Magnetic Crush never cast, shredder -16s valid only for 1st shredder);
  occurrence `-1` validator fix; roster drift between reference and live sheet; WCL service quirks.

## Durable facts
- Reference kill set (read-only): sheet `1mfRwq54y-3AZO4JgmvYitW6JW83YsAPycwigZYswR8Y`, payload in
  `'SOO-Assigns-Import'!G1`; captured at `ref/ref-payload.txt`, parsed at `ref/ref-payload-parsed.json`.
- Live sheet: `1SqMdIVBKMYRfOaGw4TucVVPpjqm4kvXqEZJo6W1HWms`. Roster at `'MoP-Data-Assigns'!F:G`.
- Validator accepts lone `-1` occurrence (pre-event sentinel) since `bc52b83`.
- WCL service default-exports `WCLService`; `executeQuery` returns raw `data`; real creds in `.env`.