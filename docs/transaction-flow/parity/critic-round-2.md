# Completeness critic — round 2

**Scope.** All 13 `parity/*.table.md` files (contract, control, deal-early, intake, inventory, jobs,
offers, payment, pickup, schema, sourcing, stages1-3, tests) — including the 19 **gap-fill rows**
appended to `control.table.md` after round 1 — re-checked item-by-item against
`docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` (read in full, all 1,607 lines) and
the data arrays in `docs/transaction-flow/AutoLenis-Transaction-Flow.html` (LANES 423-485,
S[] 487-753, INV 756-773, QUAL/BUDGET 786-795, MONEY/MONEY_PANELS 797-806, PLAN_* 809-852,
FIN_* 854-862, EXC 865-914, DEALSTATES/SUPSTATES/TRANSITION 917-932, SAFE 934-940, BUILD 942-973,
ACCEPT 975-979), plus the §8.1 phase table and master-prompt rules in `IMPLEMENTATION-WORKFLOW.md`.

**Coverage test applied (unchanged from round 1).** An inventory item is COVERED only where a table
row exists carrying a Requirement, a Current implementation, a Status, an Exact required change and
a Phase. A passing mention inside another row's prose was not accepted; a row that bundles an
explicit enumerated list was accepted for every *named* member of that list — and **not** for members
the bundle omits (this is how gap 2 below was found).

**Method.** Three independent passes, so the result does not rest on round 1's judgement:
1. **Structural re-derivation.** The 240 HTML actor bullets were re-extracted and re-counted per
   stage (`S[0..20]`, buyer/dealer/staff/system) — 10, 8, 11, 20, 10, 13, 10, 18, 11, 15, 12, 9, 21,
   10, 7, 7, 10, 16, 8, 5, 9 = **240**, confirming round 1's figure. §26 = 48 MD rows + the HTML-only
   "Communication terminal failure" = 49. §27.1 = 76. §28.1 = 18 states. §28.2 = 13 groups.
   §28.3 = 8. §29 = 20. §30 = 12. §32 = 26. §33 = 31.
2. **Mechanical weak-match sweep.** Every HTML actor bullet (241) and every MD bullet/table-row/bold
   atom (640) was scored against all 1,556 table rows on its four rarest content words; 14 + 100
   weak matches were then adjudicated by hand. All but two proved to be vocabulary mismatches, not
   coverage gaps.
3. **Named-token sweeps.** Every §4.1/4.3/4.4/4.5/4.7/§32 column name (74 tokens), every table name
   in every HTML `S[n].tables` array (47 tokens), and ~110 distinctive rule phrases were grepped
   across the 13 files. Zero column names and zero table names were unrepresented.

## Counts

| Measure | Value |
|---|---|
| Requirement inventory (spec atoms) | **1,109** |
| Covered by a qualifying table row | **1,107** (99.8 %) |
| GAPS (no qualifying row) | **2** |
| Table rows parsed across the 13 files | 1,556 (1,537 + 19 gap-fill) |
| Contradictions between tables | 11 (7 carried from round 1, 1 resolved, 4 new) |
| Phase-order violations | 11 (10 carried from round 1, 1 new) |
| Rows with unparseable Status/Phase cells (formatting defect, not a gap) | 24 (20 carried + 4 new) |
| Ref ids reused for different capabilities across files | 173 |

### Round-1 gaps: all 19 closed

`control.table.md` §"Gap-fill rows (round 1)" adds `B2-01..03`, `S12D-01..02`, `W30-01..12`,
`G35-01`, `P23-01` — one row per round-1 gap, each carrying Requirement, Current implementation,
Status, Exact required change and Phase. Verified individually:

| Round-1 gap | New row | Status | Phase |
|---|---|---|---|
| §2 never sells / takes title | `control/B2-01` | PARTIAL | 1 |
| §2 never issues titles, registrations, temp tags | `control/B2-02` | MISSING | 9 |
| §2 never releases a vehicle | `control/B2-03` | BROKEN | 9 |
| HTML S[11].dealer[0] dealer arranges financing | `control/S12D-01` | PARTIAL | 7 |
| HTML S[11].dealer[1] dealer submits to its lenders | `control/S12D-02` | MISSING | 7 |
| §30 rows 1–18 (12 responsibility rows) | `control/W30-01..12` | MISSING/PARTIAL/BROKEN | 2,2,4,3,5,5,6,6,7,8,8,9 |
| §35 scope constraint | `control/G35-01` | MISSING | 1 |
| HTML S[4].buyer[2] upgrade-window close | `control/P23-01` | BROKEN | 3 |

