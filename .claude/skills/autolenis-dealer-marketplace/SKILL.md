---
name: autolenis-dealer-marketplace
description: >
  Authoritative skill for the AutoLenis dealer marketplace — dealer recruitment,
  application/verification, account claim, onboarding, agreement signing, profile,
  scorecard/tiering, capacity, and the strict dealer-isolation rules that keep one
  dealer from ever seeing another's bids or buyer PII. Use this skill when working on
  anything under frontend/lib/services/dealer/, frontend/lib/services/dealer-recruitment/,
  frontend/lib/services/agreement/, app/dealer/, or app/api/dealer/**; when touching the
  Dealer, DealerApplication, DealerVerification, DealerInvitation, DealerAccountClaimToken,
  DealerScorecardSnapshot, or DealerCapacityConfig models; or when the task mentions dealer
  outreach/enrichment, dealer prospects, dealer onboarding, dealer claim, dealer tier/scorecard,
  dealer JWT/auth, or dealer anonymization/isolation.
---

## 1. Purpose & Authority

This skill owns the **dealer side of the AutoLenis marketplace**: how dealers are
discovered and recruited, how they apply/are verified/claim an account, how they onboard
and sign the network agreement, their profile/tier/scorecard/capacity, and — most
importantly — the **isolation contract** that prevents any dealer from seeing another
dealer's offers or a buyer's identity. It does **not** own the reverse-auction lifecycle or
offer ranking (that is `autolenis-auction-engine`) — but it defines who is eligible to be
invited and what a dealer is allowed to see. Where this skill and generic Next.js/CRUD
guidance conflict, **this skill wins**. Never weaken an isolation rule for convenience.

## 2. When this skill activates

- File paths: `frontend/lib/services/dealer/**`, `frontend/lib/services/dealer-recruitment/**`,
  `frontend/lib/services/agreement/**`, `frontend/app/dealer/**`, `frontend/app/api/dealer/**`,
  `frontend/app/api/public/dealer-*`, `frontend/app/api/cron/dealer-*`, `frontend/lib/dealer-auth.ts`,
  `frontend/lib/auth/dealer-api.ts`, `frontend/lib/auth/dealer-session.ts`.
- Models: `Dealer`, `DealerApplication`, `DealerVerification`, `DealerLicense`,
  `DealerInvitation`, `DealerAccountClaimToken`, `DealerAgreementSignature`,
  `DealerScorecardSnapshot`, `DealerCapacityConfig`, `DealerFeedConfig`.
- Keywords: dealer recruitment / prospect / enrichment / outreach, dealer application,
  dealer verification/license, dealer claim/onboarding, dealer agreement/certificate,
  dealer tier / scorecard / capacity, dealer JWT, dealer anonymization/isolation.

## 3. Architecture & key files

**Dealer operational services — `frontend/lib/services/dealer/`**
- `dealer-onboarding.service.ts` — `getDealerOnboardingStatus()`; step gating (profile,
  license, inventory, DMS feed). `Dealer.onboardingStep` default `"BUSINESS_INFO"`.
- `dealer-profile.service.ts`, `dealer-dashboard.service.ts`, `dealer-analytics.service.ts`.
- `dealer-scorecard.service.ts` — `computeDealerScorecard(dealerId, days=90)`: win rate,
  deal-completion rate, auction-response rate, avg response hours, junk-fee ratio, tips.
- `dealer-deals.service.ts`, `dealer-contract.service.ts`, `dealer-billing.service.ts`,
  `deal-document-link.service.ts`.

**Dealer recruitment funnel — `frontend/lib/services/dealer-recruitment/`**
- `email-enrichment.service.ts` — finds Internet Sales Manager email via **Gemini 2.5 Flash
  + Google Search grounding**; caches on the `dealer_prospects.emailEnrichedAt` timestamp
  (30-day TTL, `force` to override). Validates candidate email at the boundary.
- `dealer-email-send.service.ts` — CAN-SPAM outreach via **Resend**, logs `dealer_outreach_log`;
  enforces suppression (never email bounced/complained/unsubscribed) and rate limits
  (50/hr, 200/day channel-wide). `OutreachType` = `initial | followup_1 | followup_2`.
- `email-template.service.ts`, `dealer-followup.service.ts`, `phone-script-drafter.service.ts`.
- `unsubscribe-token.service.ts`, `prospect-claim.service.ts`, `account-claim.service.ts`
  (WO-2 claim tokens), `auto-approval.ts` (`evaluateDealerApplicationAutoApproval`).

**Agreement — `frontend/lib/services/agreement/certificate.service.ts`**
- Generates the tamper-evident e-signature certificate PDF (pdfkit) for a signed dealer
  network participation agreement; uploads to the private Supabase bucket `legal-documents`.
  Runs inside `after()` and MUST NOT throw.

**Auth & isolation helpers**
- `frontend/lib/dealer-auth.ts` — dealer JWT (`dealer_token` cookie, issuer `autolenis-dealer`,
  `DEALER_JWT_SECRET` → falls back to `JWT_SECRET`). Credential-only (no MFA).
- `frontend/lib/auth/dealer-api.ts` — `getRequestDealer(request)`, `successResponse`,
  `errorResponse`. **Every dealer API route resolves the dealer server-side via this.**
- Edge routing enforced in `frontend/proxy.ts` (no `middleware.ts`).

**Routes:** `app/dealer/*` (onboarding, apply, claim, dashboard, opportunities, offers,
auctions, scorecard, deals, ...). `app/api/dealer/*`. Public: `app/api/public/dealer-application`,
`dealer-coverage`, `dealer-unsubscribe`. Crons: `app/api/cron/dealer-followup`,
`dealer-scorecard-snapshot`, `dealer-inactive`, `dealer-invitation-reminder`.

## 4. Core rules & invariants

1. **Dealer isolation (highest priority).** A dealer may see, for an auction they are invited
   to: vehicle specs, an **anonymized budget range** (never `maxOtdAmountCents`), the deadline,
   the offer **count**, and **their own** offer(s). A dealer must **NEVER** see: buyer name /
   email / phone / exact address, the exact budget, any **other dealer's offer** or identity, or
   internal foreign keys (strip `buyerId` before returning). See
   `app/api/dealer/auctions/[auctionId]/route.ts` for the canonical anonymization contract.
2. **Server-side authorization only.** Resolve the dealer with `getRequestDealer(request)` and
   gate every read/write on an `AuctionInvitation` (or ownership) row. Never trust a client-sent
   dealerId or a frontend role check.
3. **DealerStatus** = `PENDING → ACTIVE → SUSPENDED → TERMINATED`. Only `ACTIVE` dealers are
   invited/matched. `PENDING` = applied/claimed, not yet approved. `SUSPENDED`/`TERMINATED` are
   excluded from all matching and public counts.
4. **`Dealer.tier` is a String** (default `"STANDARD"`), not an enum. Observed values:
   `PLATINUM`, `GOLD`, `STANDARD`, `PROBATION`. Do not introduce a new enum — keep it a string.
5. **System "Outside Dealer" placeholder** (`isSystemPlaceholder = true`, status `TERMINATED`)
   backs `Offer.dealerId` for unregistered/outside dealers. It is **never** invited, matched, or
   counted in public stats. Exclude it with `isSystemPlaceholder: false` in matching queries.
6. **Claim tokens are hashed.** `DealerAccountClaimToken` stores only the SHA-256 hash; the raw
   token exists solely in the emailed link, is single-use, 7-day TTL. Never log or persist raw
   tokens. Same rule for prospect-claim and unsubscribe tokens.
7. **Outreach compliance.** Never send to a suppressed (bounced/complained/unsubscribed) address;
   honor the 50/hr, 200/day channel caps; every send is CAN-SPAM compliant with a working
   unsubscribe footer and is logged.
8. **Auto-approval is a triage signal, not account creation.** `evaluateDealerApplicationAutoApproval`
   returns `eligible` / `autoApprovable`; hands-off approval additionally requires a Maps-verified
   placeId and an env flag. Anonymous public applications are never fully auto-approved.
9. **Agreement + certificate are the record of consent.** A dealer is not fully operational until
   the network agreement is signed (`DealerAgreementSignature` or the DocuSign
   `marketplaceAgreementSignedAt`). Certificate generation runs in `after()` and swallows errors.

## 5. Workflows

**Recruit → apply → verify → claim → onboard → active**
1. Recruitment: build/import `DealerProspect`, enrich the ISM email via
   `email-enrichment.service.ts` (Gemini + Search grounding, cached 30d), then send outreach via
   `dealer-email-send.service.ts` (suppression + rate limit + `dealer_outreach_log`). Follow-ups
   step `initial → followup_1 → followup_2`.
2. Application: `DealerApplication` created (`DealerApplicationStatus` `PENDING → APPROVED/REJECTED`)
   from `app/api/public/dealer-application` or an invited prospect. Annotate with
   `evaluateDealerApplicationAutoApproval` for the admin queue.
3. Approval → claim: admin approval issues a `DealerAccountClaimToken` (hashed, 7d). Dealer sets
   their password via `/dealer/claim`; the Supabase user is created with no known password.
4. Verification: `DealerVerification` / `DealerLicense` capture license number + state + docs;
   `verified` flips with `verifiedBy`/`verifiedAt`.
5. Onboarding: `getDealerOnboardingStatus()` gates steps; `Dealer.status` moves to `ACTIVE` once
   complete. Sign the network agreement → `DealerAgreementSignature` (+ certificate PDF in
   `after()`), or DocuSign envelope flips `marketplaceAgreementSignedAt`.

**Compute a scorecard / tier**
- `computeDealerScorecard(dealerId, days=90)` aggregates `AuctionInvitation`, `Offer`
  (SUBMITTED/ACCEPTED), and completed `Deal` rows to derive win rate, completion rate, response
  rate, avg response hours, and junk-fee ratio, plus improvement tips. Persist periodic
  `DealerScorecardSnapshot` rows via `app/api/cron/dealer-scorecard-snapshot`. Tier feeds auction
  invitation scoring (see auction-engine skill).

**Capacity throttle**
- `DealerCapacityConfig.maxAuctionLoad` (default 5) plus `Dealer.currentAuctionLoad` cap concurrent
  invitations. Load is incremented on invite and decremented on auction close (release).

## 6. Boundaries — do / never

**Do**
- Resolve the dealer server-side (`getRequestDealer`) and gate every dealer read/write on an
  invitation or ownership row.
- Return only anonymized budget **ranges** and offer **counts** to dealers; strip internal FKs.
- Exclude `isSystemPlaceholder: true` and non-`ACTIVE` dealers from matching and public stats.
- Store only hashed tokens; check suppression + rate limits before any outreach send.
- Put certificate generation, outreach follow-ups, and CRM/GHL tag sync off the request path
  (`after()` / QStash / Inngest).

**Never**
- Never return a buyer's name/email/phone/exact address or exact budget to a dealer.
- Never return another dealer's offer, price, or identity — not even a "you're ranked #2 at $X".
- Never trust a client-supplied dealerId, tier, or role; never gate authorization in the frontend.
- Never email a suppressed address or exceed the outreach caps.
- Never persist or log a raw claim/unsubscribe token; never mint a `Dealer` from an unverified
  anonymous application without admin action.
- Never turn `Dealer.tier` into an enum or invite the Outside Dealer placeholder.

## 7. Best practices & examples

Canonical anonymized dealer auction read (`app/api/dealer/auctions/[auctionId]/route.ts`):
```ts
const dealer = await getRequestDealer(request);
if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
// gate on invitation
const invitation = await prisma.auctionInvitation.findFirst({
  where: { auctionId, dealerId: dealer.id },
});
if (!invitation) return errorResponse("NOT_FOUND", "Auction invitation not found", 404);
// coarsen budget; NEVER return maxOtdAmountCents
const budgetRange = prequal?.maxOtdAmountCents ? bucketBudgetCents(prequal.maxOtdAmountCents) : null;
// dealer's OWN offer only — query filtered by dealerId
const myOffer = await prisma.offer.findFirst({ where: { auctionId, dealerId: dealer.id } });
const { buyerId: _b, _count, ...auctionPublic } = auction; // strip FK
```

Competitiveness feedback returns an **anonymized median only**, never individual competitor
prices, and requires a minimum sample (`>= 5`) before returning a ranking — see
`app/api/dealer/offers/competitiveness-check/route.ts`.

Matching query must exclude the placeholder and inactive dealers:
```ts
prisma.dealer.findMany({ where: { status: "ACTIVE", isSystemPlaceholder: false } });
```

## 8. Acceptance criteria

- [ ] Every dealer route resolves the dealer via `getRequestDealer` and gates on an invitation /
      ownership row; no client-supplied dealerId is trusted.
- [ ] No response to a dealer contains buyer PII, exact budget, another dealer's offer/identity,
      or internal FKs (`buyerId` stripped).
- [ ] Matching/public queries filter `status: "ACTIVE"` and `isSystemPlaceholder: false`.
- [ ] Outreach paths check suppression + rate limits and write `dealer_outreach_log`; unsubscribe
      footer present.
- [ ] Tokens (claim/prospect/unsubscribe) are hashed, single-use, TTL-bounded, never logged.
- [ ] `DealerStatus` / `DealerApplicationStatus` transitions use exact enum values; `tier` stays a
      String.
- [ ] Certificate/outreach/tag-sync side effects run off the request path and swallow their errors.
- [ ] Scorecard/capacity math reads real `Offer`/`Deal`/`AuctionInvitation` rows (no hardcoded
      metrics).

## 9. Cross-skill links

- **autolenis-auction-engine** — reverse-auction lifecycle, offer submission/ranking, winner
  selection; consumes dealer tier/capacity for invitation scoring. Load together for anything
  spanning dealers + auctions.
- **autolenis-auth-security-privacy** — JWT roles, RLS, PII handling; the isolation rules here
  are an application of that skill.
- **autolenis-system-architecture** — service-layer boundaries, background jobs, "extend, never
  duplicate." Load FIRST.
- **autolenis-communications-consent** — outreach consent, suppression, CAN-SPAM specifics.
- **autolenis-integrations** — Resend, Gemini grounding, GoHighLevel, DocuSign wiring.
- **autolenis-domain-model** — the full Prisma model catalog and enum reference.
