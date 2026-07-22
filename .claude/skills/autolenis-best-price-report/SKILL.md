---
name: autolenis-best-price-report
description: >-
  Authoritative guide for the AutoLenis Best Price Engine (System 4) — how dealer
  offers on an auction are ranked by Cash, Monthly, and Overall Value, how
  junk-fee detection and OTD math work, how admin-configurable weights are
  applied, and how the ranked report is exposed to buyers and logged. Use this
  skill when working on lib/services/offer (best-price.service.ts, junk-fee,
  offer-validation, offer-revision), the BestPriceWeightConfig /
  BestPriceCalculationLog / BestPriceWeightHistory models, the buyer/admin
  best-price API routes, or any task mentioning "best price report", "offer
  ranking", "OTD price", "junk fees", "monthly payment ranking", "APR flag", or
  "best price weights".
---

## Purpose & Authority

This skill owns the **Best Price Engine** — the ranking layer that turns a set
of submitted dealer offers on a closed/closing auction into a buyer-facing
report ordered by **Cash (OTD)**, **Monthly payment**, and a weighted **Overall
Value** score. It is the source of truth for the OTD/junk-fee/monthly math, the
weight-config resolution, and the calculation audit log. When generic guidance
about "sort by price" or "compute a score" conflicts with the exact weighting,
tie-breaking, junk-fee definition, or money-handling rules here, **this skill
wins**. The engine is deterministic, admin-tunable, and fully logged.

## When this skill activates

- Editing `frontend/lib/services/offer/best-price.service.ts`,
  `junk-fee.service.ts`, `offer-validation.service.ts`, `offer-revision.service.ts`,
  `offer.service.ts`, `outside-dealer.ts`.
- Editing routes: `frontend/app/api/buyer/auctions/[auctionId]/best-price/`,
  `frontend/app/api/admin/auctions/[auctionId]/best-price/run/`,
  `frontend/app/api/admin/best-price/weights/`,
  `frontend/app/api/public/outside-dealer-offer/[token]/`.
- Any task mentioning: best price report, offer ranking, OTD price, junk fees,
  monthly payment ranking, overall value score, APR flag, best-price weights.
- Touching `BestPriceWeightConfig`, `BestPriceCalculationLog`,
  `BestPriceWeightHistory`, or the `Offer` fields feeding the rank.

## Architecture & key files

**Engine:** `frontend/lib/services/offer/best-price.service.ts` — `rankOffers(auctionId,
termMonths = 60)` returns `RankedOffer[]` with `rankCash`, `rankMonthly`,
`rankOverall`, and `overallScore`. It:
- loads `Offer`s where `status === "SUBMITTED"` for the auction (includes dealer
  `id`, `tier`, `dealershipName`);
- computes monthly via amortization `calculateMonthly(principal, aprRate, months)`
  only when `includesFinancing && aprRate && termMonths`;
- sums `junkFeeItems` (JSON array of `{amount}`) per offer;
- resolves weights from the active `BestPriceWeightConfig`, falling back to
  defaults `weightOtd 0.4, weightMonthly 0.25, weightFees 0.2, weightJunkFees 0.15`.

**Junk fees:** `frontend/lib/services/offer/junk-fee.service.ts` — `detectJunkFees`
and `getTotalJunkFees`. Built-in keyword list (`nitrogen`, `nitro tire`, `vin
etch`, `paint protection`, `ppf`, `dealer prep`, `advertising`, `market
adjustment`) UNION active `JunkFeePattern.keywords` from the DB; case-insensitive
substring match on fee `name`.

**Offer fields (Prisma `Offer`):** `otdPriceCents Int`, `junkFeeItems Json`,
`includesFinancing Boolean`, `aprRate Float?`, `termMonths Int?`, `aprFlag
String?`, `bestPriceScore Float?`. Money is **integer minor units (cents)**.

**Config & audit models:**
- `BestPriceWeightConfig` (`best_price_weight_configs`) — `isActive`, the four
  weight floats, `createdBy`.
- `BestPriceCalculationLog` (`best_price_calculation_logs`) — `auctionId`,
  `termMonths`, `offerCount`, `weights` (Json), `result` (Json), `calculatedAt`.
- `BestPriceWeightHistory` — prior weight configs for audit.

**Routes:** buyer read at `app/api/buyer/auctions/[auctionId]/best-price/route.ts`;
admin re-run at `app/api/admin/auctions/[auctionId]/best-price/run/route.ts`;
admin weight config at `app/api/admin/best-price/weights/route.ts`; outside-dealer
offer intake at `app/api/public/outside-dealer-offer/[token]/route.ts`.

## Core rules & invariants

1. **Only `SUBMITTED` offers are ranked.** `DRAFT`, `ACCEPTED`, `DECLINED`,
   `WITHDRAWN`, `EXPIRED` offers are excluded from the report.
2. **Money is always integer cents.** `otdPriceCents`, junk-fee `amount`s, and
   totals never use floats/dollars. Never round dollars then convert.
3. **Rank 1 = best.** Ranks are 1-indexed ascending: lowest OTD → best cash;
   lowest monthly → best monthly; lowest junk fees → best on fees.
