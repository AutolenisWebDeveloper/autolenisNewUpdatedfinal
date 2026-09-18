# AutoLenis — Transaction Flow ACCEPTANCE REPORT

**Phase 11 · §34 / §35 / master §13 · branch `claude/txflow-11-acceptance` · base `b8becc05ffafdb0f14c5fa52e4bc07900ef312bb`**

Written for one reader: **someone deciding whether to put a real buyer through this.**

---

## 0. THE CENTRAL LIMIT — read this before any number below

**Production has never run a transaction.** Verified by the owner 2026-09-18 02:36 UTC:

| | |
|---|---|
| `deals` · `offers` · `sourcing_cases` · `pickups` · `obligations` | **0 rows each** |
| `queue_items` | 20 |
| `comms_outbox` | 17 — **zero sent, ever** |
| migration ledger | 123 rows / 121 applied / 2 rolled back / 0 stuck |

Every scenario in this report ran against **fixtures in a throwaway loopback PostgreSQL**, never against production, and this session held **no production credential of any kind** (`DATABASE_URL`, `DIRECT_URL`, `PROD_READONLY_URL`, Stripe, Resend, Twilio, MicroBilt, MarketCheck — all unset; confirmed by `scripts/preview-isolation-preflight.ts`, exit 0).

**What that establishes:** the code executes the flow.
**What it does not establish:** that a real buyer and a real dealership can transact. Those are different claims and this report does not merge them.

Three live-only facts, none fixable here, all of which independently block a real transaction today:

1. `RESEND_FROM_EMAIL` is unset in production, so the dispatcher has **never delivered a message**. Two outbox rows name it verbatim at attempt 5. Preflight at `lib/services/comms/comms-providers.ts:73`.
2. **14 send-safe dealer emails across 1,422 rooftops**, against §6c's five-rooftop minimum. **No real auction can launch.**
3. The MarketCheck sweep has failed daily since 2026-09-03 on the price side ("price 25 of 25"). The catalogue is **221 stale rows**.

---

## 1. VERDICT

| Row | Result |
|---|---|
| **SCENARIO A** | PASS through stage 5b of 16 · NOT PROVEN beyond |
| **SCENARIO B** | PASS through stage 5b of 16 · NOT PROVEN beyond |
| **SCENARIO C** | PASS through stage 5b of 16 · NOT PROVEN beyond |
| **SCENARIO D** | PASS through stage 5b of 16 · NOT PROVEN beyond |
| **§26 COVERAGE** | **7 of 55 exercised** (reached, not merely wired) |
| **§27.1 COVERAGE** | **20 of 79 enqueued** |
| **FORM WALK** | **18 of 18 walked**, 64/64 assertions green; 3 surfaces proven BROKEN |
| **CROSS-PORTAL PARITY** | **FAIL** — 2 of §34's 4 fields diverge, measured |
| **§13 RECONCILIATION** | **PASS WITH CONDITIONS** — the register was counted and the Phase-11-owned rows dispositioned; 31 rows carrying no explicit marker were **not** individually adjudicated, and that is stated rather than implied (§9) |
| **§35 SCOPE (G35-01)** | **FAIL** — the acceptance gate it mandates does not exist |
| **ASSERTION DISCRIMINATION** | 3 of 3 proven to fail on a reintroduced defect |
| **ACCEPTANCE VERDICT** | ## NOT ACCEPTED |

**NOT ACCEPTED** is the correct result, not a failure of the phase. §34 admits ACCEPTED only if *all four scenarios pass, every §26 code is exercised, the form walk is complete and the three portals agree.* Three of those four are not met, each for a measured reason stated below.

---

## 2. WHAT WAS PROVEN BY EXECUTION

Every command below ran in this session and its output was read. Nothing is claimed that was not run.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | **PASS** (exit 0; needs `--max-old-space-size=6144` in a 4-CPU sandbox) |
| Lint | `pnpm lint` | **PASS** — 0 errors, 133 warnings (unchanged from base; the new files add none) |
| Reachability guard | `pnpm test:coverage-check` | **PASS** — every test file reachable, every script chained or exempt |
| Migration chain | `prisma migrate deploy` on an empty DB | **PASS** — all 121 applied |
| Preview isolation | `scripts/preview-isolation-preflight.ts` | **PASS** (exit 0; 7 PASS, 3 NOT VERIFIED, each named) |
| Build | `pnpm build` | **PASS** — `BUILD_ID X88cK05DOxitFIxDnNwAN` |
| Acceptance suite | `pnpm test:scenarios` | 7 of 8 — the one red is finding **F4**, by design |
| Form walk | `playwright test form-walk` | **64 / 64 PASS** (desktop + mobile) |
| E2E estate | 13 spec files, mirroring CI's per-spec invocation | 12 green; `phase6` journey 1 environment-dependent (§7) |