`W30-01` introduces the missing object round 1 named: a canonical
`lib/services/transaction/stage-responsibility.ts` registry keyed by the 21 spec stages, persisted as
`owner_role` — which makes `tests/T45` (the §34 passing condition) implementable for the first time.

### What round 2 independently re-verified as covered

- **§4 field lists** — all 74 named columns across §4.1, §4.3, §4.4, §4.5, §4.7 and §32 resolve to a
  schema or area row (token sweep: zero misses).
- **HTML `S[n].tables`** — all 47 named tables appear in a row, including the ones easiest to drop
  (`apollo_reveals`, `dealer_contact_profiles`, `dealer_availability`, `financing_audit_events`,
  `compliance_events`, `vehicle_request_due_diligence_checkpoints`).
- **§26** — 54 `E26-*` rows for 49 exceptions. **§27.1** — 77 `K27-*` rows for 76 register entries.
  **§27 dispatcher** — `jobs/A1a,A1b,A2,A3,A4,A5a,A5b,A6,A7a,A7b,A8` + `control/M27-01a..07`.
  **§28.3** — `T28-01..08`. **§28.2** — `schema/R77..R89` (13). **§29** — `control/G29-01..21` (21).
- **Stage structural lines** — every MD `Entry / Who does what / Recorded / Buyer sees / Exit / If it
  fails` line for all 21 stages resolves to a row (line-citation check with ±2 tolerance; the five
  initially flagged — L692, L770, L967, L969, L971 — all resolve to `deal-early/C1`, `deal-early/D14`
  and `pickup/R19.3/R19.4/R19.5`).
- **Enumerated checklists** — §16 readiness (13 items → `pickup/R16.2b..R16.14`), §20 completion
  (14 items → `pickup/R20.2..R20.15`), §21 obligations (5 → `pickup/R21.2..R21.6`),
  §22a rules (13 → `inventory/R22..R31`), §22a candidate model (6 → `inventory/R39..R41`,
  `offers/N1`, `sourcing/S6-03`), §34 branches (`tests/T14a..T38`), form walk (`tests/T39a/T39b`),
  passing condition (`tests/T45`).
- **Master-prompt rules** — rule 16 (`intake/R41`, `schema/R37b`), rule 17 (`intake/R3b`, `R42`),
  rule 10 (`schema/M1` and the §8.2 child-owned-FK note), rule 7 (`LEGACY_PATH_WRITE` counters appear
  in 11 of the 13 files, 36 rows), queue writer (`control/E26-00b`, Phase 2), dispatcher
  (`control/M27-01b`), direct-send build rule (`control/M27-02a/b`).

## GAPS (2)

The gap list is complete — 2 gaps found, far below the 60-item cap.

