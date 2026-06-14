# AUTOLENIS — Completion Workflow · Phase 1 Completion Matrix

**Session:** 1 (discovery only — no code changed) · **Date:** 2026-06-14 · **Branch:** `claude/epic-lamport-h6i6cy`

## Legend
- **Status**: Complete / Partial / Missing / Broken / UNVERIFIED.
- **UI wired**: page/component imports the service/API AND renders bound interactive elements. Service-layer existence alone = Partial.
- **API+authz**: route handler performs server-side role check before any privileged action. Unguarded mutating endpoint = Broken (security).
- **States**: explicit empty/loading/success/error + blocked/gated branch. Route-level `loading.tsx` is widespread (123 files); per-component error/empty branches were **not** opened for every surface — those are marked **UNVERIFIED (needs runtime/Phase 2)** rather than guessed.
- **Cross-role propagation**: status transition writes a notification/audit event an Admin surface can read.
- Evidence cites `path:line`. "—" = not applicable.

> Verification confidence note: API+authz, the lifecycle **gates**, and the 9 re-verification targets were verified by reading the actual handlers/state machine. The four UI display-states and full link-graph resolution were **sampled, not exhaustively confirmed**; rows reflect that honestly.

---

## A. BUYER LIFECYCLE (16 stages) — Role: BUYER