The preflight is **discriminating**: it *failed* on its first run (step 8, empty schema) and passed only after the chain applied. A preflight that had passed either way would have proved nothing.

---

## 3. WHAT WAS PROVEN ONLY AGAINST FIXTURES — and what that does and does not establish

`tests/scenarios/spine.itest.ts` drives all four §34 scenarios through **one `runSpine()` function**. That satisfies §34's "same spine" requirement *structurally*: the four scenarios are four argument sets, so a divergent route is not something a reviewer must notice — it cannot be written without adding a branch, and every branch the function has is named for the §34 clause forcing it.

**Reached by all four (stages 1 → 5b of 16):**

| Stage | Proven | Through |
|---|---|---|
| 1 | identity resolution creates exactly one buyer | `resolveIdentity` |
| 2 | prequalification returns APPROVED | `initiatePrsequal` + `MICROBILT_SANDBOX` |
| 3 | Vehicle Request created, both entry forms | `attachOrCreateOpenRequest` |
| 3b | **request reaches payment before any sourcing spend** (§34 C/D) | `enterPaymentRequired` + a `sourcingCase` count of 0 |
| 4 | the $99 settles against the request | `applySettlementEffects` — the service the verified webhook calls |
| 5 | settlement opens **exactly one** sourcing case | asserted `=== 1`, not `>= 1` |
| 5b | **replaying settlement opens no second case** (§34 replay clause) | second `applySettlementEffects` |

**Not reached, and therefore NOT PROVEN by this suite:** stages 6–16 — sourcing ladder, auction launch, invitations, offers, ranking, close, selection, Deal lineage, reaffirmation, recap, financing checkpoints, contract, Contract Shield, signing, dealer execution, funding clearance, pickup, possession, completion, obligations.

### The distinction §34 actually turns on, stated plainly

**No test in this repository walks the spine continuously from intake to completion — not before this phase, and not after it.**

Every per-phase journey seeds its own pre-state. The clearest instance is `tests/e2e/phase9-pickup-journeys.spec.ts:131` (`seedReadyDeal`), which INSERTs a Deal already carrying `financingCompletedAt`, `fundingClearedAt`, `insuranceStatus: "VERIFIED"`, both recap confirmations and `feePaidAt`, then starts at `FUNDING_PENDING`. That is correct for a pickup-scoped journey. It is exactly what §34 forbids for an acceptance scenario, because those columns are the **output** of stages 12–15 — so the journey asserts a state the spine was never asked to produce.

This suite does not do that. Where it stops, it stops, and says so.

---

## 4. §26 EXCEPTION COVERAGE — 7 of 55 exercised

### The distinction that makes this number mean anything

Phase 10 built a table-driven gate (`lib/services/operations/__tests__/exception-register-completeness.test.ts`) proving **every registered code HAS a raise site**. It ran here: **8/8 green**, and it is genuinely vacuity-proof — five non-emptiness floors plus two mutation tests.

It does **not** prove anything REACHES those sites, and §8.1j says so in its own words: `PICKUP_MISSED` counted as satisfied throughout Phase 9 while its only raiser, `flagSuspectedNoShows`, had **no caller anywhere**.

So this phase measures the other claim. After driving the suites, `SELECT DISTINCT exception_code FROM queue_items` — a row exists only because a production raise site wrote it.

| Claim | Number |
|---|---|
| Codes catalogued | 58 |
| Codes with a raise site (the Phase-10 gate) | **55** |
| Codes deliberately discharged, no raise site | 3 |
| **Codes actually REACHED in this run** | **7** |

Reached: `CANCELLATION_CLEANUP_INCOMPLETE`, `COMMS_GUARD_UNAVAILABLE`, `COMMS_NO_DELIVERABLE_CHANNEL`, `DEAL_FROZEN_PENDING_RELEASE`, `DELIVERY_DISCREPANCY_REPORTED`, `PAYMENT_FAILURE`, `POST_COMPLETION_OBLIGATION_OVERDUE`.

**Methodological caveat, stated rather than buried: 7 is a LOWER BOUND.** Several E2E specs delete their own rows in teardown, so a code raised and then cleaned up is not counted. Measuring the true reached-count needs capture at raise time, which this phase did not build. The honest reading is: *at most 7 of 55 §26 codes are demonstrably reachable end-to-end today, and the real figure is somewhere between 7 and 55 with no evidence pinning it higher.*

The three discharged codes, with no raise site by decision:
`NO_IN_RADIUS_INVENTORY` and `NO_STORED_LOCATION_ON_INVENTORY` (BEHAVIOUR, proven by `catalogue-gating.test.ts`), and `TRADE_APPRAISAL_CHANGED_AT_HANDOVER` (UNBUILT, parity rows R18.10/R18.17, owned by Phase 9).

