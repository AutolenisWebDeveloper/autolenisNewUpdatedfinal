# Deal Completion Autopilot — Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the post-acceptance Deal spine actually advance end-to-end — every
transition edge driven, recoverable, notified, and reachable for BOTH the auction
and concierge tracks — without building any parallel system.

**Architecture:** `advanceDealStatus` in `lib/services/deal/deal.service.ts` is the
single guarded seam (CAS + history + comms + completion event + insurance gate).
Every fix routes through it or through the existing service that owns the stage. No
new state machine, no new evidence store, no new cron engine beyond the existing
`authorizeCronRequest` + `withCronRun` + `CRON_STALENESS` + `vercel.json` pattern.

**Tech Stack:** Next.js 16 App Router · Prisma 5 · PostgreSQL 16 · Stripe webhooks ·
node:test with `--experimental-test-module-mocks` · Playwright (Chromium at
`/opt/pw-browsers`).

**Spec:** The 28-probe audit harvest (29 probe reports, 43 deduped blockers) in
`wf_bce41587-1e0/journal.jsonl`, plus the independent review of commits
`76b1023`/`4b0e2b2`. Findings re-verified against HEAD before each fix.

## Global Constraints

- Never write `deal.status` outside `deal.service.ts` (autolenis-deal-lifecycle rule 1).
- `CONTRACT_APPROVED` remains the ONLY route into `SIGNING_PENDING`. Do not widen.
- Money is integer minor units; never trust client-supplied payment status.
- Reuse before create — prove absence before adding a service/table/route/cron.
- Every new cron: implemented + `vercel.json` + `CRON_STALENESS` + `authorizeCronRequest`.
- Every fix is failing-first tested. Gates: `pnpm typecheck`, `pnpm lint` (0 errors),
  `pnpm test:coverage-check`, `pnpm test:all`, `pnpm build`.
- Migrations are AUTHORED ONLY and owner-gated. No production data is mutated.

## Local verification environment (established this session)

PostgreSQL 16 server binaries ship in the image. A real database is available:

```bash
/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -A trust -U postgres
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata \
  -o '-k /tmp/pgrun -p 5433 -c listen_addresses=127.0.0.1' -l /tmp/pg.log start
export DATABASE_URL="postgresql://postgres@127.0.0.1:5433/autolenis?schema=public"
export DIRECT_URL="$DATABASE_URL"
npx prisma db push --skip-generate --accept-data-loss
```

`prisma migrate deploy` does NOT work from scratch — migration
`20260507000000_add_prequal_consent_accepted_at` references `created_at` on
`prequal_consents`, which does not exist at that point (pre-existing; do not edit an
applied migration — report it).

---

## File Structure

| File | Responsibility | Batch |
| --- | --- | --- |
| `lib/services/deal/deal.service.ts` | the seam; gate drivers | done (B1) |
| `lib/services/admin/admin-buyer-command-center.service.ts` | admin stage moves via seam | done (B1) |
| `app/api/buyer/contract-shield/[dealId]/route.ts` | read-only buyer view | done (B1) |
| `app/api/admin/contract-shield/[reviewId]/route.ts` | admin approve must make deal signable | B2 |
| `lib/services/dealer/dealer-contract.service.ts` | contract upload / ContractVersion ownership | B2 |
| `app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts` | manual fee must continue the ladder | B3 |
| `app/api/webhooks/stripe/route.ts` | fee paid before FEE_PENDING must not wedge | B3 |
| `app/api/admin/deals/route.ts` | admin deal creation entry status | B4 |
| `app/api/buyer/requests/[requestId]/offer/respond/route.ts` | concierge deal creation atomicity | B4 |
| `lib/services/notifications/acquisition-comms.ts` | SIGNED notification owner | B5 |
| `lib/services/deal/deal-risk.service.ts` | stop churning `updatedAt` | B5 |
| `e2e/` + `playwright.config.ts` | end-to-end validation (currently missing) | B6 |

---

### Task B2: Contract/signing reachability

**Files:**
- Modify: `app/api/admin/contract-shield/[reviewId]/route.ts`
- Modify: `lib/services/dealer/dealer-contract.service.ts`
- Test: `lib/services/contract-shield/__tests__/admin-approve-signable.test.ts`

**Interfaces:**
- Consumes: `advanceDealStatus(dealId, to, opts)`; `prepareBuyerSigningEnvelope(dealId)`
  which REQUIRES a `ContractVersion` with `status = "APPROVED"`.
- Produces: an admin APPROVE that leaves the deal genuinely signable.

**Defect:** the only writer of `ContractVersion.status = "APPROVED"` is
`dealer-contract.service.ts` on an automated `PASS`. Admin APPROVE force-advances the
Deal to `CONTRACT_APPROVED` and tells the buyer to sign, but leaves the
`ContractVersion` un-approved, so `prepareBuyerSigningEnvelope` throws
`NoSignableDocumentError` forever. Second defect: `assertDealerOwnsDeal` gates on
`offer: { dealerId }`, so a concierge deal can never obtain a `ContractVersion` at
all — Contract Shield and e-sign are unreachable for that whole track.

