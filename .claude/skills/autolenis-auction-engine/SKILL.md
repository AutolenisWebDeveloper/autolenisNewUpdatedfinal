---
name: autolenis-auction-engine
description: >
  Authoritative skill for the AutoLenis reverse-auction engine — the ~48-hour private auction
  where invited dealers compete to submit the best out-the-door offer for one buyer, plus offer
  submission/revision/validation, the best-price ranking engine, winner selection, and the
  race-condition/idempotency guards around auction close and activation. Use this skill when
  working on anything under frontend/lib/services/auction/, frontend/lib/services/offer/,
  frontend/app/api/dealer/auctions/**, frontend/app/api/dealer/offers/**,
  frontend/app/api/buyer/auctions/**, or the auction crons; when touching the Auction,
  AuctionInvitation, AuctionVehicle, AuctionExtensionLog, or Offer models; or when a task
  mentions reverse auction, dealer bids/offers, offer ranking/best price, auction close/extend,
  winner selection, invitation scoring, or auction race conditions/idempotency.
---

## 1. Purpose & Authority

This skill owns the **AutoLenis reverse-auction lifecycle**: creating and launching a private
auction after a buyer's `$99` Auction Access Deposit, inviting and scoring dealers, accepting
competing dealer offers (`Offer`), validating and ranking them in the **service layer**, closing
the auction (on time or early), and selecting the winning offer to form a `Deal`. It is a
**reverse** auction — dealers compete downward on out-the-door (OTD) price; the buyer picks.
Ranking, validation, and winner logic **must live in `lib/services/`, never in UI**. This skill
overrides generic auction/marketplace patterns. For who is eligible to be invited, dealer tiers,
and dealer-side anonymization, defer to **autolenis-dealer-marketplace**.

## 2. When this skill activates

- File paths: `frontend/lib/services/auction/**`, `frontend/lib/services/offer/**`,
  `frontend/app/api/dealer/auctions/**`, `frontend/app/api/dealer/offers/**`,
  `frontend/app/api/buyer/auctions/**`, `frontend/app/api/cron/auction-close`,
  `frontend/app/api/cron/vehicle-offer-expire`, `frontend/app/api/jobs/auction-*`,
  `frontend/app/api/jobs/offer-*`, `frontend/app/api/jobs/dealer-bid-reminder`.
- Models: `Auction`, `AuctionInvitation`, `AuctionVehicle`, `AuctionExtensionLog`, `Offer`
  (table `offers`), `OutsideAuctionInvite`, `DealerCapacityConfig`, `BestPriceWeightConfig`.
- Keywords: reverse auction, dealer bid/offer, submit/revise offer, best price / ranking,
  auction close/extend/reopen, winner selection, invitation scoring, auction idempotency.

> Note: the reverse-auction offer model is **`Offer`**. `DealerOfferSubmission` is a *separate*
> concierge track (admin-generated `VehicleOffer` links) and is **not** the auction offer — do
> not conflate them.

## 3. Architecture & key files

**Auction lifecycle — `frontend/lib/services/auction/`**
- `auction.service.ts` — `createAuction`, `launchAuction` (sets `startedAt`/`endsAt` =
  now + `AUCTION_DURATION_HOURS`), `closeAuction`, `extendAuction`, `closeExpiredAuctions`,
  and the idempotent `processAuctionClose` + pure `postCloseClaimWon` (F-001).
- `dealer-invitation.service.ts` — `inviteDealersToAuction` (geo pre-filter + `scoreDealerForAuction`,
  top **8**, load increment), `releaseAuctionLoad`. `MAX_INVITATIONS_PER_AUCTION = 8`,
  `MAX_DISTANCE_MILES = 150`.
- `auction-extension.service.ts` — `requestExtension` (+ `AuctionExtensionLog`), `getExtensionHistory`.
- `auction-capacity.service.ts` — `getDealerCapacity`, `isDealerAtCapacity` (default max load 5).
- `deposit-activation.service.ts` + `deposit-activation-policy.ts` — W0-A reconciler that
  guarantees a CONFIRMED `$99` deposit results in exactly one launched, invited auction.

**Offer engine — `frontend/lib/services/offer/`**
- `offer.service.ts` — `submitOffer`, `reviseOffer` (max `MAX_OFFER_REVISIONS = 1`),
  `getOffersForAuction`. All OTD arithmetic, budget, and financing validation happen here.
- `best-price.service.ts` — `rankOffers(auctionId, termMonths=60)` and `selectTopOffers`
  (bestCash / bestMonthly / bestOverall). Weights from `BestPriceWeightConfig` (fallback defaults).
- `offer-validation.service.ts` — `validateOffer` (APR flag threshold `29.0`, junk-fee keywords).
- `junk-fee.service.ts`, `offer-revision.service.ts`, `outside-dealer.ts`
  (`getOrCreateOutsideDealerId` placeholder support).

**Routes & jobs**
- Dealer read (anonymized): `app/api/dealer/auctions/[auctionId]/route.ts`.
- Dealer offer submit/revise: `app/api/dealer/offers/**`, competitiveness: `.../competitiveness-check`.
- Buyer winner selection: `app/api/buyer/auctions/[auctionId]/select-offer/route.ts`.
- Cron: `app/api/cron/auction-close` (runs every 5 min — closes expired + reconciles CLOSED
  unprocessed auctions + sends dealer reminders). Jobs (QStash): `auction-active`, `auction-midpoint`,
  `auction-closing`, `dealer-invited`, `dealer-bid-reminder`, `offer-received`, `offer-follow-up`.

## 4. Core rules & invariants

1. **AuctionStatus** = `PENDING → ACTIVE → CLOSED`, off-path `EXPIRED | CANCELLED | REOPENED`.
   Only `ACTIVE` (with `endsAt` in the future) accepts offers. `launchAuction` moves
   `PENDING → ACTIVE` and stamps `startedAt`/`endsAt`. The close cron only closes `ACTIVE` +
   expired auctions.
2. **OfferStatus** (`Offer`) = `DRAFT → SUBMITTED`, then `ACCEPTED | DECLINED | WITHDRAWN | EXPIRED`.
   A dealer's live bid is `SUBMITTED`; a revision withdraws the prior (`WITHDRAWN`) and inserts a
   new SUBMITTED row (`version` +1, `originalOfferId` set). Winner = `ACCEPTED`.
3. **Ranking, validation, and winner logic live in the service layer, never in UI.** The UI renders
   what `rankOffers`/`selectTopOffers` return. Never compute prices, ranks, or "best" in a component.
4. **One live offer per dealer per auction.** `submitOffer` enforces this inside a **Serializable**
   transaction (invitation check → auction ACTIVE + not expired → no existing SUBMITTED → insert →
   mark invitation responded). Duplicate submissions must not create two rows. Use the revise
   endpoint to update.
5. **Server-side OTD integrity.** Components must sum to total: `vehiclePriceCents + taxCents +
   feesCents + junkFees == otdPriceCents` (±1¢). Reject negative junk-fee line items. Financing
   offers require `aprRate` (0–50) **and** `termMonths` (6–96). OTD must not exceed the buyer's
   approved `maxOtdAmountCents`. Money is always integer minor units (cents).
6. **Invitation gating.** A dealer can only view/bid on an auction they hold an `AuctionInvitation`
   for. Top 8 dealers by `scoreDealerForAuction` (tier bonus, capacity penalty, scorecard win
   rate/junk ratio), within `MAX_DISTANCE_MILES`, `status: "ACTIVE"`, `isSystemPlaceholder: false`.
7. **Idempotent auction close (F-001).** `processAuctionClose` atomically claims the auction via
   `updateMany(where postCloseProcessedAt: null → now())`; `postCloseClaimWon(count)` is true only
   when exactly one row flipped. Concurrent/duplicate invocations no-op. On side-effect failure the
   claim is **released** (`postCloseProcessedAt` back to null) so the cron retries; emails are
   idempotency-keyed so retries never double-send.
8. **No auto-refund at close.** The `$99` Auction Access Deposit is **not** auto-refunded when an
   auction closes with zero offers — it is retained as a non-refundable access fee; any refund is a
   deliberate admin action. Only notifications fire.
9. **Auction duration = `AUCTION_DURATION_HOURS` (48).** Extensions go through `requestExtension`
   (admin) and are logged in `AuctionExtensionLog` with original/new end.
10. **Early accept is explicit.** While an auction is still live, a buyer selecting an offer must
    pass `forceEarly: true` (audit-logged) — otherwise the request is rejected so competing dealers
    keep the chance to improve their offers.

## 5. Workflows

**Deposit → launch → invite (activation)**
1. Buyer pays the `$99` deposit; the Stripe webhook (or the `deposit-activation` reconciler)
   calls `createAuction(buyerId, depositId)` (status `PENDING`).
2. `launchAuction(auctionId)` → status `ACTIVE`, `startedAt = now`, `endsAt = now + 48h`; emits
   `auction_started` (tail call, non-fatal).
3. `inviteDealersToAuction` scores active nearby dealers, upserts up to 8 `AuctionInvitation`
   rows, increments `currentAuctionLoad`, notifies dealers (in-app + Resend + QStash reminders).
   The `deposit-activation` reconciler self-heals a stranded deposit (no auction / PENDING / zero
   invitations).

**Dealer submits / revises an offer**
1. Dealer loads the anonymized auction view (invitation-gated; budget range + offer count + own
   offer only — see dealer-marketplace skill).
2. `submitOffer` validates OTD sum, financing consistency, and buyer budget, then inserts one
   `SUBMITTED` `Offer` inside a Serializable txn; flags `aprFlag = "SUSPICIOUS_APR"` when APR > 29.
   Marks the invitation `respondedAt`; the buyer sees a **count** only (no amount/identity); a
   first-offer email fires once on 0→1 via `after()`.
3. `reviseOffer` (max 1 revision) merges + re-validates, atomically creates the new version and
   withdraws the original.

**Auction close → rank → select winner**
1. `app/api/cron/auction-close` (every 5 min) calls `closeExpiredAuctions` (ACTIVE + `endsAt <= now`
   → CLOSED), then `processAuctionClose` for every CLOSED auction with `postCloseProcessedAt = null`.
2. `processAuctionClose` claims atomically (F-001), releases dealer load, and — if offers exist —
   calls `rankOffers` and notifies the buyer (`sendOffersReadyEmail`); if zero offers, notifies
   buyer + invited dealers (no auto-refund).
3. Buyer selects via `select-offer`: guards against double-deal (only one `ACCEPTED` per auction),
   requires the offer be `SUBMITTED`, then in one txn creates the `Deal` (status `FINANCING_PENDING`),
   sets the chosen offer `ACCEPTED`, and closes the auction. Winner/lost dealer emails and CRM
   `offer_selected` fire off the request path.

**Best-price ranking**
- `rankOffers` computes, per SUBMITTED offer, `rankCash` (OTD asc), `rankMonthly` (financed only,
  amortized payment), `rankJunk`, and a weighted `overallScore` from `BestPriceWeightConfig`
  (defaults `weightOtd .4 / weightMonthly .25 / weightFees .2 / weightJunkFees .15`), then assigns
  `rankOverall`. `selectTopOffers` picks bestCash / bestMonthly / bestOverall for buyer comparison.

## 6. Boundaries — do / never

**Do**
- Keep all pricing/ranking/validation/winner logic in `lib/services/offer/**` and
  `lib/services/auction/**`; render results in the UI only.
- Wrap multi-row transitions (submit, revise, select-offer, activation) in transactions with the
  right isolation; use the F-001 atomic-claim pattern for any new post-close side effect.
- Validate all offer money as integer cents server-side and re-check against the buyer's budget.
- Run notifications, CRM/GHL sync, and AMIPS recording via `after()`/QStash so they never block or
  fail the transition.

**Never**
- Never accept an offer on a non-ACTIVE or expired auction, or a second live offer from the same
  dealer, or more than one revision.
- Never let a buyer end a live auction early without an explicit, audit-logged `forceEarly`.
- Never auto-refund the `$99` deposit at close; never move money on the request path without an
  idempotency guard.
- Never trust client-computed OTD, ranks, or the "best" offer; never expose one dealer's offer/price
  to another dealer.
- Never compute ranking in a React component or bypass `rankOffers`/`BestPriceWeightConfig`.
- Never invite/score the Outside Dealer placeholder or a non-`ACTIVE` dealer.

## 7. Best practices & examples

Atomic, idempotent post-close claim (`auction.service.ts` — F-001):
```ts
const claim = await prisma.auction.updateMany({
  where: { id: auctionId, postCloseProcessedAt: null },
  data: { postCloseProcessedAt: new Date() },
});
if (!postCloseClaimWon(claim.count)) return { offers: auction._count.offers }; // dup/concurrent → no-op
// ...side effects; on failure release the claim so the cron retries:
await prisma.auction.updateMany({ where: { id: auctionId }, data: { postCloseProcessedAt: null } });
```

One-live-offer-per-dealer, race-safe (`offer.service.ts`):
```ts
await prisma.$transaction(async (tx) => {
  const invitation = await tx.auctionInvitation.findFirst({ where: { auctionId, dealerId } });
  if (!invitation) throw new Error("Dealer not invited to this auction");
  const auction = await tx.auction.findUnique({ where: { id: auctionId } });
  if (!auction || auction.status !== "ACTIVE") throw new Error("Auction is not active");
  const existing = await tx.offer.findFirst({ where: { auctionId, dealerId, status: OfferStatus.SUBMITTED } });
  if (existing) throw new Error("Already submitted — use revise");
  return tx.offer.create({ data: { /* ...cents, aprFlag, status: SUBMITTED, version: 1 */ } });
}, { isolationLevel: "Serializable" });
```

Winner selection forms the deal + closes the auction in one txn (`select-offer/route.ts`):
```ts
await prisma.$transaction(async (tx) => {
  const deal = await tx.deal.create({ data: { buyerId, offerId: offer.id, status: "FINANCING_PENDING" } });
  await tx.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
  await tx.auction.update({ where: { id: auctionId }, data: { status: "CLOSED", closedAt: new Date() } });
  return deal;
});
```

## 8. Acceptance criteria

- [ ] Offer submit/revise/select run inside transactions with correct isolation; no path can create
      two live offers per dealer, two deals per auction, or more than one revision.
- [ ] All OTD/financing/budget validation is server-side in cents; components sum to OTD (±1¢);
      negative junk fees rejected; APR>29 flagged.
- [ ] Ranking/winner logic lives in `lib/services/**` and consumes `BestPriceWeightConfig`; no
      pricing math in components.
- [ ] Any new post-close side effect uses the F-001 atomic-claim + release-on-failure pattern and
      idempotency-keyed emails.
- [ ] Auctions only accept offers while `ACTIVE` and not past `endsAt`; enum transitions use exact
      `AuctionStatus`/`OfferStatus` values.
- [ ] Dealer views remain invitation-gated and anonymized; the `$99` deposit is never auto-refunded
      at close.
- [ ] Notifications/CRM/AMIPS run via `after()`/QStash and never fail the core transition.

## 9. Cross-skill links

- **autolenis-dealer-marketplace** — dealer eligibility, tier/capacity, and the dealer-side
  anonymization/isolation contract that feeds invitation scoring and the anonymized auction view.
- **autolenis-buyer-journey** — how a buyer reaches deposit/auction (VehicleRequestStatus, prequal
  budget that caps offers).
- **autolenis-payments-and-ledger** — the `$99` Auction Access Deposit, Stripe webhook idempotency,
  and refund policy.
- **autolenis-best-price-report** — buyer-facing presentation of ranked offers.
- **autolenis-domain-model** — Prisma model/enum source of truth for Auction/Offer/Deal.
- **autolenis-system-architecture** — transaction/idempotency rules, background-job model, "extend,
  never duplicate." Load FIRST.