**§34 requires every §26 exception to be exercised. 7 of 55 does not meet it.**

---

## 5. §27.1 COMMUNICATIONS COVERAGE — 20 of 79 enqueued

Measured the same way: `SELECT DISTINCT template_key FROM comms_outbox`, under `COMMS_TRANSPORT=capture`.

Enqueued: `contract_overdue`, `contract_requested`, `deal_completed`, `draft_recovery_1..4`, `guest_capture_claim`, `insurance_required`, `pickup_appointment_reminder_24h`, `pickup_possession_confirmed`, `pickup_vehicle_released`, `post_completion_obligation_overdue_buyer`, `post_completion_obligation_overdue_dealer`, `prequal_approved`, `recap_ready`, `registered_claim_prompt`, `verification_reminder_1h/24h/72h`.

The register holds **79 keys**; §27.1's table holds **77 rows**. Those count different units and both are right — several doc rows fan out to multiple keys (the six-touch deposit sequence, the four-touch draft recovery), and several keys come from other sections.

---

## 6. FORM WALK — 18 of 18 walked, and 3 are broken

`tests/e2e/form-walk.spec.ts`, enumerated from the codebase (104 submitting surfaces, 41 public/token-gated) rather than from §34's illustrative list. **64/64 assertions green across desktop and mobile.**

Three layers, reported separately because conflating them is how a broken surface reads as a working one:

- **RENDER** — a real browser opens the page and the form mounts. 11 public pages × 2 viewports.
- **TRANSPORT** — a real POST to the receiving handler through the running server. A **400 is a reached handler**; a **403 `CSRF_INVALID` never reached one**.
- **LANDING** — the database is read. §34's actual requirement.

### Landing results

| Lane | Landed | Attribution | ZIP | Consent |
|---|---|---|---|---|
| Lane 1 — buy | `BuyerOpportunity` ✓ | `utm_source`, `source_url`, `consent_surface` ✓ | ✓ `73301` | ✓ `consentSms` recorded as supplied |
| Lane 2 — refinance | `RefinanceApplication` ✓ | partial (static `source`, no UTM) | n/a (state only) | ✓ `consentGiven` required `z.literal(true)` |
| Lane 3 — supply | `DealerApplication` ✓ | ✓ | ✓ `78705` | ⚠ stored as free text in `notes` |

### The §34 duplicate rule — PASSES, and it was genuinely tested

Four identical Lane 1 submissions produced **16 `buyer_opportunities` rows from 4 distinct addresses, and exactly 4 users, 4 buyers, 4 Vehicle Requests — one open request each.** The opportunity store accumulates each attempt; identity and the open request do not multiply. That is the rule holding under the condition that would break it.

---

## 7. CROSS-PORTAL PARITY — FAIL, measured

§34's pass condition, verbatim: *"the buyer portal, the dealership portal, and the Operations queue all display the same current checkpoint, the same responsible party, the same deadline, and the same recovery action."*

Two claims, separated because they are not the same claim:

**IDENTITY parity — PASSES.** All three surfaces are fed by one `queue_items` row. Same code, same owner enum, same deadline instant. `test 1` green.

**DISPLAY parity — FAILS.** Measured, with the deadline as a control (if the control disagreed, the comparison itself would be broken and the rest would mean nothing):

| §34 field | Operations queue renders | Shared projection renders | Agree? |
|---|---|---|---|
| current checkpoint | `CONTRACT_OVERDUE_FROM_DEALER` | `Contract overdue from dealer` | **NO** |
| responsible party | `OPERATIONS` | `Operations` | **NO** |
| deadline | same instant | same instant | yes *(control)* |
| recovery action | same text | same text | yes |

An operator and a buyer comparing notes on the phone are reading a raw enum against a human sentence.

**Root cause (F4):** `app/admin/queues/page.tsx` fetches `/api/admin/queues/[queueType]` → `admin-queue.service.ts` → `listOpen`, then extracts raw columns itself in `exceptionFields()` (`page.tsx:53-66`). It never imports `exception-lineage.service`. `audience: "OPS"` has **no production caller** — it appears only in the module and its own unit test.

§8.1j (L3080-3084) records "Buyer panel, dealer notice and the existing Ops queue now read one projection", and `components/buyer/TransactionExceptionPanel.tsx:20` repeats it in a comment. **Two of three do. The claim is wrong for the third, and the comment is wrong either way.**

---

## 8. DEFECTS FOUND AND **NOT** FIXED

Phase 11 adds no capability (§8.2; C4 at workflow L766). Every item below is reported with `file:line` and a severity, and **none is fixed**. Two were found before a line of test code was written; five were found by execution.

