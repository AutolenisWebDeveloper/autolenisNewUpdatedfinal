---
name: autolenis-buyer-journey
description: >-
  Authoritative guide for the AutoLenis buyer-side journey — the fact-derived
  stage machine, prequalification, vehicle requests, the standalone
  vehicle-request module, deposits, insurance, nudges, and buyer nav gating.
  Use this skill when working on anything under app/buyer, app/api/buyer,
  lib/services/buyer, lib/services/vehicle-request, lib/services/prequal,
  lib/services/insurance, or lib/services/nudge; when touching the buyer journey
  stages, prequal decisions, VehicleRequestStatus, buyer onboarding, buyer
  dashboard/sidebar gating, or the $99 refundable deposit; or when a task
  mentions "buyer flow", "prequal", "MicroBilt", "vehicle request", "OFAC gate",
  "journey stage", or "buyer nudge".
---

## Purpose & Authority

This skill owns the **buyer's end-to-end experience** on AutoLenis: how a buyer
moves from account creation through prequalification, search/shortlist, deposit,
auction, deal selection, financing, fee, insurance, contract, signing, and
pickup. It is the source of truth for the buyer **journey stage machine**, the
**prequal decision** logic, the **standalone vehicle-request module**, and buyer
navigation gating. Where generic guidance about "build a checkout flow" or "add
a status field" conflicts with what is written here, **this skill wins** — the
buyer journey is state-derived, not manually advanced, and several sub-systems
(vehicle-request, prequal) have deliberate isolation boundaries that must not be
collapsed.

## When this skill activates

- Editing files under `frontend/app/buyer/**`, `frontend/app/api/buyer/**`.
- Editing `frontend/lib/services/buyer/**`, `vehicle-request/**`, `prequal/**`,
  `insurance/**`, `nudge/**`.
- Any task mentioning: buyer onboarding, prequal / prequalification, MicroBilt /
  iPredict, OFAC gate, adverse action, journey stage, buyer sidebar/nav gating,
  `VehicleRequestStatus`, `$99` deposit, buyer nudges, insurance quote/bind.
- Changing `PreQualDecision`, `VehicleRequestStatus`, `InsuranceStatus`, or
  `DepositStatus` handling on the buyer side.

## Architecture & key files

**Journey machine (the spine):**
- `frontend/lib/services/buyer/journey.ts` — the single fact-derived stage
  machine (M-3). Pure function over a `JourneyFacts` object (no Prisma/IO).
  Stages, in order: `account, onboarding, prequal, search, shortlist, deposit,
  auction, select-deal, financing, fee, insurance, contract, sign, pickup,
  complete`. Both `app/buyer/layout.tsx` and `app/api/buyer/journey-status`
  consume this ONE machine — never re-derive stage independently.
- `frontend/lib/services/buyer/nav-gating.ts` — journey-aware sidebar gating
  (M-4). `NAV_STAGE_REQUIREMENT` maps deal-flow hrefs to the stage that unlocks
  them; unreachable items render locked/disabled, not dead links.
- `frontend/lib/services/buyer/buyer-onboarding.service.ts`,
  `buyer-profile.service.ts`, `profile-completeness.service.ts`.

**Prequal:**
- `frontend/lib/services/prequal/prequal.service.ts` — orchestrator; single
  source of truth for approval gating (`isPrequalValid`, `toBuyerSafePrequal`).
- `frontend/lib/services/prequal/microbilt.service.ts` — real MicroBilt iPredict
  integration (SOFT pull only). `rawResponse` stored AES-256-GCM encrypted
  (`PREQUAL_ENCRYPTION_KEY`, 64-char hex, fail-fast, no default). 10s
  AbortController timeout → `MANUAL_REVIEW`.
- `frontend/lib/services/prequal/income-gate.ts` — two-DTI capacity calc
  (front-end auto ≤ 20%, back-end total ≤ 45%); runs PASS 1 before MicroBilt and
  PASS 2 after tier returns.
- Models: `PrequalConsent` (stores EXACT `FCRA_CONSENT_TEXT`), `PreQual*`.
- Routes: `frontend/app/api/buyer/prequal/**`.

