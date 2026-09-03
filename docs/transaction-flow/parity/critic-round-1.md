# Completeness critic — round 1

**Scope.** All 13 `parity/*.table.md` files (contract, control, deal-early, intake, inventory, jobs,
offers, payment, pickup, schema, sourcing, stages1-3, tests) checked item-by-item against
`docs/transaction-flow/AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` (read in full) and the data arrays in
`docs/transaction-flow/AutoLenis-Transaction-Flow.html` (LANES 423-485, S[] 487-753, INV 756-773,
QUAL/BUDGET 786-795, MONEY/MONEY_PANELS 797-806, PLAN_* 809-852, FIN_* 854-862, EXC 865-914,
DEALSTATES/SUPSTATES/TRANSITION 917-932, SAFE 934-940, BUILD 942-973, ACCEPT 975-979), plus the
master-prompt rules carried in `IMPLEMENTATION-WORKFLOW.md` §7/§8.0.

**Coverage test applied.** An inventory item is COVERED only where a table row exists carrying a
Requirement, a Current implementation, a Status, an Exact required change and a Phase. A passing
mention inside another row's prose was not accepted; a row that bundles an explicit enumerated list
(e.g. deal-early `C2b` for the §11 recap field list, schema `R19` for the §4.3 offer field list) was
accepted for every named member of that list.

## Counts

| Measure | Value |
|---|---|
| Requirement inventory (spec atoms) | **1,109** |
| Covered by a qualifying table row | **1,090** (98.3 %) |
| GAPS (no qualifying row) | **19** |
| Table rows parsed across the 13 files | 1,539 |
| Contradictions between tables | 8 |
| Phase-order violations | 10 |
| Rows with unparseable Status/Phase cells (formatting defect, not a gap) | 20 |

### Inventory derivation

| Block | Items | Note |
|---|---|---|
| §2 responsibility boundary | 33 | 15 performs + 9 dealership + 8 never + 1 `credit_applications` RETIRE |
| §3 lineage | 2 | stored-reference rule + orphan-exception rule |
| §4.1–4.7 field lists | 103 | 14 / 1 / 24 / 12 / 25 / 2 / 25 |
| §5 universal intake | 11 | 4 lanes + 7 rules |
| §6.1–6.5 | 35 | 17 surfaces (15 MD + Guest capture + Draft resume link) + 8 + 3 + 5 + 2 |
| §7–§9 | 17 | refinance 8 (incl. crossover + reconciliation key), 8.1–8.3 = 7, §9 = 2 |
| Part C stages 1–21 | 486 | 126 structural lines (21 × Entry/Who/Recorded/Buyer sees/Exit/If it fails) + 240 HTML actor bullets + ~120 lettered sub-section rules |
| §22 + §22.1 | 12 | 3 movements + 3 never-collects + 6 refund rules |
| §22a | 28 | 13 rules + 4 QUAL + 3 approved-amount + 2 ceilings + 6 candidate-model |
| §23.1–23.5 | 34 | 5 + 8 + 5 + 6 + 6 + 3 + 1 (measurement) |
| §24–§25 | 20 | 12 cancellation (both halves) + 3 + 5 |
| §26 | 49 | 48 MD rows + HTML EXC "Communication terminal failure" |
| §27 + §27.1 | 87 | 10 dispatcher requirements + no-page-request rule + 76 register rows |
| §28.1–28.3 | 40 | 18 states + historical mapping + 13 supporting groups + 8 controls |
| §29 / §30 / §32 / §33 | 89 | 20 + 12 + 26 + 31 |
| §34 + §35 | 50 | 4 scenarios + 28 "also exercise" branches + 16 form-walk + 1 passing condition + §35 |
| Master-prompt rules | 8 | rules 7/10/16/17, three Phase-1 enforcement objects, queue writer, dispatcher, direct-send build rule |
| **Total** | **1,109** | |

### What was verified as fully covered