| # | spec_ref | Requirement | Closest area |
|---|---|---|---|
| 1 | MD §3 L139 ("One lineage, never broken") | **The orphan rule for every record class except payment.** "A payment, auction, offer, deal, contract, or pickup that cannot resolve its parent is an orphan: it raises an Operations exception and is never silently re-parented or duplicated into a parallel transaction." Only the *payment* half is covered (`jobs/C6`, `control/E26-09` — unroutable payment → Finance exception). No row asserts orphan detection for an auction, offer, deal, contract or pickup, no row defines an orphan `QueueItemType`, and nothing anywhere carries the negative rule "never silently re-parented or duplicated into a parallel transaction" (`rg orphan\|re-parent\|reparent` over the 13 tables → only `control/E26-00a`'s incidental "orphan enums" phrase, a different sense). `schema/M1` covers the *positive* half of §3 (a record locates its parent by stored reference) and is the only §3 row with a Phase. | schema (`M1` — stored-reference rule, Phase 1); control (`E26-00a` — the `queue_items` table shape) |
| 2 | MD §11 L703; HTML `S[10].dealer[0]` (`AutoLenis-Transaction-Flow.html:117`) | **Dealer-provided preliminary trade allowance at recap.** §11 requires the recap to carry "Dealer-provided preliminary trade allowance, when available", and the HTML makes it an explicit Stage 11 dealership action ("Supply the preliminary trade allowance and verified payoff where available"). `deal-early/C2b` enumerates the recap payload — "parties, rooftop, vehicle, itemised OTD, optional products, trade + payoff good-through, equity, down payment, path, amount financed, est. payment beside OTD, delivery, plan obligation" — and the *allowance* is not in that list; `deal-early/C2a`'s `deal_recaps` column list does not name it either. The only allowance row in the map is `pickup/R18.10` (`final_allowance_cents` / `verified_payoff_cents` at **handover**, Phase 9), which is a different figure at a different stage. `rg preliminary` over the 13 tables → 1 hit, in `offers/S1`, unrelated. | deal-early (`C2a`, `C2b` — recap store and payload, Phase 1/7); pickup (`R18.10` — final allowance, Phase 9) |

> Both gaps are of the same shape: a *bundled* requirement row that enumerates most of a list and
> silently drops one member, and a two-clause spec rule where one clause got a row and the other did
> not. They are the residue that a per-stage sweep cannot see, because the stage they belong to is
> otherwise fully covered.

## Contradictions between tables (11)

### Carried forward from round 1 and still open (7)

| # | Capability | Conflict |
|---|---|---|
| 1 | "Insurance verified or policy bound" as a release gate | `pickup/R16.8` = **PARTIAL**, Phase 9 vs `pickup/R20.10` = **ALREADY CORRECT**, Phase 9 — the same predicate carries two statuses inside one table |
| 2 | Prequalification expiry warning dispatched durably | `control/D1-13` = **BROKEN**, Phase 2 vs `jobs/G1` = **PARTIAL**, Phase 2 |
| 3 | `plan_snapshots` table + binding FKs | `schema/S20` = **MISSING**, Phase 1 ("Create model…") vs `payment/PAY-56a` = **BROKEN**, Phase 1 ("table and binding FKs exist") — a table cannot be both absent and present-but-wrong |
| 4 | DB-level five-candidate shortlist cap | `schema/I2` = **MISSING** vs `schema/S23` = **PARTIAL** vs `inventory/R43a` = **PARTIAL**, all Phase 1 |
| 5 | "Terminal failure raises an Operations exception" | `jobs/A6` and `control/C12` are the same change under two refs in two files, with no cross-reference |
| 6 | Cancellation payment treatment after a Premium upgrade | `control/C24-09b` = Phase 10 vs `payment/PAY-89` = Phase 3 |
| 7 | Lane 3 dealer application / approval | `intake/R35b` phases approval-creates-dealers/rooftops/agreement at **Phase 5**, while §8.1 assigns §8.1–8.3 (Lane 3) to **Phase 2** |

**Resolved since round 1:** the Premium upgrade-window close point (HTML "before accepting an offer"
vs MD §23.2 "when funding clears"). `control/P23-01` now records the divergence, cites the §2/D6
adjudication that Markdown governs, and requires the Stage 5 buyer copy to state the
funding-clearance rule.

### New in round 2 (4)

| # | Capability | Conflict |
|---|---|---|
| 8 | Number of Phase-1 enforcement objects | The master prompt and `IMPLEMENTATION-WORKFLOW.md` §8.2 name **three** Phase-1 enforcement objects (`schema/I1` one-open-request index, `schema/I2` five-candidate cap, `deal-early/A4a`+`schema/S14a` `credit_applications` freeze). `control/B2-01` declares itself "Phase 1 enforcement object (**4th**)" and `control/G35-01` adds a **5th** (`scope-guard.test.ts` plus a CI step run outside `working-directory: frontend`). §8.2's Phase-1 scope list was not amended, so the phase scope and the map disagree on what Phase 1 contains |
| 9 | Where §35 is enforced | `control/G35-01` assigns the §35 scope constraint to **Phase 1** (a build-failing gate that must exist before any phase runs), while §8.1 assigns §35 to **Phase 11 — Acceptance ("no new capability")**. A gate that lands in Phase 1 is a new capability in Phase 1 |
| 10 | Whether §2, §3 and §30 are scheduled at all | §8.1's phase table lists no phase for §2, §3 or §30 in its "Markdown sections" column, yet `control/B2-01..03` assign Phases 1/9/9 and `control/W30-01..12` assign Phases 2–9. The map schedules work the phase table does not know exists |
| 11 | Ref namespace is not unique across files | **173 ref ids are reused for different capabilities in different files** (`A1a A1b A2 A3 A4a A4b A5 A7a A7b A8 B1 B2 B3 … C1 C2 C3 …`). A cross-reference by bare ref is therefore ambiguous, and it has already produced a wrong pointer: `control/W30-01`'s required change says the registry lands "alongside the `queue_items` writer (**C2**)", but `control.table.md` has no `C2` row — `C2` resolves to `jobs.table.md`'s *payment reconciler*, and the queue writer is `control/E26-00b`. Contradiction 5 above is the same defect seen from the other side |

## Phase-order violations (11)

Dependency chain asserted by §8.1: 1 → 2 → 3 → (4 ← 1/2) → 5 ← 3,4 → 6 → 7 → 8 → 9 → 10 → 11.

### Carried forward from round 1 and still open (10)

| # | Row | Phase | Depends on a fact produced in |
|---|---|---|---|
| 1 | `deal-early/A4a` + `schema/S14a` — build-failing `credit_applications` freeze guard | 1 | Transaction-tree references removed at Phase 7 (`deal-early/A4b`, `A1b`, `A2`, `schema/S14b`) and Prisma relations/enum at Phase 10 (`deal-early/E12`) |
| 2 | `payment/PAY-59a` — Premium window-close predicate (funding cleared) | 3 | `funding_cleared_at` is written only by the Phase 8 clearance service (`contract/C-31`, `C-32a–e`) |
| 3 | `payment/PAY-76` — admin may open an upgrade after funding clears | 3 | Same Phase 8 clearance fact |
| 4 | `payment/PAY-94` — commission settles at Deal completion; reverses on cancel/refund/chargeback | 3 | Completion commits at Phase 9 (`pickup/R20.17b`); cancellation orchestration at Phase 10 (`control/C24-*`) |
| 5 | `intake/R27b` — same commission-settlement rule in another area | 3 | Phase 9 / Phase 10 |
| 6 | `payment/PAY-89` — Deal cancelled after Premium | 3 | Cancellation orchestration is Phase 10 (`control/C24-01..12`) |
| 7 | `payment/PAY-87` — Standard buyer asks for Premium "at financing or contract" | 3 | Financing checkpoint Phase 7 (`deal-early/D14`); contract request Phase 8 (`contract/C-02`) |
| 8 | `intake/R23` — Premium page writes plan on buyer **plus the Deal snapshot** | 3 | The Deal and its `plan_snapshot` are created at Phase 6 (`offers/S11a`, `S11b`) |
| 9 | `inventory/R37` — "the ceiling is enforced at offer validation, selection and contract request" | 4 | Offer validation and selection Phase 6 (`offers/B2`, `B12`); contract request Phase 8 (`contract/C-01`) |
| 10 | `schema/I1` — DB-level "one open request per buyer" partial unique index | 1 | Its precondition (owner cleanup of the 3 production buyers holding multiple open Vehicle Requests, `schema/R1a`, §13-D5/§5.6) is owner-gated and unscheduled; the index cannot be created while the violating rows exist. `tests/T44a` (Phase 1) inherits the same block |

### New in round 2 (1)

| # | Row | Phase | Depends on a fact produced in |
|---|---|---|---|
| 11 | `control/P23-01` — "implemented as a window with a real open **and close**"; the required change states the window "closes at funding clearance" | **3** | Funding clearance does not exist until Phase 8 — the row's own Current-implementation cell says so ("funding clearance does not exist (row `E26-43b`) so the close condition has nothing to fire on"). The window's *open* (the $99 settling) is a Phase 3 fact; its *close* is not. This is the same defect as violation 2 (`payment/PAY-59a`), now duplicated into the gap-fill row that was added to resolve the divergence |

**Secondary ordering note (carried forward):** `sourcing/25-02` places the identity-firewall lift at
Phase 7 while §8.1 assigns §25 to Phase 5. Not a dependency violation (the lift legitimately happens
at Stage 10), but the phase table and the map disagree about where §25 lands.

## Formatting defects (24 rows — not counted as gaps)

Un-escaped `|` inside a code span shifts the columns, so these rows carry content but present no
machine-readable Status/Phase. Round 1 listed 20:

`contract/C-18 (signing)`, `control/E26-32`, `deal-early/B3b`, `deal-early/B20`, `deal-early/C6`,
`deal-early/N8`, `inventory/R4a`, `inventory/R24b`, `offers/B9`, `offers/N5a`, `offers/N6`,
`pickup/R18.17`, `pickup/R19.2`, `pickup/R21.1a`, `pickup/N20`, `stages1-3/S3-10`,
`stages1-3/S3-16`, `stages1-3/S3-19a`, `stages1-3/S3-22b`, `tests/T53`.

**Four of the 19 new gap-fill rows have the same defect** — `control/B2-01` (Status/Phase land in
columns 9/12 instead of 6/9), `control/W30-01` (columns 9/13), `control/W30-09` and `control/W30-10`
(Phase in column 10). Their content is present and was read in full for this review, but a reader or
script scanning the Status/Phase columns will not see it. `control/W30-09` and `W30-10` in particular
hide the two heaviest Ops duties in §30 — "verify and record financing" and "record completion and
clearance" — behind shifted columns.

Two previously-noted rows still hide substantive Phase-1 wave amendments: `pickup/R19.2` ("**not in
Phase 1 list — add**" for the possession columns) and `pickup/R21.1a` (`evidence jsonb`,
`expected_date`, `temp_tag_expires_at` for `post_completion_obligations`).