- [ ] Step 1: failing test — admin APPROVE flips the backing ContractVersion to APPROVED
- [ ] Step 2: run, expect FAIL
- [ ] Step 3: in the admin APPROVE branch, flip the latest ContractVersion to APPROVED
      in the same transaction as the scan/deal update
- [ ] Step 4: run, expect PASS
- [ ] Step 5: failing test — a concierge deal (offerId null) can have a contract attached
- [ ] Step 6: widen the ownership predicate to admit the concierge track without
      weakening dealer isolation (dealer path unchanged; concierge path admin//system)
- [ ] Step 7: full gates + commit

### Task B3: Fee ladder completeness

**Files:**
- Modify: `app/api/admin/payments/concierge-fee/[dealId]/mark-paid/route.ts`
- Modify: `app/api/webhooks/stripe/route.ts`
- Test: `app/api/admin/payments/__tests__/mark-paid-ladder.test.ts`

**Defects:** (a) admin mark-paid stops at `FEE_PAID`; the only driver of
`FEE_PAID → INSURANCE_PENDING` is the Stripe webhook, so a manually-marked fee
strands the deal permanently. (b) a fee paid while the deal is BEFORE `FEE_PENDING`
is banked (`feePaidAt` written) but never advances, and the buyer's duplicate-charge
guard is `feePaidAt` — so the deal wedges. (c) no reconciler for a lost fee webhook.

- [ ] Step 1: failing test — mark-paid continues to INSURANCE_PENDING
- [ ] Step 2: run, expect FAIL
- [ ] Step 3: after FEE_PAID, drive INSURANCE_PENDING through the seam
- [ ] Step 4: failing test — fee paid before FEE_PENDING still lands the deal on the ladder
- [ ] Step 5: implement; run; gates; commit

### Task B4: Entry and dead states

**Files:**
- Modify: `app/api/admin/deals/route.ts` (creates at `ACTIVE`, an undriven state)
- Modify: `app/api/buyer/requests/[requestId]/offer/respond/route.ts` (deal.create
  outside the accepting transaction — offer accepted with no Deal, no compensation)
- Test: extend `app/api/admin/deals/__tests__/`

- [ ] Step 1: failing test — admin-created deal starts on a driven state
- [ ] Step 2: create at `FINANCING_PENDING`, matching both other creation paths
- [ ] Step 3: failing test — offer acceptance and deal creation are atomic
- [ ] Step 4: move `deal.create` inside the existing `$transaction`; gates; commit

### Task B5: Durability, notifications, stall detection

**Files:**
- Modify: `lib/services/notifications/acquisition-comms.ts` (`SIGNED` is listed in
  `INAPP_OWNED_BY_CALLERS` deferring to `esign.service.handleEnvelopeCompleted`,
  a symbol that does not exist anywhere — so SIGNED is silent on every channel)
- Modify: `lib/services/deal/deal-risk.service.ts` (rewrites every non-terminal deal
  every 5 min, resetting `updatedAt`, the staleness key every stall detector uses)
- Test: `lib/services/notifications/__tests__/`, `lib/services/deal/__tests__/`

- [ ] Step 1: failing test — SIGNED produces a buyer notification
- [ ] Step 2: make the seam own the SIGNED in-app notification
- [ ] Step 3: failing test — risk recompute does not touch `updatedAt` when unchanged
- [ ] Step 4: implement; gates; commit

### Task B6: Playwright end-to-end validation

**Files:**
- Create: `playwright.config.ts` (note: `test:visual` already references
  `playwright.visual.config.ts`, which does NOT exist — the visual gate is broken)
- Create: `e2e/deal-autopilot.spec.ts`
- Modify: `package.json` (`test:e2e`)

**Approach:** boot the real app against the local Postgres, seed a deal, and drive
the buyer/dealer surfaces. Assert the state machine advances and that the fixed
paths behave (no self-approval surface, concierge shows concierge copy).

- [ ] Step 1: add a Playwright config pointing at `/opt/pw-browsers` chromium
- [ ] Step 2: seed script for a deterministic deal fixture
- [ ] Step 3: spec — buyer journey renders and gates correctly
- [ ] Step 4: run headless; record PASS/FAIL honestly; gates; commit

---

## Self-Review

**Spec coverage:** B1 (done) covers audit blockers 11/34/36 (self-approval) and
23/26/41/42/43 (parallel state machine). B2 covers 3/12/14/37. B3 covers 5/6/7/8/22/
30/31/32/33. B4 covers 1/19/27/28. B5 covers 20/39/21/40. B6 covers the E2E
requirement and the broken visual gate. Blockers 13 (junk-fee regex on comma
currency), 16 (reschedule hides dealer surface), 17 (affiliate auto-approve ignores
deal status), 18 (completion-event durability), 24/25 (test gaps) are NOT yet
assigned — carry them into a B7 or report as remaining.

**Placeholder scan:** no TBDs; each task names exact files and the exact defect.

**Type consistency:** `advanceDealStatus` returns `Promise<boolean>` and accepts
`expectedFrom?: DealStatus` (added earlier this session) — used consistently.