### F1 — `contract_approved` is discharged by an unintended literal match · **HIGH**

*This is the twelfth instance of this programme's recurring defect, and it is inside the gate Phase 10 built to prevent the eleventh.*

- `PHASE_8_TEMPLATES.CONTRACT_APPROVED = "contract_approved"` — `lib/services/comms/state-recheck-registry.ts:992`.
- The constant's only reference is `state-recheck-registry.ts:1154` — **inside the one file the completeness scan excludes**.
- The only occurrence of the literal in an enqueueing file is `lib/services/esign/open-signing.service.ts:157`, as **`triggerEvent:`** — while `templateKey:` on that same call is `SIGNATURE_REQUIRED` (`:158`).
- `lib/crm/email-dispatch-policy.ts:38` also holds the literal but contains **zero** enqueue calls, so the file filter excludes it.

The gate reports the row wired. **Nothing enqueues it.** The message is sent by `sendContractApprovedEmail` (`lib/services/email/resend.service.ts:1027`) on the **direct Resend rail**, from `contract-shield.service.ts:703` and `app/api/admin/contract-shield/[reviewId]/route.ts:154`.

**What it costs:** no durable retry, no state recheck, no suppression check, no cancel-by-key — on *contract approved*, a transaction-critical message. `MAX_LEDGERED_ROWS = 1` (`register-discharge-ledger.ts:105`) pins `prequal_declined` as the **only** acknowledged direct-rail row, so this is a second one nobody knows about.

**Correction owed to the document:** §8.3's "all 77 rows wired" is **one row weaker than asserted**.

**The implied check, for whoever fixes this:** *a completeness gate that matches on a string must prove the match is the one it means, not merely that the string occurs.* Matching a bare literal cannot distinguish a `templateKey` from a `triggerEvent` that happens to share its value.

### F2a — three public POST surfaces are unreachable · **HIGH**

Proven against the running application, not asserted from source:

```
POST /api/leads/lead-magnet      (/guide)                      → HTTP 403 CSRF_INVALID
POST /api/tools/dealer-fee-lead  (/tools/dealer-fee-calculator) → HTTP 403 CSRF_INVALID
POST /api/esign/invited/<token>  (co-buyer signing ceremony)    → HTTP 403 CSRF_INVALID
POST /api/public/contact         (CONTROL — skip-listed)        → HTTP 400 VALIDATION_ERROR
```

The control reaches its handler, so the 403s are the CSRF gate specifically. The third **is §34 Scenario B's "co-buyer signs"**.

### F2b — the CSRF mechanism has no token issuer · **HIGH — and this is the one that matters**

`proxy.ts:318-325` is a double-submit check: `csrfHeader === csrfCookie`, no signature, no session binding. Repo-wide, `X-CSRF-Token` and `csrf-token` appear **only at `proxy.ts:318-319`**. Nothing issues a token, so the first-party client never sends one.

Proven by construction:

```
no token         → 403      (the gate refuses)
matching pair    → 400      (the handler is reached — supplied by the caller itself)
mismatched pair  → 403      (the comparison is real)
```

**The mechanism is dead.** It blocks only legitimate traffic on the three non-skip-listed prefixes. Adding those prefixes to the skip-list would widen a dead control and look like a fix; the defect is the missing issuer.

*Not overclaimed:* a cross-site attacker generally cannot set the cookie for this origin, and `proxy.ts:55-59` records that session auth and SameSite are what actually mitigate CSRF on the skip-listed prefixes.

### F3 — G35-01's root-level CI step does not exist · **MEDIUM** — and it is §35's own acceptance item

G35-01 (workflow L7458) records AS BUILT "a CI step run **outside** `working-directory: frontend`", acceptance criterion "CI step runs at the repository root". `lib/__tests__/scope-guard.test.ts` is reachable only through `pnpm test:security` → `test:matrix` → the `ci` job, which sets `working-directory: frontend` at `.github/workflows/ci.yml:16`. `grep -rn scope .github/workflows/` returns nothing. The one job without that default (`phase1-proof`) runs psql only.

**A second HTTP surface remains invisible to CI — the exact hazard G35-01 exists to close, and `backend/server.py:1-97` is that surface.**

### F4 — cross-portal parity is 2 of 3 · **HIGH** (it is §34's pass condition)

Root cause and measurement in §7 above. `audience: "OPS"` has no production caller.

### F5 — the scope guard is stale and has no non-vacuity floor · **MEDIUM**

`lib/__tests__/scope-guard.test.ts:45` reads `CURRENT_PHASE = 8`; `PHASE_SCOPE` keys stop at 8; `allowed()` loops `p = 2 … CURRENT_PHASE` (`:207`). **Phases 9 and 10 were never declared to the guard.** It imports only `read` from `source-scan` — never `assertScanned`, unlike its sibling `role-boundary-frozen.test.ts:81,161` — and `dirsIn()` returns `[]` for a missing path (`:193`), so four of its seven tests pass on an empty scan.