**Vehicle request (standalone module — System 4C):**
- `frontend/lib/services/vehicle-request/vehicle-request.service.ts` and
  siblings (`vehicle-request-offer`, `-due-diligence`, `-analytics`,
  `car-request-financing`, `notes-parser`).
- Models: `VehicleRequest`, `VehicleRequestEvent`, `VehicleRequestOffer`,
  due-diligence `checkpoints`.
- Routes: `frontend/app/api/buyer/requests/**` (`route.ts`, `[requestId]/cancel`,
  `[requestId]/offer/respond`, `financing/upload-letter`).

**Insurance:** `frontend/lib/services/insurance/insurance.service.ts` (mock
gated behind `NODE_ENV !== 'production'`; no real insurer wired yet — production
throws until an API is configured). **Nudges:**
`frontend/lib/services/nudge/nudge.service.ts` (Feature 6, `NudgeStage`,
`NudgeChannel`).

## Core rules & invariants

1. **Journey stage is derived, never stored/advanced manually.** Gather facts
   (onboarding, prequal validity, shortlist count, deposit, active auction, deal
   facts) and pass them to `journey.ts`. Do not add a `currentStage` column or a
   parallel switch statement.
2. **Prequal is a SOFT pull only.** Never trigger a hard credit inquiry.
   `isPrequalValid` is the only gate: `decision === "APPROVED" && expiresAt >
   now`. Every other `PreQualDecision` (`DECLINED`, `PENDING`, `MANUAL_REVIEW`,
   `OFAC_REVIEW`, `OFAC_ESCALATED`) leaves the buyer gated at the prequal step.
3. **OFAC gate is hard and silent.** `ofacFlagged === true` →
   `MANUAL_REVIEW` + admin queue, internal status `OFAC_REVIEW`/`OFAC_ESCALATED`,
   **no buyer-visible explanation**. Never surface the OFAC flag or raw iPredict
   score to the buyer.