| # | Surface/Route | Lifecycle stage | Exists | UI wired | API+authz | States | Links | X-role prop | Compliance | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/auth/signup`, `/auth/signin`, `app/auth/callback/route.ts` | signup/login | ✅ | ✅ | ✅ Supabase session | UNVERIFIED | OK (sampled) | n/a | OK | **Partial** | `app/auth/signup/page.tsx`; `lib/auth/api.ts:19` | Supabase auth; verify-email + accept-terms gating in proxy. State branches not opened. |
| 2 | `/buyer/onboarding`, `api/buyer/onboarding/complete` | onboarding | ✅ | ✅ | ✅ `getRequestBuyer` | UNVERIFIED | OK (sampled) | Admin journey reads | OK | **Partial** | `app/buyer/onboarding/page.tsx`; `app/api/buyer/onboarding/complete/route.ts` | Journey status mirrored to admin via `api/admin/buyers/[id]/journey`. |
| 3 | `/buyer/prequal` (+`/external`, `/manual-preapproval/status`, `/result`, `/pending`, `/declined`), `api/buyer/prequal` | prequal / external preapproval | ✅ | ✅ | ✅ | UNVERIFIED | OK (sampled) | ✅ admin prequal queue | ✅ "**not a guarantee of financing**" disclaimer present | **Partial→Complete** | `app/buyer/prequal/page.tsx:390`; `app/api/buyer/prequal/route.ts`; `app/api/buyer/prequal/external/route.ts` | Microbilt IBV + admin decide path (`api/admin/prequal/[id]/decide`). External preapproval upload supported. |
| 4 | `/buyer/search`, `api/buyer/search` | eligibility-constrained search | ✅ | ✅ | ✅ | UNVERIFIED | OK | n/a | OK | **Complete (gate)** | **`app/api/buyer/search/route.ts:48-64`** | **Prequal budget guard CONFIRMED**: queries `preQualification.maxOtdAmountCents`, hard-caps `priceMax` server-side. (Re-verify #2 ✅) |
| 5 | `/buyer/shortlist`, `api/buyer/shortlist` (+`[itemId]`) | shortlist | ✅ | ✅ | ✅ | UNVERIFIED | OK | n/a | OK | **Partial** | `app/buyer/shortlist/page.tsx`; `app/api/buyer/shortlist/route.ts` | Add/remove bound. State branches not opened. |
| 6 | `/buyer/deposit` (+`/success`), `api/buyer/deposit/create-intent`; auction launch | auction activation | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ admin auctions | $99 deposit copy; refundable | **Broken (gate gap)** | `app/api/buyer/deposit/create-intent/route.ts:14-16,89`; `lib/services/deposit/deposit.service.ts:42-47` | Gated by **active prequal + paid deposit**; **non-empty shortlist NOT enforced** before auction creation. Insurance/lender correctly NOT gated. (Re-verify #3 — see deltas.) |
| 7 | `/buyer/auctions`, `/buyer/auction/[id]`, `api/buyer/auctions/[id]/live-status` | dealer offers (auction live) | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ offers notify | OK | **Partial** | `app/buyer/auction/[auctionId]/page.tsx`; `app/api/buyer/auctions/[auctionId]/live-status/route.ts` | Live status polling; offers created by dealers propagate via `offer.service.ts`. |
| 8 | `/buyer/auction/[id]/offers`, `api/buyer/auctions/[id]/best-price`, `/select-offer`, `/decline` | best-price evaluation | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ | OK (no misleading price guarantee in flow) | **Partial** | `app/api/buyer/auctions/[auctionId]/best-price/route.ts`; `.../select-offer/route.ts` | Best-price algo `lib/services/offer/best-price.service.ts`. Select-offer creates Deal at `FINANCING_PENDING`. |
| 9 | `/buyer/deal`, `api/buyer/deals/[id]` | selected deal | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ admin deals | OK | **Partial** | `app/buyer/deal/page.tsx`; `app/api/buyer/deals/[dealId]/route.ts`; `lib/services/offer/offer.service.ts:56` | Deal created `FINANCING_PENDING` (no `SELECTED` state). |
| 10 | `/buyer/deal/financing` (+`/pre-approval`), `api/buyer/deal/financing`, `api/buyer/financing` | financing coordination | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ | "Approved For" shown only for **external** lender preapproval (legit) | **Partial** | `app/buyer/deal/financing/pre-approval/FinancingPreApprovalClient.tsx:212`; `app/api/buyer/deal/financing/route.ts` | FinancingStatus/Path enums; upload-letter path exists. |
| 11 | `/buyer/fee`, `api/buyer/deals/[id]/fee/create-intent` | fee handling | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ admin payments | $499 premium, **separated from vehicle price** | **Complete (separation)** | `lib/constants.ts:6-8`; `lib/services/deal/service-fee.service.ts:8`; `app/api/buyer/deals/[dealId]/fee/create-intent/route.ts` | Fee = `PREMIUM_FEE_CENTS(49900) - DEPOSIT_AMOUNT_CENTS(9900)`; never derived from dealer price. (Re-verify #5 ✅) |
| 12 | `/buyer/insurance`, `api/buyer/insurance` (+`/request-quote`, `/upload-proof`) | insurance completion | ✅ | ✅ | ✅ | UNVERIFIED | ⚠ see notes | OK | **Partial (gate weak)** | `app/api/buyer/insurance/upload-proof/route.ts:94`; `app/api/buyer/pickup/[dealId]/route.ts:35` | Proof/current-insurance fallback CONFIRMED (`EXTERNAL_UPLOADED`). BUT insurance is **not a hard transactional gate** at pickup/completion (pickup checks esign COMPLETED only). (Re-verify #4 — see deltas.) |
| 13 | `/buyer/contract-shield`, `/buyer/contracts/[id]`, `api/buyer/contract-shield/[dealId]` | contract review (Contract Shield) | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ admin contract-shield | OK | **Partial** | `app/api/buyer/contract-shield/[dealId]/route.ts`; admin approval `app/api/admin/contract-shield/[reviewId]/route.ts:74` | Admin approval sets `CONTRACT_APPROVED`. Cron `api/cron/contract-shield`. |
| 14 | `/buyer/esign`, `api/buyer/esign/[dealId]` | e-sign | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ docusign webhook | OK | **Broken (gate gap)** | **`app/api/buyer/esign/[dealId]/route.ts:58-61`** | Route sets `status:"SIGNING_PENDING"` **directly, bypassing `canTransition()`** — does not assert prior `CONTRACT_APPROVED`. **Contract Shield hard-gate NOT enforced at runtime.** (Re-verify #1 — see deltas; flag as security/integrity.) |
| 15 | `/buyer/pickup`, `api/buyer/pickup/[dealId]` (+`/qr`); dealer `api/dealer/pickup/scan` | pickup/delivery | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ pickup.service notifies | OK | **Partial** | `app/api/buyer/pickup/[dealId]/route.ts:35`; `lib/services/pickup/pickup.service.ts` | QR handoff; gated on esign COMPLETED. Admin pickup complete route present. |
| 16 | `/buyer/deal/[id]/complete`, `/receipt`, `api/buyer/deals/[id]/receipt` | completion / post-close | ✅ | ✅ | ✅ | UNVERIFIED | OK | ✅ `api/jobs/deal-complete` | OK | **Partial** | `app/buyer/deal/[dealId]/complete/page.tsx`; `app/api/buyer/deals/[dealId]/receipt/route.ts` | Deal → `COMPLETED`; receipt + review-request job. |

---

## B. DEALER ROLE (participation across lifecycle)

| Surface/Route | Lifecycle stage | Exists | UI wired | API+authz | States | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| `/dealer/apply`, `/dealer/claim`, `/dealer/invite/claim`, `api/dealer/claim`, `api/public/dealer-application` | onboarding/recruitment | ✅ | ✅ | ✅ `getRequestDealer` / public | UNVERIFIED | **Partial** | `lib/auth/dealer-api.ts:17`; `app/api/dealer/claim/route.ts` | JWT `dealer_token`; status gating (PENDING/SUSPENDED/TERMINATED blocked). |
| `/dealer/onboarding/agreement`, `api/dealer/agreement/sign` | agreement e-sign | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/dealer/agreement/sign/route.ts` | Certificate generation route present. |
| `/dealer/inventory` (+bulk/feed/mapping/history), `api/dealer/inventory/**` | inventory supply | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/dealer/inventory/route.ts`, `/bulk`, `/vin-decode` | Feed setup + column mapping + VIN decode. |
| `/dealer/auctions`, `/dealer/quick-offer/[id]`, `api/dealer/offers` (+`/revise`, `/competitiveness-check`) | dealer offers (auction) | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/dealer/offers/route.ts`; `lib/services/offer/offer.service.ts` | Offer create/revise; competitiveness check. Propagates to buyer + admin. |
| `/dealer/deals/[id]`, `/dealer/contracts`, `/dealer/pickups`, `api/dealer/pickup/scan` | deal → pickup | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/dealer/pickup/scan/route.ts` | QR scan at handoff. |
| `/dealer/payments`, `/dealer/scorecard`, `api/dealer/scorecard` | post-close / performance | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/dealer/scorecard/route.ts` | Scorecard snapshot cron. |

---

## C. ADMIN ROLE (oversight / cross-role propagation sink)

| Surface/Route | Lifecycle coverage | Exists | UI wired | API+authz (MFA) | States | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| `/admin/buyers/[id]` + journey routes | buyer lifecycle oversight | ✅ | ✅ | ✅ admin JWT + **MFA** | UNVERIFIED | **Partial** | `lib/auth/admin-api.ts:15`; `app/api/admin/buyers/[buyerId]/journey/route.ts` | Journey lock/skip/complete/notify. Reads buyer transitions. |
| `/admin/prequal`, `api/admin/prequal/[id]/decide`, `/compliance/ofac` | prequal decisions + OFAC | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/prequal/[id]/decide/route.ts` | Manual review, OFAC escalation. |
| `/admin/auctions`, `api/admin/buyers/[id]/launch-auction` | auction activation | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/buyers/[buyerId]/launch-auction/route.ts:79-115` | Admin launch: checks no-open-auction + ≥1 ACTIVE dealer + auto-creates PAID deposit; **no prequal/shortlist check on admin path**. |
| `/admin/contract-shield` (+`/rules`), `api/admin/contract-shield/[id]` | contract review | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/contract-shield/[reviewId]/route.ts:74` | Sets `CONTRACT_APPROVED` (PASS). |
| `/admin/deals/[id]` (+esign/pickup), `api/admin/deals/[id]/action` | deal lifecycle control | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/deals/[dealId]/action/route.ts:142-195` | Cancel bypasses `canTransition` (allowed by design). |
| `/admin/payments` (deposits/refunds), `api/admin/payments/**/refund` | fee/refund handling | ✅ | ✅ | ✅ | UNVERIFIED | **Complete (audit)** | `app/api/admin/payments/deposit/[depositId]/refund/route.ts:84-100`; `.../concierge-fee/[dealId]/refund/route.ts:90-107` | Refunds **audit-logged** to `adminAuditLog`. (Re-verify #7b ✅) |
| `/admin/insurance-requests`, `api/admin/insurance-requests/respond` | insurance ops | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/insurance-requests/respond/route.ts` | — |
| `/admin/operations`, `/admin/ops-dashboard` | ops monitoring | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `lib/services/operations.service.ts:88-134` | Reads real Supabase ops data (DLQ, cron, enrollments). See target #8 below. |
| `/admin/reports/{funnel,pipeline,risk,affiliate,...}` | reporting | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/reports/*/route.ts` | **No `reports/operations/route.ts` exists** (see target #8). |
| `/admin/activity`, `/admin/notifications` | cross-role event sink | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/admin/activity/route.ts` | Deal/auction/offer/pickup services write notifications + `adminAuditLog`; admin activity surface reads them → **propagation generally PASS**. |

---

## D. AFFILIATE ROLE (separate lifecycle)

| Surface/Route | Stage | Exists | UI wired | API+authz | States | Status | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|
| `/affiliate/register`, `/affiliate/signin`, `api/affiliate/register` | signup/login | ✅ | ✅ | ✅ `getRequestAffiliate` | UNVERIFIED | **Partial** | `lib/auth/affiliate-api.ts:13`; `app/api/affiliate/register/route.ts` | Blocks SUSPENDED/REJECTED. |
| `/affiliate/portal/onboarding` (+documents/tax/payment), `api/affiliate/onboarding/**` | onboarding/compliance | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/affiliate/onboarding/submit/route.ts` | Onboarding gate before portal (`affiliate-session.ts:39`). |
| `/affiliate/portal/referrals`, `/network`, `/referral-hub`, `api/affiliate/network` | referral tracking | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/affiliate/network/route.ts`; `app/api/public/referral/track` | Anti-circumvention enum present. |
| `/affiliate/portal/earnings`, `/payouts`, `api/affiliate/payouts/request` | earnings/payouts | ✅ | ✅ | ✅ | UNVERIFIED | **Partial** | `app/api/affiliate/payouts/request/route.ts`; admin `commissions/[id]/mark-paid/route.ts:36-48` | Commission **mark-paid audit-logged** (`adminAuditLog` `COMMISSION_PAID`). (Re-verify #7b ✅) |
| `/for-affiliates` (public) | compliance copy | ✅ | ✅ | n/a | n/a | **Complete** | `app/(public)/for-affiliates/page.tsx:101` | Explicit "no guaranteed income/savings/approvals/outcomes" — compliant. |

---

## E. PUBLIC SURFACES (selected, compliance-relevant)

| Surface | Exists | Compliance | Status | Evidence | Notes |
|---|---|---|---|---|---|
| `/trust` | ✅ | "$99 Refund Guarantee" — **factual, deposit-refund**, not approval guarantee | **Complete** | `app/(public)/trust/page.tsx:11` | Acceptable. |
| `/pricing` | ✅ | "Does AutoLenis guarantee savings?" framed as FAQ (qualified) | **Complete** | `app/(public)/pricing/page.tsx:290` | Qualified, not a guarantee claim. |
| `/refinance` (+eligibility/confirm/ineligible) | ✅ | "Will refinancing guarantee a lower payment?" FAQ (qualified) | **Complete** | `app/(public)/refinance/page.tsx:466` | — |
| `/compare` | ✅ | bare word "guaranteed." at line 319 — **review for context** | **UNVERIFIED** | `app/(public)/compare/page.tsx:319` | Needs visual context; flag for Phase 2 copy review. |
| All `app/(public)/**` | ✅ | — | **Broken (resilience)** | no `error.tsx` under `(public)` | No route-level error boundary on public segment (tech-debt #9). |

---

## MATRIX COVERAGE STATS

- **Total rows: 53** (16 buyer lifecycle + 6 dealer + 10 admin + 5 affiliate + 5 public + legend rows excluded).
  - Buyer lifecycle: 16 · Dealer: 6 · Admin: 10 · Affiliate: 5 · Public: 5 → **42 substantive surface rows.** (53 incl. sub-detail lines.)
- **Status distribution (42 substantive rows):**
  - **Complete: 7** (search budget gate, fee separation, refund audit, commission audit, affiliate compliance copy, trust/pricing/refinance copy grouped).
  - **Partial: 31** (exists + UI-wired + API+authz confirmed, but display-state branches UNVERIFIED pending runtime).
  - **Broken: 3** — (1) **esign gate bypass** (Contract Shield not enforced), (2) **auction activation** (shortlist precondition not enforced), (3) **public error boundaries missing**.
  - **Missing: 1** — `api/admin/reports/operations/route.ts` (prior-claimed path does not exist).
  - **UNVERIFIED (whole-row): 0** — all rows have confirmed Exists/UI/authz; the **`States` column is UNVERIFIED on ~38 rows** (the dominant static-analysis blind spot).

---

## RE-VERIFICATION TARGETS — RESOLUTIONS

1. **Contract Shield hard gate (no SIGNING_PENDING without CONTRACT_APPROVED)** → **CHANGED / NOT ENFORCED (Broken).** State map defines `CONTRACT_APPROVED → SIGNING_PENDING` (`lib/services/deal/deal.service.ts:18-19`), but `app/api/buyer/esign/[dealId]/route.ts:58-61` writes `status:"SIGNING_PENDING"` directly without `canTransition()`/CONTRACT_APPROVED assertion. **Gate is bypassable. Flag: integrity/security.**
2. **Prequal budget guard in buyer search** → **CONFIRMED.** `app/api/buyer/search/route.ts:48-64` reads `preQualification.maxOtdAmountCents` and hard-caps `priceMax` server-side ("never client-controlled"). Field name matches; logic is at ~line 48-64 (prior said ~55).
3. **Auction creation gating** → **PARTIALLY CHANGED.** Insurance/lender correctly **NOT** gated ✅. **Active prequal** required on buyer path (`deposit/create-intent/route.ts:14-16`) but **NOT** on admin launch path. **Paid deposit** required (all paths) ✅. **Non-empty shortlist is NOT enforced anywhere** (`lib/services/deposit/deposit.service.ts:42-47`, `auction.service.ts` createAuction) — **prior claim overstated; mark Broken/gap.**
4. **Insurance blocks only final release + proof fallback** → **PARTIALLY CONFIRMED.** Proof/current-insurance fallback exists (`upload-proof/route.ts:94` → `EXTERNAL_UPLOADED`) ✅. BUT insurance is **not a hard transactional gate** at pickup/completion — `pickup/[dealId]/route.ts:35` checks only esign `COMPLETED`. **"Blocks final release" is NOT enforced in code.**
5. **Fee/deposit separation ($99/$499)** → **CONFIRMED.** `lib/constants.ts:6-8` (`DEPOSIT_AMOUNT_CENTS=9900`, `PREMIUM_FEE_CENTS=49900`); fee computed from constants only (`service-fee.service.ts:8`), hardcoded server-side, never derived from dealer vehicle price.
6. **Deal state machine** → **CHANGED (naming) / CONFIRMED (path).** No `SELECTED` state exists. Canonical map `lib/services/deal/deal.service.ts:10-27`: `PENDING→ACTIVE→FINANCING_PENDING→FEE_PENDING→FEE_PAID→INSURANCE_PENDING→CONTRACT_PENDING→CONTRACT_REVIEW→CONTRACT_APPROVED→SIGNING_PENDING→SIGNED→PICKUP_SCHEDULED→PICKUP_COMPLETE→COMPLETED`. Deal starts at `FINANCING_PENDING` on offer-select (`offer.service.ts:56`). **`CANCELLED` is NOT in the `canTransition` map** (terminal `[]`) — cancellation is done via direct service/admin writes (`deal.service.ts:87-96`, `admin/deals/[id]/action/route.ts:142-195`), i.e. "from any state" works but **bypasses the guard table**.
7. **Stripe idempotency + payout/refund audit** → **CONFIRMED (both).** (a) Idempotency: unique-index atomic claim on `PaymentProviderEvent.eventId` (`webhooks/stripe/route.ts:32-57`; P2002 → ack duplicate). (b) Refunds (`payments/deposit/[id]/refund:84-100`, `concierge-fee/[id]/refund:90-107`) and commission payouts (`commissions/[id]/mark-paid:36-48`) write `adminAuditLog`.
8. **Known gap: `/api/admin/reports/operations/route.ts` returns empty in LIVE** → **CHANGED / N/A — path does not exist.** There is **no** `app/api/admin/reports/operations/route.ts` (reports dir = affiliate, financial-summary, funnel, pipeline, risk). The live ops data source `lib/services/operations.service.ts:88-134` returns **real Supabase data with no DEMO/LIVE branch** (no empty-in-prod stub). **The specific empty-stub gap is not present at the claimed path; the prior reference is stale.**
9. **Tech-debt re-measure** → `any` types: **prior 1,109 → now ~4** (massive cleanup). `console.*` in `lib/`: **prior 113 → now 538** (regressed ~4.7×). Public error boundaries: **still missing (0 `error.tsx` under `app/(public)`; 4 total in `app/`).**

---

## COULD NOT VERIFY STATICALLY (needs runtime / e2e — for Phase 2)

1. **Per-component display states** (empty/loading/success/error/blocked) for ~38 surfaces — route-level `loading.tsx` is widespread, but per-component error/empty branches and gated-state UX require rendering. **(dominant blind spot)**
2. **Full link-graph resolution** (every href/redirect → existing route across 313 pages) — sampled only; needs a link crawler or build-time check.
3. **Cross-role propagation end-to-end timing/visibility** — services write notifications + audit logs and admin surfaces read them, but the actual event reaching a specific admin view per transition needs an integration test.
4. **Whether the esign gate bypass (target #1) is reachable in practice** — the UI may only expose the esign action after CONTRACT_APPROVED; the *handler* lacks the guard regardless. Needs an e2e attempt to POST esign from an earlier state.
5. **Whether the missing shortlist precondition (target #3) is reachable** — buyer deposit flow may require a shortlist UI step before showing the pay button; the server does not enforce it. Needs e2e.
6. **Insurance "final release" enforcement (target #4)** — confirm via e2e whether any later admin/release step blocks on insurance status outside the code paths read.
7. **Playwright config location & full e2e suite result** — only one spec found; no `playwright.config.*` located. Needs `pnpm exec playwright test` in a configured env.
8. **`/compare` line 319 "guaranteed." copy** — needs visual context to confirm it isn't a misleading claim.

---

## RECONCILIATION DELTAS (live code vs prior-audit claims)

| Prior claim (hypothesis) | Live finding | Delta | Evidence |
|---|---|---|---|
| Contract Shield is a hard gate (✅) | esign route bypasses state machine | **✅ → Broken** | `app/api/buyer/esign/[dealId]/route.ts:58-61` |
| Auction gated by prequal + **non-empty shortlist** + deposit | shortlist **not** enforced; prequal not enforced on admin path | **✅ → Broken/Partial** | `lib/services/deposit/deposit.service.ts:42-47`; `launch-auction/route.ts:79-115` |
| Insurance **blocks final release** | only proof-fallback confirmed; no hard release gate | **✅ → Partial** | `app/api/buyer/pickup/[dealId]/route.ts:35` |
| Deal flow `SELECTED→…→COMPLETED`, CANCELLED from any state | no `SELECTED`; starts `FINANCING_PENDING`; CANCELLED outside guard table | **Changed (naming)** | `deal.service.ts:10-27`, `offer.service.ts:56` |
| `/api/admin/reports/operations` returns empty in LIVE | route does not exist; ops service returns real data | **Stale/N/A** | dir listing `app/api/admin/reports/`; `operations.service.ts:88-134` |
| `any` types = 1,109 | ~4 | **−~1,105** | grep `: any` lib/app/components |
| `console.*` in lib = 113 | 538 | **+425** | grep `console.*` lib |
| Test stack = "Vitest + Playwright" | runner is `tsx --test` (Node native) + Playwright | **Changed** | `package.json` test scripts |

---

## RECOMMENDED NEXT DISPATCH — Phase 2 (Gap Analysis), scoped to what the matrix surfaced

**Priority 1 — Integrity/security gates (Broken):**
1. Enforce Contract Shield hard gate: route esign transition through `advanceDealStatus()`/`canTransition()` so `SIGNING_PENDING` requires `CONTRACT_APPROVED` (`app/api/buyer/esign/[dealId]/route.ts`).
2. Enforce auction-activation preconditions server-side: require non-empty shortlist (and active prequal on the admin launch path) before auction creation (`deposit.service.ts`, `launch-auction/route.ts`).
3. Decide & enforce insurance release policy: if insurance must block final release/completion, add the gate at pickup-complete/completion (`pickup/[dealId]`, admin pickup complete).

**Priority 2 — Resilience & correctness:**
4. Add `error.tsx` boundaries to `app/(public)` (and audit other segments; only 4 exist app-wide).
5. Triage 538 `console.*` in `lib/` → structured logger; re-baseline.
6. Resolve `/compare:319` copy + sweep remaining compliance strings for context.

**Priority 3 — Verification infrastructure:**
7. Add a link-graph/build check + per-surface state-branch audit to convert the ~38 `States: UNVERIFIED` rows.
8. Wire/locate `playwright.config.*`, run full e2e, and add gate-bypass e2e tests for targets #1 and #3.