The file's own comment at `:113` records this happening once before at `CURRENT_PHASE = 4`. **Twice is a pattern, not an oversight.**

### F6 — Phase 3's AS BUILT record is the only one not in the workflow document · **LOW (documentation)**

**Corrected during this phase's own review — the first statement of this finding was overstated and is retracted here rather than quietly amended.**

The claim was "Phase 3 has no AS BUILT record". That is wrong. Phase 3 has a substantial one: `docs/transaction-flow/phase-3-proof/AS-BUILT.md` (204 lines) with `CAPABILITY-MAP.md` (70 lines) beside it — including the §13-D52 sequencing guard that keeps the legacy path default-on until Phase 5.

The accurate finding is narrower and still real:

- Every other phase's AS BUILT record lives in `IMPLEMENTATION-WORKFLOW.md` (§8.1a, §8.1e–§8.1j, and `#### Phase 2 / Phase 4 — AS BUILT` at L4132 / L4957). **Phase 3's is the only one that does not**, and it is the only `phase-*-proof/AS-BUILT.md` in the tree.
- **§8.1 row 3 carries no AS BUILT marker**, unlike rows 6, 7 and 8.
- So a reader of the workflow document alone concludes Phase 3 has no record. That is exactly what happened to this phase's own STOP 1 analysis, and to the framing "§8.1a through §8.1j are the AS BUILT records for Phases 1 through 10" — §8.1b, §8.1c and §8.1d do not exist.

**Disposition:** §8.1k now points at the existing record and §8.1 row 3 is marked, rather than a duplicate record being written. A second, divergent account of the same phase would be worse than the gap.

### F7 — `INVENTORY_SELECTION` has no production writer · **MEDIUM** — and it caught this report's own first draft

`VehicleRequestEntryType` carries exactly the two labels §34's column 2 needs (`schema.prisma:6925-6928`). Repo-wide, `entryType` is written **only** as the literal `"CUSTOM_REQUEST"` — `app/api/public/request-vehicle/route.ts:245` and `:493`, plus the pass-through at `unified-buyer-intake.service.ts:668`. `INVENTORY_SELECTION` has **zero** writers. `vehicle_requests.inventory_item_id` has **zero** writers.

So §34's "Selected inventory" entry form **is not recorded on the Vehicle Request at all**. The only mechanical expression of it is the shortlist → `AuctionVehicle` candidate set, which `submitOffer` then requires an offer to name (`offer.service.ts:362-391`).

**Disclosed because it is the point of this phase:** the first draft of `spine.itest.ts` set `entryType: "INVENTORY_SELECTION"` for scenarios A and B. That would have been this programme's recurring defect committed *inside the phase built to measure it* — a fixture asserting a column value the system cannot produce, and a green scenario proving nothing about the entry form. It was caught by interrogating the fixture shape, corrected, and is now asserted (`spine.itest.ts`, stage 3) so that adding a writer retires the finding deliberately rather than letting it go stale.

### F8 — `trade_in_submissions.verified_payoff_cents` has no writer, and it gates Scenario D's last clause · **HIGH**

13 occurrences in production code. **All reads. Zero writes** (outside the migration that adds the column).

`lib/services/pickup/pickup-completion.service.ts:559` opens the `TRADE_PAYOFF` post-completion obligation **only** when `verifiedPayoffCents !== null && > 0` — with **no fallback**, unlike `funding-clearance.service.ts:206`, `contract-comparison.service.ts:331` and `deal-recap.service.ts:317`, which all fall back to `loanBalanceCents`.

**So the `TRADE_PAYOFF` obligation can never open in production.** §34 Scenario D requires *"a trade carrying a lien … obligations tracked after completion"*. That clause is unreachable.

Adjacent, same family: `final_allowance_cents`, `preliminary_allowance_cents`, `valued_at`, `bringing_to_pickup` also have no writer (the first two are already acknowledged at `exception-catalogue.ts:138-140`), and `OBLIGATION_TYPES.DOCUMENT_CORRECTION` (`post-completion-obligations.service.ts:67-70`) has **no opener** — the four `openObligation` call sites are `pickup-completion.service.ts:534, 548, 560, 563` and none names it.

### F9 — the auction path never advances the Vehicle Request to `DEAL_CREATED` · **MEDIUM**

`commitOfferSelection` (`lib/services/deal/select-offer.service.ts`) **reads** the Vehicle Request (`:156-164`) and never updates its status. The only writer of `VehicleRequestStatus.DEAL_CREATED` is a **manual admin action**, `app/api/admin/requests/[requestId]/route.ts:47`.