4. **`maxOtdAmountCents` is set ONCE on APPROVED and is immutable thereafter**
   (fallback chain: recommended → max → buyer's stated budget). Final budget =
   `min(income gate, credit gate)`.
5. **The vehicle-request module is completely isolated from the core deal
   pipeline.** No shared lifecycle states, status models, or service logic. Deal
   creation from a vehicle request is **admin-triggered ONLY** — never automatic
   on buyer accept.
6. **One active vehicle request per buyer; max 3 submissions/hour**
   (`checkRateLimit`, `hasActiveRequest`, `VEHICLE_REQUEST_MAX_PER_HOUR`).
7. **Vehicle-request offers require ALL due-diligence checkpoints complete**
   before `OFFER_SENT` — `createAndSendOffer` throws otherwise.
8. **Every buyer-facing prequal payload goes through `toBuyerSafePrequal`** —
   never expose raw scores, DTI internals (unless explicit admin
   `includeDecisionDetail`), or the OFAC flag.
9. **Server-side authorization always.** Buyer identity comes from the verified
   JWT (`lib/auth`), never from a client-supplied `buyerId`.
10. **Insurance mock is dev-only** (`isMock`, D5 gate). Never let a mock quote
    reach a production `POLICY_BOUND` state.

## Workflows

**Prequalification (buyer submits):**
1. Validate FCRA consent captured; persist EXACT `FCRA_CONSENT_TEXT` on
   `PrequalConsent`.
2. Run income-gate PASS 1 (UNKNOWN tier) → `requestedAmtCents`.
3. Call MicroBilt iPredict (soft pull, 10s timeout). On TIMEOUT / provider error
   → `MANUAL_REVIEW` (never throw to buyer).
4. If `ofacFlagged` → `OFAC_REVIEW`/`OFAC_ESCALATED` + admin queue (silent).
5. Re-run income gate PASS 2 with returned tier APR; final budget =
   `min(income, credit)`.
6. Set `PreQualDecision`. On `APPROVED`: set immutable `maxOtdAmountCents`, send
   approved email. On `DECLINED`: adverse-action email. On review: under-review
   email + admin alert.

**Standalone vehicle request (VehicleRequestStatus machine):**
`SUBMITTED → INTAKE → ACTIVE_SOURCING → OFFER_READY → OFFER_SENT →
OFFER_ACCEPTED | OFFER_DECLINED → DEAL_CREATED`; terminal: `CLOSED_NO_MATCH,
CANCELLED, EXPIRED`.
1. `createVehicleRequest` (rate-limit + single-active checks) → `SUBMITTED`,
   write a `VehicleRequestEvent`.
2. Admin works intake/sourcing; completes due-diligence `checkpoints`.
3. `createAndSendOffer` (all checkpoints complete) → `OFFER_SENT`.
4. Buyer responds at `/api/buyer/requests/[requestId]/offer/respond` →
   `OFFER_ACCEPTED` / `OFFER_DECLINED`.
5. **Admin** manually creates the core deal → `DEAL_CREATED` (never automatic).

**Journey render (layout/API):** gather facts → call `journey.ts` → get
`currentStage`, `completedStages`, `unlockedStages`, `nextAction`; feed
`nav-gating.ts` to decide locked sidebar items.

**Nudges:** `triggerNudge(buyerId, NudgeStage)` respects `maxDismissals` and
`cooldownHours` from `NudgeConfiguration`; stages include `PREQUAL_IDLE`,
`DEPOSIT_IDLE`, `FINANCING_IDLE`, `INSURANCE_IDLE`, `EMAIL_IDLE`. Cron:
`runNudgeEngine`.

## Boundaries — do / never

**Do:**
- Extend `journey.ts` facts when a new gate is needed; keep it pure.
- Route buyer prequal reads through `toBuyerSafePrequal`.
- Keep vehicle-request logic inside `lib/services/vehicle-request/**`.
- Run buyer-facing background work off the request path (`after()` / Inngest /
  QStash) and log which provider fired.

**Never:**
- Never store or manually set a buyer "current stage" — always derive it.
- Never merge vehicle-request statuses into the core `DealStatus` pipeline, or
  auto-create a deal on buyer accept.
- Never trigger a hard credit pull, or expose OFAC/raw-score data to a buyer.
- Never let a client-supplied `buyerId` bypass JWT-derived identity.
- Never mutate `maxOtdAmountCents` after `APPROVED`.
- Never let an insurance mock run in production.

## Best practices & examples

Prequal gate at any downstream buyer step:
```ts
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
if (!isPrequalValid(await getLatestPrequal(buyerId))) {
  return gateToStep("prequal"); // do not advance the journey
}
```

Vehicle-request creation respects isolation + rate limits:
```ts
if (!(await checkRateLimit(buyerId))) return tooManyRequests();
if (await hasActiveRequest(buyerId)) return conflict("one active request");
const req = await createVehicleRequest(buyerId, data); // status SUBMITTED
```

Journey is one machine, two consumers — never a second switch:
```ts
const facts = await gatherJourneyFacts(buyerId);
const { currentStage, unlockedStages } = computeJourney(facts); // journey.ts
```

## Acceptance criteria

- [ ] No new "current stage" storage; stage still derived via `journey.ts`.
- [ ] Prequal remains a soft pull; `isPrequalValid` unchanged as the sole gate.
- [ ] OFAC path stays silent to buyer; no raw score/flag leaks; buyer payloads
      pass through `toBuyerSafePrequal`.
- [ ] `maxOtdAmountCents` set once on APPROVED, never mutated.
- [ ] Vehicle-request stays isolated; deal creation still admin-only; status
      transitions use exact `VehicleRequestStatus` values.
- [ ] Due-diligence checkpoints enforced before `OFFER_SENT`.
- [ ] Rate limit + single-active-request rules intact.
- [ ] Buyer identity from verified JWT; server-side authz on every route.
- [ ] Background work off the request path; provider/model logged.
- [ ] Insurance mock stays dev-gated.

## Cross-skill links

- `autolenis-master` — platform-wide context and engineering standards.
- `autolenis-auction-engine` — deposit → auction → offer flow the journey feeds.
- `autolenis-best-price-report` — how buyers see ranked offers post-auction.
- `autolenis-payments-and-ledger` — `$99` deposit / concierge fee mechanics.
- `autolenis-contract-shield` — the contract stage of the journey.
- `autolenis-communications-consent` — buyer emails/SMS/nudge delivery + consent.
- `autolenis-auth-security-privacy` — JWT auth, PII encryption, OFAC handling.
- `autolenis-domain-model` — Prisma enums and model relationships.