- **§4 field lists**: every named column in §4.1 (14/14), §4.3 (24/24 — `vehicle_trim` carried inside
  schema `R19`'s `vehicle_year/make/model/trim` list), §4.4 (12/12), §4.5 (25/25), §4.7 (25/25) and
  every §32 object (26/26) resolves to a schema or area row with a Phase.
- **§26**: all 49 exceptions carried by `control` `E26-01…E26-48` plus `E26-00a/b`, `E26-50`, and the
  HTML-only "Communication terminal failure" at `control/C12` + `jobs/A6`.
- **§27.1**: all 76 register rows carried one-for-one by `control` `K27-1300…K27-1376`; all 10 §27
  dispatcher requirements carried by `C1`–`C14` + `M27-01a/b`, `M27-02a/b`.
- **§28.1** (18 states + historical mapping), **§28.2** (13 groups → `R77`–`R89`), **§28.3**
  (8 controls → `T28-*`, `N1`), **§29** (20 safeguards → `tests` `S1`–`S12`, `SAFE` rows).
- **§6.1**: 17 of 17 surfaces (`intake` `R9`–`R23` plus `S1`–`S32` route-level rows).
- **§22a**: 13 rules, 4 QUAL rows, 3 approved-amount rows, both radius ceilings (`R38`) and all 6
  candidate-model rows (`R39`–`R41`, `S7-23`).
- **§34**: all four scenarios (`T1`–`T13b`), every "also exercise" branch (`T14a`–`T38`), the
  form-walk list (`T39a/T39b`) and the passing condition (`T45`).
- **Master rules**: rule 16 (`intake/R41`, `schema/R37b`), rule 17 (`intake/R3b`, `R42`), rule 10
  (`schema` one-FK rows), rule 7 (carried as the `LEGACY_PATH_WRITE` counter — `intake/D4`,
  `sourcing/R24b`, `payment/PAY-24b`), the three Phase-1 enforcement objects (`schema/I1`, `schema/I2`,
  `deal-early/A4a` + `schema/S14a`), the queue writer (`control/E26-00b`), the dispatcher
  (`control/M27-01b`), the direct-send build rule (`control/M27-02a/b`).

## GAPS (19)

| # | spec_ref | Requirement | Closest area |
|---|---|---|---|
| 1 | MD §2 "AutoLenis never" bullet 1 (L82) | AutoLenis never sells or takes title to a vehicle — no row asserts or tests this boundary anywhere in the transaction tree | deal-early (`A1a`–`A4b` cover only the SSN / credit-application half of §2) |
| 2 | MD §2 "AutoLenis never" bullet 7 (L88) | AutoLenis never issues titles, registrations, or temporary tags | pickup (`R21.2` tracks the **dealership's** title/temp-tag obligation; no AutoLenis-never row) |
| 3 | MD §2 "AutoLenis never" bullet 8 (L89) | AutoLenis never releases a vehicle or substitutes for the dealership's delivery obligations | pickup (`R18.2`–`R18.13b` describe dealer release; the negative boundary is unstated) |
| 4 | HTML S[11].dealer[0] L637; MD §12 (L735) | Dealership arranges financing where the path is dealer-arranged — no dealer-portal surface, service or row | deal-early (`D5` covers only that `DEALER` exists as a `FinancingPath` value) |
| 5 | HTML S[11].dealer[1] L637 | Dealership submits to its lenders outside AutoLenis (the out-of-platform hand-off the dealer is told to perform) | deal-early (`D1` states "all financing happens outside AutoLenis" but assigns no dealer action) |
| 6 | MD §30 row 1 (L1467) | Stages 1–2 responsibility split (buyer register/verify/address; staff correct geocoding; system verify/geocode/dedupe) as a stored, displayed assignment | stages1-3 (`S1-*`, `S2-*` implement the behaviour but never record the responsible party) |
| 7 | MD §30 row 2 (L1468) | Stage 3 responsibility split (buyer apply/consent; staff manual+OFAC review and adverse action; system pull/screen/decide/notify) | stages1-3 (`S3-06`, `S3-17`) |
| 8 | MD §30 row 3 (L1469) | Stage 4 responsibility split (buyer defines/elects; system validates criteria and revalidates inventory) | inventory (`R1`–`R14`) |
| 9 | MD §30 row 4 (L1470) | Stage 5 responsibility split (buyer pays; staff work reconciliation exceptions; system charges once, unlocks, opens the upgrade window) | payment (`PAY-10a`–`PAY-39`) |
| 10 | MD §30 row 5 (L1471) | Stage 6 responsibility split (buyer authorises radius; staff approve limited auctions / manual sourcing; system searches bands) | sourcing (`S6-22`–`S6-27`) |
| 11 | MD §30 row 6 (L1472) | Stage 7 responsibility split (dealer receives invitation; staff replace bounced contacts; system launches/invites/reminds/closes) | sourcing (`S7-15`, `S7-21`) |
| 12 | MD §30 row 7 (L1473) | Stage 8 responsibility split (dealer submits/revises; staff review flagged offers; system validates/ranks/seals) | offers (`B1`–`B13`) |
| 13 | MD §30 row 8 (L1474) | Stage 9 responsibility split (buyer selects and accepts/declines Premium; staff assign the concierge on upgrade; system serialises the winner) | offers (`S3`, `S7`, `S8`) |
| 14 | MD §30 rows 9–11 (L1475-1477) | Stages 10–12 responsibility split (staff chase timeouts, verify outside winners, resolve recap disputes, **verify and record financing**) | deal-early (`B*`, `C*`, `D11`) |
| 15 | MD §30 rows 12–13 (L1478-1479) | Stages 13–14 responsibility split (staff review holds, escalate overdue, **record completion and clearance**) | contract (`C-31`, `C-58`) |
| 16 | MD §30 row 14 (L1480) | Stage 15 responsibility split (staff **verify** insurance; system tracks status and expiry) | contract (`C-46`) |
| 17 | MD §30 rows 15–18 (L1481-1484) | Stages 16–21 responsibility split (staff schedule after two counters, resolve blocks and discrepancies, escalate overdue obligations) | pickup (`R17.5`, `R18.19`, `R21.8`) |
| 18 | MD §35 (L1586) | "This document authorizes no parallel website, no replacement architecture, and no unrelated code changes" — the scope constraint has no row, no gate and no acceptance check | tests (§8.1 assigns §35 to Phase 11 but no `tests` row asserts it) |
| 19 | HTML S[4].buyer[2] L644 | "Optionally add the $400 Premium balance now, **or any time before accepting an offer**" — the HTML statement of the upgrade window has no row (and contradicts MD §23.2, see Contradiction 6) | payment (`PAY-13`, `PAY-59a` adopt the funding-clearance window only) |

> §30 accounts for 12 of the 19 gaps. Its per-stage responsible-party assignment is the source data
> for the §34 passing condition ("the buyer portal, the dealership portal and the Operations queue all
> display the same current checkpoint, **the same responsible party**, the same deadline and the same
> recovery action"). `tests/T45` asserts the parity but nothing defines, stores or derives the party
> being compared, so `T45` is currently unimplementable as written.

The gap list is complete — 19 gaps were found, below the 60-item cap.

## Contradictions between tables (8)

| # | Capability | Conflict |
|---|---|---|
| 1 | "Insurance verified or policy bound" as a release gate | `pickup/R16.8` = **PARTIAL**, Phase 9 vs `pickup/R20.10` = **ALREADY CORRECT**, Phase 9 — the same predicate carries two statuses inside one table |
| 2 | Prequalification expiry warning dispatched durably | `control/D1-13` = **BROKEN**, Phase 2 vs `jobs/G1` = **PARTIAL**, Phase 2 |
| 3 | `plan_snapshots` table + binding FKs | `schema/S20` = **MISSING**, Phase 1 ("new table (P1)") vs `payment/PAY-56a` = **BROKEN**, Phase 1 ("table and binding FKs exist") — a table cannot be both absent and present-but-wrong |
| 4 | DB-level five-candidate shortlist cap (Phase-1 enforcement object 2) | `schema/I2` = **MISSING** vs `schema/S23` = **PARTIAL** vs `inventory/R43a` = **PARTIAL**, all Phase 1 |
| 5 | "Terminal failure raises an Operations exception" | Duplicated as `jobs/A6` and `schema/C12` (same status, same phase, two owners) — one change, two rows, no cross-reference |
| 6 | Premium upgrade-window close point | HTML `S[4].buyer[2]` says "before accepting an offer"; MD §23.2 and `PLAN_UP[0]` say "when funding clears". `payment/PAY-59a` implements funding-clearance without recording the divergence; `tests/T58` records a *different* divergence (concierge assignment) and `tests/T37` records the *revert* point, not the window |
| 7 | Cancellation payment treatment after a Premium upgrade | `control/C24-09b` = Phase 10 ("payment treatment recorded explicitly") vs `payment/PAY-89` = Phase 3 ("Deal cancelled after Premium → cancellation and refund separate; $400 manual review") |
| 8 | Lane 3 dealer application / approval | `intake/R35b` phases "approval creates dealers, rooftops, agreement signature" at **Phase 5**, while `IMPLEMENTATION-WORKFLOW.md` §8.1 assigns §8.1–8.3 (Lane 3) to **Phase 2** |

## Phase-order violations (10)

Dependency chain asserted by §8.1: 1 → 2 → 3 → (4 ← 1/2) → 5 ← 3,4 → 6 → 7 → 8 → 9 → 10 → 11.

| # | Row | Phase | Depends on a fact produced in |
|---|---|---|---|
| 1 | `deal-early/A4a` + `schema/S14a` — build-failing `credit_applications` freeze guard | **1** | The transaction-tree references it must forbid are only removed at Phase 7 (`deal-early/A4b`, `A1b`, `A2`, `schema/S14b`) and the Prisma relations/enum at Phase 10 (`deal-early/E12`). A build-failing guard landed at Phase 1 cannot be green until Phase 7 |
| 2 | `payment/PAY-59a` — Premium window-close predicate (funding cleared) | **3** | `funding_cleared_at` is only written by the Phase 8 clearance service (`contract/C-31 (routes)`, `C-32a–e (service)`) |
| 3 | `payment/PAY-76` — admin may open an upgrade after funding clears, with audited approval | **3** | Same Phase 8 clearance fact |
| 4 | `payment/PAY-94` — commission settles at Deal completion; reverses on cancel/$99 refund/chargeback | **3** | Deal completion commits at Phase 9 (`pickup/R20.17b`); cancellation orchestration at Phase 10 (`control/C24-*`) |
| 5 | `intake/R27b` — same commission-settlement rule (duplicate of 4 in another area) | **3** | Phase 9 / Phase 10 |
| 6 | `payment/PAY-89` — Deal cancelled after Premium; cancellation and refund separate | **3** | Cancellation orchestration is Phase 10 (`control/C24-01…C24-12`) |
| 7 | `payment/PAY-87` — Standard buyer asks for Premium "at financing or contract" | **3** | Financing checkpoint is Phase 7 (`deal-early/D14`); contract request is Phase 8 (`contract/C-02`) |
| 8 | `intake/R23` — Premium page writes plan on buyer **plus the Deal snapshot** | **3** | The Deal (and its `plan_snapshot`) is created at Phase 6 (`offers/S11a`, `S11b`) |
| 9 | `inventory/R37` — filter generously; "the ceiling is enforced at offer validation, selection and contract request" | **4** | Offer validation and selection are Phase 6 (`offers/B2`, `B12`); contract request is Phase 8 (`contract/C-01`) |
| 10 | `schema/I1` — DB-level "one open request per buyer" partial unique index | **1** | Its own precondition (`§13-D2` cleanup of the 3 production buyers holding multiple open Vehicle Requests, cited in `schema/R1a`) is owner-gated and unscheduled; the index cannot be created while the violating rows exist |

Secondary note on ordering: `sourcing/25-02` places the identity-firewall lift at Phase 7 while §8.1
assigns §25 to Phase 5. Not a dependency violation (the lift legitimately happens at Stage 10) but the
phase table and the map disagree about where §25 lands.

## Formatting defects (20 rows — not counted as gaps)

These rows carry content but their Status and Phase cells are unreadable because an un-escaped `|`
inside a code span shifts the columns. Under a strict reading they do not present a machine-checkable
Status/Phase and should be repaired before the map is used as a work ledger:

`contract/C-18 (signing)`, `control/E26-32`, `deal-early/B3b`, `deal-early/B20`, `deal-early/C6`,
`deal-early/N8`, `inventory/R4a`, `inventory/R24b`, `offers/B9`, `offers/N5a`, `offers/N6`,
`pickup/R18.17`, `pickup/R19.2`, `pickup/R21.1a`, `pickup/N20`, `stages1-3/S3-10`, `stages1-3/S3-16`,
`stages1-3/S3-19a`, `stages1-3/S3-22b`, `tests/T53`.

Two of these hide substantive content: `pickup/R19.2`'s change text says the possession columns are
"**not in Phase 1 list — add**", and `pickup/R21.1a`'s says the `post_completion_obligations` wave
needs `evidence jsonb`, `expected_date`, `temp_tag_expires_at` added — both are Phase-1 wave
amendments that a reader scanning the Phase column will not see.