**Consequence:** `lib/services/vehicle-request/vehicle-request.service.ts:23` treats `DEAL_CREATED` as not-open. After a real auction-driven Deal the buyer's request therefore still counts as **OPEN**, which interacts directly with Phase 1's one-open-request partial unique index.

### F10 — one endpoint accepts SMS consent under two different key names · **LOW**

`POST /api/public/request-vehicle` takes `consentSms` (camelCase) on the draft branch (`route.ts:196`) and `consent_sms` (snake_case) on the full branch (`:149`). Both are live and correct for their current callers, so nothing is broken today — but a client sending the wrong casing for its branch loses consent silently, with no error.

*Adjacent, pre-existing, not introduced here:* `components/seo/landing/VehicleRequestForm.tsx:129` hard-codes `consent_sms: true` with **no checkbox** — consent asserted on the visitor's behalf. TCPA-relevant. (`components/public/HeroIntakeForm.tsx` by contrast has no SMS control and the server fails closed to `sms: false` at `route.ts:255` — correct.)

### F11 — CLAUDE.md's measured counts have drifted again · **LOW**

CLAUDE.md states 75 `test:*` scripts, a 67-segment `test:all`, five CI jobs. Measured today: **78** `test:*` scripts plus bare `test`, a **70**-segment chain, five jobs. The file already carries a 2026-09-08 note correcting an earlier drift of the same numbers.

---

## 9. MASTER §13 RECONCILIATION

The register holds **61 decisions (D1–D61)**. Dispositions, **counted mechanically** over the register
rows rather than estimated — the method is stated so the figures are reproducible, and because a
confident-looking breakdown nobody counted is exactly the kind of claim this phase exists to catch:

| Measured | Count |
|---|---|
| Master §13 rows (`D1`–`D61`, typed ACTION / DECISION / ACKNOWLEDGEMENT) | **61** |
| Rows carrying an explicit **RULED** marker | **30** |
| Rows carrying an explicit **AS BUILT** marker (all 30 ⊇ these 10) | **10** |
| Rows carrying neither marker | **31** |

**What "neither marker" does and does not mean.** It is a count of the literal markers, not of
unresolved decisions. Several rows in that set carry their resolution in prose without the marker —
`D50` ("ANSWERED BY THE PHASE 7 BUILD"), `D51` ("RESOLVED WITHOUT READING THE SECRET"), `D52` and `D53`
(both "Registered" with an evidence-supported default). A decision-by-decision adjudication of those 31
was **not** performed by this phase and is not claimed. What was verified is that **none of the 31
blocks Phase 11**, and that the rows Phase 11 owns are dispositioned below.

| Phase-11-owned | Disposition |
|---|---|
| **D15** | **RULED CLOSED-UNVERIFIED** by this phase — §10 |

**Findings inside the register**

- **§13-D15 — ACTION, Phase 11. RULED CLOSED-UNVERIFIED (owner, this phase).** Full table in §10.
- **§13-D29** — `deals.dealer_executed_contract_id` **PRESENT** (`schema.prisma:803`, FK to `ContractVersion`); `dealer_executed_at` correctly **absent**, matching the amended ruling. Release gate `SIGNED → DEALER_EXECUTED → FUNDING_PENDING` present with no bypass (`deal.service.ts:41,91`).
- **§13-D59 / D60 / D61** — registered late, each carrying its own correction; code matches.
- **U-4** (workflow L6928, Phase 11): `cron_job_logs` rows for the contract-shield and e-sign crons — **NOT VERIFIED**, needs a production read-only query (§10).
- **U-3** (L6927): `contract_scan_rules` count by `rule_type` — **NOT VERIFIED**, same reason.
- **R16.15** (L6987) and **R20.18** (L7066): both `[NEW]` markers were to be flipped once their phases landed. Both statements are now false of the code — Phase 9/10 built what they said did not exist — so both `[NEW]` markers are **retired** by this phase.
- **A8** (L7625): `comms_outbox` production row count — **17, zero sent ever** (§0).
- **T54** (L7543): see §11.

---

## 10. §13-D15 — REAL PROVIDER DELIVERY VERIFICATION · **CLOSED-UNVERIFIED**

Owner ruling, this phase. Recorded in full because the table is more useful than the decision: it tells whoever revisits this exactly what they are buying.