4. **Monthly rank only includes finance-capable offers.** An offer without
   `includesFinancing`/`aprRate`/`termMonths` has no monthly and is excluded from
   the monthly ordering (it must not silently rank #1).
5. **Junk fees are the built-in keyword set UNION active `JunkFeePattern`
   rows.** Detection is case-insensitive substring on the fee name. Do not
   hard-code a divergent list elsewhere.
6. **Weights come from the active `BestPriceWeightConfig`, else the documented
   defaults** (`0.4 / 0.25 / 0.2 / 0.15`). Never inline different magic weights.
7. **Every calculation is logged** to `BestPriceCalculationLog` with the exact
   `weights`, `offerCount`, `termMonths`, and `result` used — the report must be
   reproducible from the log.
8. **The engine is deterministic and read-only over offers.** Ranking never
   mutates `Offer.status`; accepting an offer is a separate action.
9. **Weight changes are versioned** — write `BestPriceWeightHistory` and record
   `createdBy` on any `BestPriceWeightConfig` change (admin-only, server-authz).
10. **`aprFlag` is surfaced, not fabricated.** Carry the stored flag through;
    don't invent APR judgments in the ranking layer.

## Workflows

**Rank offers for a report:**
1. Auction reaches `CLOSED` (see `AuctionStatus`: `PENDING → ACTIVE → CLOSED`).
2. Call `rankOffers(auctionId, termMonths)`.
3. Engine loads `SUBMITTED` offers, computes monthly (finance-capable only) and
   junk-fee totals, resolves active weights (or defaults).
4. Produces `rankCash`, `rankMonthly`, `rankOverall`, `overallScore`.
5. Persist a `BestPriceCalculationLog` row (weights + result snapshot).
6. Expose the ranked set to the buyer via the buyer best-price route.

**Admin re-run / retune:** admin adjusts weights at `/api/admin/best-price/weights`
(write `BestPriceWeightHistory`, set `isActive`), then re-runs via
`/api/admin/auctions/[auctionId]/best-price/run`. Each run appends a fresh
`BestPriceCalculationLog` — history is append-only, not overwritten.

**Junk-fee tagging:** `detectJunkFees(feeItems)` tags each `{name, amount}` with
`isJunk`; `getTotalJunkFees` sums the junk subset. Feeds both the report and
Contract Shield's fee scrutiny.

## Boundaries — do / never

**Do:**
- Keep all ranking math inside `best-price.service.ts` and junk detection inside
  `junk-fee.service.ts`.
- Resolve weights from `BestPriceWeightConfig`; log every calculation.
- Add new junk keywords via `JunkFeePattern` rows, not scattered constants.
- Enforce admin JWT + server-side authz on weight and re-run routes.

**Never:**
- Never rank non-`SUBMITTED` offers or mutate offer status while ranking.
- Never use dollars/floats for money; never round before converting to cents.
- Never let a non-finance offer occupy the monthly ranking.
- Never inline weights that diverge from the active config/defaults.
- Never emit a report without a `BestPriceCalculationLog` row.
- Never overwrite prior weight configs without a `BestPriceWeightHistory` entry.
- Never build a second ranking system — extend `best-price.service.ts`.

## Best practices & examples

Weight resolution with the canonical fallback:
```ts
const weightConfig =
  await prisma.bestPriceWeightConfig.findFirst({ where: { isActive: true } })
  ?? { weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15 };
```

Junk-fee total (single source of truth):
```ts
const junkFeesCents = (o.junkFeeItems as Array<{ amount: number }> | null)
  ?.reduce((s, f) => s + f.amount, 0) ?? 0;
```

Always log the calculation so the buyer's report is reproducible:
```ts
await prisma.bestPriceCalculationLog.create({
  data: { auctionId, termMonths, offerCount: offers.length, weights, result },
});
```

## Acceptance criteria

- [ ] Only `SUBMITTED` offers enter the ranking.
- [ ] All money stays in integer cents end-to-end.
- [ ] Monthly ranking excludes non-finance offers; ranks are 1-indexed (1=best).
- [ ] Junk detection = built-in keywords ∪ active `JunkFeePattern`, case-insensitive.
- [ ] Weights come from active `BestPriceWeightConfig` or the documented defaults.
- [ ] A `BestPriceCalculationLog` row is written for every run with exact weights.
- [ ] Ranking does not mutate `Offer.status`.
- [ ] Weight changes are admin-only, server-authz'd, and versioned via
      `BestPriceWeightHistory` with `createdBy`.
- [ ] `aprFlag` is carried through, not fabricated.
- [ ] No parallel ranking/junk implementation introduced.

## Cross-skill links

- `autolenis-auction-engine` — auction lifecycle that produces the offers ranked
  here (`AuctionStatus`, `OfferStatus`).
- `autolenis-dealer-marketplace` — how dealers submit/revise offers and dealer
  tiers.
- `autolenis-contract-shield` — reuses junk-fee detection for fee scrutiny.
- `autolenis-buyer-journey` — where the buyer views the report (auction stage).
- `autolenis-payments-and-ledger` — OTD/fee money handling conventions.
- `autolenis-domain-model` — `Offer`, `BestPrice*` models and enums.
- `autolenis-master` — platform-wide standards.