| Component | What a real verification needs | What the answer would change | Possible without production? |
|---|---|---|---|
| **Resend** | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` set, verified sending domain, a real recipient, authorisation to send | Distinguishes "enqueued" from "delivered". `RESEND_FROM_EMAIL` is unset in production, so `assertEmailTransportConfigured` (`comms-providers.ts:73`) throws before `dispatched_at` — the reason 17 outbox rows have never sent | **No.** Adapter shaping, retry/backoff and the capture rail are verifiable here; delivery is not |
| **Twilio** | A2P-registered number, credentials, a real handset, TCPA consent for that number | Same for the SMS lanes | **No** |
| **Stripe settlement** | Live-mode key and a real charge settling | **Two different claims, not merged:** test mode proves the **webhook and reconciliation path**; only live mode proves **settlement** | **Partly** — the webhook/reconciliation half is provable in test mode; settlement is not |
| **MicroBilt returns** | A real bureau pull on a real consumer with permissible purpose and FCRA consent | Separates "adapter maps a response" from "a real decision". **Cannot be done on a synthetic buyer at all** — a real pull on a fabricated person is an FCRA problem, not a policy preference | **No**, and not recommended in production either |
| **E-sign evidence** | `ESIGN_EXECUTED_ARTIFACT_ENABLED=true` (compliance-gated, §13-D4) + a real DocuSign envelope completing + the artifact stored and hashed | Separates "envelope created" from §14d's stored fully-executed copy | **No** — the flag's default-off is an attorney sign-off, not a schema state |
| **MarketCheck** | Production key against the real plan | Separates "adapter parses" from "catalogue is fresh". Directly blocks §6c's five-rooftop minimum | **No**; two items also UNVERIFIED for contractual reasons (§13-D8) |

**Why CLOSED-UNVERIFIED rather than attempted:** four of the six cannot be verified without doing exactly what the CRITICAL ENVIRONMENT BOUNDARY forbids — creating real deals, sending real dealer mail, charging real cards, and pulling a real credit report on a person who does not exist. Three of the six are already blocked by measured facts (§0).

---

## 11. §35 SCOPE CONSTRAINT (G35-01) — **FAIL**

§35 L1586: *"This document authorizes no parallel website, no replacement architecture, and no unrelated code changes."*

Assessed against what the ten phases actually changed:

| Clause | Assessment |
|---|---|
| **no parallel website** | **NOT ENFORCED.** `backend/server.py:1-97` — a FastAPI proxy forwarding `/api/*` from port 8001 to Next.js — still exists, and every CI job is scoped to `working-directory: frontend`, so it is invisible to CI. `scope-guard.test.ts` asserts exactly one `next.config.*` and caps the frozen trees, but **it never runs at the repository root** (F3). |
| **no replacement architecture** | **HOLDS.** Every phase extended existing services. The one place a new layer was attempted (`lib/db/`) was refused by the guard and does not exist. |
| **no unrelated code changes** | **PARTIALLY ENFORCED.** The per-phase scope manifest exists, but `CURRENT_PHASE = 8` — Phases 9 and 10 were never declared to it (F5), so two phases of change passed unchecked. They happened to add no new route family, service directory, top-level `lib/` directory or `@@map`'d table, which is luck rather than compliance. |

**G35-01's own acceptance criterion — "the acceptance-report line exists and is checked in Phase 11" — is satisfied by this section. Its build half is not: the CI step it records as built does not exist.**

---

## 12. T54 — MASTER §11 DOES NOT EXIST · a document defect

T54 (workflow L7543) is OWNER-GATED on "owner supplies master §11 text". Established before marking anything N/A:

- **The workflow's own `## §11` EXISTS** — `IMPLEMENTATION-WORKFLOW.md:7773`, "Coverage reconciliation — no requirement disappears between the specification and the plan". It is machine-generated by `frontend/scripts/parity-ledger.mjs` over 1,572 ledger rows across 13 parity tables, and `pnpm test:parity-ledger` gates it (green in this run, suite 68). **T54's "Current state: no `## §11` heading" is STALE.**
- **Master §11 does not exist, and cannot.** `AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` runs `## 0.` → `## 9.`, then **Stage 1 … Stage 21** (a different numbering series), then `## 22.`. `grep -nE '^## (1[0-9]|2[01])\.'` returns **nothing**: sections 10 through 21 do not exist in that document at all.

**T54 asks the owner to supply text for a section number that is not part of the master document's numbering.** That is a document defect, not an owner obligation. The acceptance criterion that *is* checkable ("`## §11` present, and `ACCEPTANCE-REPORT.md` cites it") is **SATISFIED** — cited here.

---

## 13. PREDICTED BEFORE THE RUN vs WHAT HAPPENED

Stated at STOP 1, before a line of test code was written, so a green result could not quietly absorb them and a red one could not read as a surprise.

| # | Predicted | Actual |
|---|---|---|
| 1 | Scenario B's co-buyer signing leg fails (CSRF) | **CONFIRMED** — 403 proven against the running app (F2a) |
| 2 | §26 coverage will not reach 55 of 55 | **CONFIRMED** — 7 of 55 reached |
| 3 | §27.1 will not reach 79 | **CONFIRMED** — 20 of 79 |
| 4 | Cross-portal parity is at risk | **CONFIRMED** — 2 of 4 fields diverge, measured (F4) |
| 5 | Form walk will not be 104 of 104 in the browser | **CONFIRMED** — 18 public surfaces walked; 63 authenticated surfaces not browser-reachable |
| 6 | BROWSER-VERIFIED will not cover the buyer portal | **CONFIRMED** — Supabase Auth; Ops and dealer are reachable, buyer is not |

Not predicted, found by execution: **F7** (and it indicted this report's own first draft), **F8**, **F9**, **F10**.

---

## 14. LIVE-ONLY / UNVERIFIED — with what each needs

| Item | Needs |
|---|---|
| Resend / Twilio / Stripe settlement / MicroBilt / e-sign artifact / MarketCheck (§13-D15) | §10's table |
| `cron_job_logs` rows for the contract-shield and e-sign crons (U-4) | an owner-run read-only production query |
| `contract_scan_rules` count by `rule_type` (U-3) | same |
| Production background-table row counts; presence of `outreach_touch_schedule` / `refinance_outreach_schedule` (A8, H8) | same |
| Stripe `livemode=false` assertion (preflight step 4) | a test-mode key + egress to `api.stripe.com` |
| Canary absent from production (preflight step 9) | a read-only production credential, under CLAUDE.md's per-run protocol |
| Buyer-portal rendering, and any authenticated buyer journey | a Supabase preview project. **NOT VERIFIED is the correct answer here, not a failure** |
| Spine stages 6–16 end-to-end from intake | dealer rooftops with coverage, and the stages this phase did not reach |
| `tests/e2e/phase6-offer-journeys.spec.ts` journey 1 | environment-dependent: fails here in both invocation modes on `Cannot find module '@/lib/prisma'`, raised from the dynamic `await import("./dealer-reaffirmation.service")` at `lib/services/deal/deal-creation.ts:117`. **CI run 35303431668 on this exact SHA reports the step as success**, so this is recorded as NOT VERIFIED locally, not as a defect. The fragility is real: a dynamic import is the one form Playwright's transform cannot resolve ahead of time |

---

## 15. WHAT THIS REPORT WOULD TELL A DECISION-MAKER

**Do not put a real buyer through this yet**, and the reason is not any single defect:

1. **No real transaction can start.** 14 send-safe dealer emails against a five-rooftop minimum, and a dispatcher that has never delivered a message.
2. **§34's own acceptance bar is not met.** 7 of 55 exceptions reached, three portals that do not agree on two of four fields, and a co-buyer signing surface that returns 403.
3. **Two clauses of §34 are unreachable in code**, not merely untested: Scenario D's post-completion trade obligation (F8) and Scenario A/B's entry form (F7).
4. **The programme's own scope gate has never run where it was designed to run** (F3), and has not seen the last two phases (F5).

What *is* solid: the migration chain applies cleanly from empty, the money path is idempotent under replay, intake does not duplicate a buyer or an open request under four identical submissions, typecheck and lint are clean, and the Phase-10 completeness gates are genuinely non-vacuous. The foundation holds. The transaction has not been run.

---

## 16. DOCUMENT HASHES

| File | At Phase 11 opening | At Phase 11 close |
|---|---|---|
| `IMPLEMENTATION-WORKFLOW.md` | `e06d185e5173072fc8a8962bae7586387b7d03577b340f83b1fced3100e2da79` (MATCH) | `993ca3702ae7435aa65119f59466e965343e41001661af1f3a387b0471b43a8b` |
| `AUTOLENIS-COMPLETE-TRANSACTION-FLOW.md` | `714569988f838ecde8909204093453d075b9402fb33a8203b98cfcbf758eab90` (MATCH) | **unchanged** |
| `AutoLenis-Transaction-Flow.html` | `8c268f9102fc9dc021f4a58c50ac9e179b24a5509dd09ca27a1a746c9209ff89` (MATCH) | **unchanged** |

All three matched the instructed values at the opening. The workflow's hash moves because §8.1k, the
the Phase 3 pointer (F6) and the §8.3 / §8.1 row-3 and row-11 corrections are written into it. **The two
governing documents are not edited by this phase** — acceptance measures the implementation against the
specification; it does not amend the specification.

## 17. MIGRATIONS

**N/A — and proven, not asserted.** `git diff --name-only origin/main -- frontend/prisma/` is empty,
`frontend/prisma/schema.prisma` is byte-identical to `main`, and the migration directory count is
**121**, unchanged. The full chain was applied to an empty database in this session and all 121
migrations succeeded. No migration was authored, and none was applied to production — this session held
no production credential.
