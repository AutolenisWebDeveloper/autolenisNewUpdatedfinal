// lib/services/offer/best-price.service.ts
// System 4 — Best Price Engine: ranks offers by Cash, Monthly, Overall Value
// Weights from BestPriceWeightConfig (admin-configurable, fallback to defaults)

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { normalizeJunkFeeItems, junkFeeTotalCents } from "./junk-fee-items";
import { qualifiedOfferWhere } from "./offer-validity";
import { compareOffers, assignRanks, overallScore, type RankableOffer } from "./ranking";

/**
 * One offer as the Best Price Report sees it.
 *
 * The rank fields are WITHIN-CANDIDATE (§8c: "Rank within a candidate…"), because comparing a
 * $31,000 Accord against a $47,000 Highlander on price alone is not a comparison — the buyer put
 * both on the auction precisely because they are different cars. `rankCrossCandidate` is the
 * separate question §8c asks across candidates, and it is answered on DISCOUNT rather than price.
 */
export interface RankedOffer {
  offerId: string;
  dealerId: string;
  dealerTier: string;
  /** The candidate this offer answers; `null` on a custom request (§8c / parity row C3b). */
  auctionVehicleId: string | null;
  otdPriceCents: number;
  /** Non-junk fees. Separated from junk fees because §8c weights them separately. */
  feesCents: number;
  junkFeesCents: number;
  /** INTEGER MINOR UNITS, like every other money field on this type. */
  monthlyPayment?: number;
  /**
   * The term the DEALERSHIP quoted, which is the term `monthlyPayment` was computed at.
   *
   * Carried because the report has to SAY it. The buyer-facing panel used to label the payment
   * with a comparison term chosen in the UI while the number came from this one, so toggling to
   * 36mo relabelled a 72-month payment.
   */
  monthlyTermMonths?: number | null;
  aprFlag?: string | null;
  aprRate?: number | null;
  distanceMiles: number | null;
  featureMatchScore: number | null;
  submittedAt: Date | null;
  expiresAt: Date | null;

  // Within-candidate ranks. 1 = best; EQUAL VALUES SHARE A NUMBER (§8c).
  rankCash: number;
  /** `null` for an offer with no financing — §8c: non-finance offers never occupy monthly rank. */
  rankMonthly: number | null;
  rankFees: number;
  rankJunkFees: number;
  rankOverall: number;
  overallScore: number;
  /** Offers sharing this offer's OVERALL rank. Empty when nothing ties. */
  tiedWith: string[];

  // Cross-candidate (§8c): how good a deal is this, on a different car?
  /** Listed price minus out-the-door, when the candidate carries a listed price. */
  discountToListedCents: number | null;
  discountToListedPct: number | null;
  rankCrossCandidate: number | null;
}

function calculateMonthly(principal: number, aprRate: number, months: number): number {
  const r = aprRate / 12 / 100;
  if (r === 0) return Math.round(principal / months);
  return Math.round(principal * r / (1 - Math.pow(1 + r, -months)));
}

export interface RankOffersOptions {
  /**
   * Persist the ranking: one `BestPriceCalculationLog` row AND the per-offer rank columns.
   * Default false.
   *
   * Only the canonical/terminal callers (auction close-processing, the admin explicit re-run) opt
   * in — the buyer best-price GET is polled on every load, so persisting there would append an
   * unbounded stream of near-identical rows and, on serverless, may not even flush after the
   * response. Parity row C8: ONE STORE. The log and the per-offer columns are now written
   * together by the same call, rather than the log at close and the columns only by the admin
   * re-run, which is how the two could disagree about the same auction.
   */
  persistLog?: boolean;
}

/** The listed market price a candidate was captured at, for the cross-candidate discount. */
interface CandidateFacts {
  distanceMiles: number | null;
  listedPriceCents: number | null;
}

function candidateFactsOf(candidate: {
  distanceMiles: number | null;
  listingSnapshot: unknown;
  inventoryItem: { priceCents: number } | null;
} | null): CandidateFacts {
  if (!candidate) return { distanceMiles: null, listedPriceCents: null };
  const snap = (candidate.listingSnapshot ?? {}) as { priceCents?: number | null; distanceMiles?: number | null };
  return {
    // The candidate column first: it is what Stage 6 computed for THIS buyer. The snapshot's copy
    // is the fallback for rows written before the column was populated.
    distanceMiles: candidate.distanceMiles ?? snap.distanceMiles ?? null,
    // The SNAPSHOT price first, deliberately. It is the price the listing carried when the buyer
    // chose this candidate; `inventoryItem.priceCents` is today's, and a dealership that cut its
    // sticker mid-auction would otherwise shrink every competitor's measured discount.
    listedPriceCents: snap.priceCents ?? candidate.inventoryItem?.priceCents ?? null,
  };
}

export async function rankOffers(
  auctionId: string,
  termMonths = 60,
  opts: RankOffersOptions = {},
): Promise<RankedOffer[]> {
  const offers = await prisma.offer.findMany({
    // QUALIFIED ONLY. This used to be `status: "SUBMITTED"` alone, so a §13-D40 over-ceiling offer
    // and a lapsed one were both ranked and both shown — §8c says a disqualified offer is "never
    // presented as qualified", and a lapsed one commits a dealership to a price it withdrew.
    where: { auctionId, ...qualifiedOfferWhere() },
    include: {
      dealer: { select: { id: true, tier: true, dealershipName: true } },
      auctionVehicle: {
        select: {
          id: true,
          distanceMiles: true,
          listingSnapshot: true,
          inventoryItem: { select: { priceCents: true } },
        },
      },
    },
  });

  if (!offers.length) return [];

  // Persisted weights (§8c: "with persisted weights"), admin-configurable with a coded fallback.
  const weightConfig = await prisma.bestPriceWeightConfig.findFirst({ where: { isActive: true } })
    ?? { weightOtd: 0.4, weightMonthly: 0.25, weightFees: 0.2, weightJunkFees: 0.15 };

  const metrics = offers.map((o) => {
    const monthly = o.includesFinancing && o.aprRate && o.termMonths
      ? calculateMonthly(o.otdPriceCents, o.aprRate, o.termMonths)
      : undefined;

    // §8.2 defect 1: this read `f.amount` — the DOLLARS field — into a variable named
    // `junkFeesCents`, while `otd.ts` multiplied the same field by 100. A 100x divergence on one
    // untyped Json column, which made every junk-fee ranking understated by two orders of
    // magnitude. Both sides now go through `junk-fee-items.ts`, which owns the representation.
    const junkFeesCents = junkFeeTotalCents(normalizeJunkFeeItems(o.junkFeeItems));
    const facts = candidateFactsOf(o.auctionVehicle);
    const featureMatchScore = featureScoreOf(o.requiredFeatureMatches, o.requiredFeatureMismatches);
    const discountToListedCents =
      facts.listedPriceCents === null ? null : facts.listedPriceCents - o.otdPriceCents;

    return {
      offer: o,
      monthly,
      junkFeesCents,
      distanceMiles: facts.distanceMiles,
      featureMatchScore,
      discountToListedCents,
      discountToListedPct:
        facts.listedPriceCents && facts.listedPriceCents > 0 && discountToListedCents !== null
          ? discountToListedCents / facts.listedPriceCents
          : null,
      rankable: {
        offerId: o.id,
        otdPriceCents: o.otdPriceCents,
        featureMatchScore,
        distanceMiles: facts.distanceMiles,
        submittedAt: o.submittedAt,
      } satisfies RankableOffer,
    };
  });

  const byId = new Map(metrics.map((m) => [m.offer.id, m]));

  // ── WITHIN-CANDIDATE (§8c "Rank within a candidate…") ───────────────────────────────────────
  //
  // Grouped on `auction_vehicle_id`, which Phase 6 finally writes. Before this every offer on the
  // auction was ranked in one pool, so on a two-candidate auction the cheaper CAR won every rank
  // and the dealership with the best offer on the other candidate was reported as #3 of 3 — a
  // comparison the buyer never asked for, since they put both cars up precisely because they are
  // different. A custom request has no candidates and forms a single group keyed on `null`.
  const groups = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const key = m.offer.auctionVehicleId ?? "__custom__";
    const g = groups.get(key);
    if (g) g.push(m); else groups.set(key, [m]);
  }

  const ranks = new Map<string, {
    rankCash: number; rankMonthly: number | null; rankFees: number; rankJunkFees: number;
    rankOverall: number; overallScore: number; tiedWith: string[];
  }>();

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => compareOffers(a.rankable, b.rankable)).map((m) => m.rankable);
    const n = ordered.length;

    const cash = assignRanks(ordered, (o) => byId.get(o.offerId)!.offer.otdPriceCents);
    const monthlyRanks = assignRanks(ordered, (o) => byId.get(o.offerId)!.monthly ?? null);
    const fees = assignRanks(ordered, (o) => byId.get(o.offerId)!.offer.feesCents);
    const junk = assignRanks(ordered, (o) => byId.get(o.offerId)!.junkFeesCents);
    const monthlyCount = monthlyRanks.size;

    const scored = ordered.map((o) => ({
      offerId: o.offerId,
      score: overallScore([
        { rank: cash.get(o.offerId)!.rank, count: n, weight: weightConfig.weightOtd },
        { rank: monthlyRanks.get(o.offerId)?.rank ?? null, count: monthlyCount, weight: weightConfig.weightMonthly },
        // §8c asks for fees and junk fees as SEPARATE ranks. The old engine added the two weights
        // together and applied the sum to one junk-fee rank, so `weightFees` — 20% of the
        // configured model — was spent on a dimension the administrator never pointed it at, and
        // total fees were never ranked at all.
        { rank: fees.get(o.offerId)!.rank, count: n, weight: weightConfig.weightFees },
        { rank: junk.get(o.offerId)!.rank, count: n, weight: weightConfig.weightJunkFees },
      ]),
    }));
    const scoreById = new Map(scored.map((sc) => [sc.offerId, sc.score]));
    // Scores are floats; two offers that are equal on every ranked dimension must land on the same
    // overall rank rather than on whichever bit of floating-point noise the arithmetic produced.
    const overall = assignRanks(ordered, (o) => Math.round(scoreById.get(o.offerId)! * 1e6));

    for (const o of ordered) {
      ranks.set(o.offerId, {
        rankCash: cash.get(o.offerId)!.rank,
        rankMonthly: monthlyRanks.get(o.offerId)?.rank ?? null,
        rankFees: fees.get(o.offerId)!.rank,
        rankJunkFees: junk.get(o.offerId)!.rank,
        rankOverall: overall.get(o.offerId)!.rank,
        overallScore: scoreById.get(o.offerId)!,
        tiedWith: overall.get(o.offerId)!.tiedWith,
      });
    }
  }

  // ── CROSS-CANDIDATE (§8c, parity row C7) ────────────────────────────────────────────────────
  //
  // "Cross-candidate ranking on discount to listed market price and monthly payment." DISCOUNT,
  // not price, and that is the whole point: across different cars the cheapest offer is simply the
  // cheapest car, which the buyer already knew. What they cannot see is which dealership is giving
  // up the most against what the vehicle is listed at.
  //
  // Measured as a PERCENTAGE. $1,500 off a $25,000 sedan and $1,500 off a $70,000 truck are not
  // the same concession, and ranking them equal would flatter the truck.
  //
  // Offers on candidates with no captured listed price are excluded rather than ranked last: an
  // unknown discount is not a small one.
  const crossOrdered = [...metrics].sort((a, b) => compareOffers(a.rankable, b.rankable)).map((m) => m.rankable);
  const cross = assignRanks(crossOrdered, (o) => {
    const m = byId.get(o.offerId)!;
    if (m.discountToListedPct === null) return null;
    // Negated so a LARGER discount is a lower (better) rank key, matching every other dimension.
    return -Math.round(m.discountToListedPct * 1e6);
  });

  const ranked: RankedOffer[] = metrics.map((m) => {
    const r = ranks.get(m.offer.id)!;
    return {
      offerId: m.offer.id,
      dealerId: m.offer.dealerId,
      dealerTier: m.offer.dealer.tier,
      auctionVehicleId: m.offer.auctionVehicleId,
      otdPriceCents: m.offer.otdPriceCents,
      feesCents: m.offer.feesCents,
      junkFeesCents: m.junkFeesCents,
      monthlyPayment: m.monthly,
      monthlyTermMonths: m.monthly != null ? m.offer.termMonths : null,
      aprFlag: m.offer.aprFlag,
      aprRate: m.offer.aprRate,
      distanceMiles: m.distanceMiles,
      featureMatchScore: m.featureMatchScore,
      submittedAt: m.offer.submittedAt,
      expiresAt: m.offer.expiresAt,
      rankCash: r.rankCash,
      rankMonthly: r.rankMonthly,
      rankFees: r.rankFees,
      rankJunkFees: r.rankJunkFees,
      rankOverall: r.rankOverall,
      overallScore: r.overallScore,
      tiedWith: r.tiedWith,
      discountToListedCents: m.discountToListedCents,
      discountToListedPct: m.discountToListedPct,
      rankCrossCandidate: cross.get(m.offer.id)?.rank ?? null,
    };
  });

  // Returned in the deterministic order, so a caller that renders the array as-is renders the
  // same list every time.
  ranked.sort((a, b) => compareOffers(byId.get(a.offerId)!.rankable, byId.get(b.offerId)!.rankable));

  if (opts.persistLog) {
    await persistRanking(auctionId, termMonths, weightConfig, ranked);
  }

  return ranked;
}

/** §8a A17b's persisted match, as the ranking's signed key. `null` stays unknown. */
function featureScoreOf(matches: unknown, mismatches: unknown): number | null {
  if (!Array.isArray(matches) || !Array.isArray(mismatches)) return null;
  return matches.length - mismatches.length;
}

/**
 * Parity row C8 — ONE STORE, written once by the terminal callers.
 *
 * Both halves in one transaction. Before, the log was written at close and the per-offer
 * `bestPriceScore/rankCash/rankMonthly/rankBalanced` columns ONLY by the admin re-run, so the two
 * records of the same auction could disagree and nobody could tell which was current.
 *
 * NO LONGER SWALLOWED. The insert ended in `.catch(() => {})`, so "the buyer-facing Best Price
 * cards are reproducible and never a black box" quietly became "…unless the insert failed, in
 * which case there is no record at all and no trace of that either". It is best-effort at the
 * CALLER (`processAuctionClose` logs and continues), which is a decision the caller can see.
 */
async function persistRanking(
  auctionId: string,
  termMonths: number,
  weights: { weightOtd: number; weightMonthly: number; weightFees: number; weightJunkFees: number },
  ranked: readonly RankedOffer[],
): Promise<void> {
  await prisma.$transaction([
    prisma.bestPriceCalculationLog.create({
      data: {
        auctionId,
        termMonths,
        offerCount: ranked.length,
        weights: {
          weightOtd: weights.weightOtd,
          weightMonthly: weights.weightMonthly,
          weightFees: weights.weightFees,
          weightJunkFees: weights.weightJunkFees,
        },
        result: ranked.map((r) => ({
          offerId: r.offerId,
          auctionVehicleId: r.auctionVehicleId,
          otdPriceCents: r.otdPriceCents,
          feesCents: r.feesCents,
          junkFeesCents: r.junkFeesCents,
          monthlyPayment: r.monthlyPayment ?? null,
          // Persisted per offer, because the log's single `term_months` column records the term the
          // ranking was REQUESTED at while each payment came from the dealership's own quoted
          // term. Without this the row cannot be reproduced.
          monthlyTermMonths: r.monthlyTermMonths ?? null,
          distanceMiles: r.distanceMiles,
          featureMatchScore: r.featureMatchScore,
          rankCash: r.rankCash,
          rankMonthly: r.rankMonthly,
          rankFees: r.rankFees,
          rankJunkFees: r.rankJunkFees,
          rankOverall: r.rankOverall,
          overallScore: r.overallScore,
          tiedWith: r.tiedWith,
          discountToListedCents: r.discountToListedCents,
          discountToListedPct: r.discountToListedPct,
          rankCrossCandidate: r.rankCrossCandidate,
        })) as unknown as Prisma.InputJsonValue,
      },
    }),
    ...ranked.map((r) =>
      prisma.offer.update({
        where: { id: r.offerId },
        data: {
          rankCash: r.rankCash,
          rankMonthly: r.rankMonthly,
          rankBalanced: r.rankOverall,
          bestPriceScore: r.overallScore,
        },
      }),
    ),
  ]);
}

/**
 * The persisted ranking for an auction, newest first — parity row C9's "the buyer report is the
 * engine output".
 *
 * The buyer route serves THIS rather than recomputing, so the report a buyer reads is the same
 * ranking the close committed and the same one an operator sees in the audit row. Returns `null`
 * when no ranking has been persisted yet (an auction still live, or one closed before Phase 6).
 */
export async function getPersistedRanking(
  auctionId: string,
): Promise<{ termMonths: number; weights: unknown; ranked: PersistedRankedOffer[] } | null> {
  const log = await prisma.bestPriceCalculationLog.findFirst({
    where: { auctionId },
    orderBy: { calculatedAt: "desc" },
  });
  if (!log || !Array.isArray(log.result)) return null;
  return {
    termMonths: log.termMonths,
    weights: log.weights,
    ranked: log.result as unknown as PersistedRankedOffer[],
  };
}

/**
 * THE BUYER'S BEST PRICE REPORT — parity row C9's "the buyer report is the engine output".
 *
 * WHAT THIS REPLACED. `app/api/buyer/auctions/[auctionId]/best-price/route.ts` carried a SECOND
 * ranking implementation: it re-sorted the offers itself, recomputed monthly payments with a
 * fabricated `DEFAULT_APR_RATE = 7` for offers that carry no APR, picked "Best Overall" from the
 * engine but "Best Cash" and "Best Monthly" from its own arithmetic, and assigned the #1/#2/#3
 * badges by out-the-door with ties broken "by card order". A buyer and an operator could look at
 * the same auction and see different winners.
 *
 * SERVED FROM THE PERSISTED RANKING WHERE ONE EXISTS, so the report is the same one the close
 * committed and the same one the audit row records — re-ranking on every page load would let a
 * report change under a buyer who is reading it. The ranks come from the log; the offer rows are
 * still read for the facts the log does not carry (dealer tier, APR flags, the OTD breakdown,
 * response time), because those are properties of the offer rather than of the ranking.
 *
 * A live auction has no persisted ranking and is ranked on the fly — that is the "preliminary"
 * report §Stage 7 allows, and it is explicitly labelled as such by the route.
 */
export async function getBestPriceReport(
  auctionId: string,
  termMonths: number,
): Promise<{ ranked: RankedOffer[]; source: "persisted" | "live" }> {
  const persisted = await getPersistedRanking(auctionId);
  if (!persisted || persisted.ranked.length === 0) {
    return { ranked: await rankOffers(auctionId, termMonths), source: "live" };
  }

  // THE LOG IS THE AUTHORITY ON RANKS, NEVER ON WHETHER AN OFFER STILL STANDS.
  //
  // The ranking is committed at close and the buyer reads it over the following 72 hours, during
  // which an offer can lapse (`expires_at`), be withdrawn, or be disqualified by a §13-D40
  // re-evaluation. Rendering the log alone would keep showing it as qualified — and the select
  // route would then refuse it with OFFER_EXPIRED or OFFER_DISQUALIFIED, which is the buyer
  // discovering by rejection what the report should have stopped showing. The live re-read applies
  // the same qualification predicate as the close and the selection gate.
  const offers = await prisma.offer.findMany({
    where: { id: { in: persisted.ranked.map((r) => r.offerId) }, ...qualifiedOfferWhere() },
    include: { dealer: { select: { id: true, tier: true } } },
  });
  const byId = new Map(offers.map((o) => [o.id, o]));

  const ranked = persisted.ranked
    .filter((r) => byId.has(r.offerId))
    .map((r) => {
      const o = byId.get(r.offerId)!;
      return {
        ...r,
        dealerId: o.dealerId,
        dealerTier: o.dealer.tier,
        aprFlag: o.aprFlag,
        aprRate: o.aprRate,
        submittedAt: o.submittedAt,
        expiresAt: o.expiresAt,
      } satisfies RankedOffer;
    });

  return { ranked, source: "persisted" };
}

/** The shape `persistRanking` writes into `best_price_calculation_logs.result`. */
export type PersistedRankedOffer = Omit<RankedOffer, "dealerId" | "dealerTier" | "aprFlag" | "aprRate" | "submittedAt" | "expiresAt">;

/**
 * The three canonical cards on the Best Price Report — Best Cash, Best Monthly, Best Overall.
 *
 * AUCTION-LEVEL, not per-candidate, and that distinction now matters. `rankCash === 1` used to
 * identify one offer because every offer on the auction was ranked in one pool; with §8c's
 * within-candidate ranking there is a rank-1 offer per candidate, so picking "the first row whose
 * rank is 1" would hand the Best Cash card to whichever candidate happened to sort first.
 *
 * The cards are therefore chosen across the whole auction on the underlying VALUE, with
 * `compareOffers` settling ties — which is the order `rankOffers` already returns, so the best cash
 * offer is simply the first row.
 */
export function selectTopOffers(ranked: RankedOffer[]): {
  bestCash: RankedOffer | null;
  bestMonthly: RankedOffer | null;
  bestOverall: RankedOffer | null;
} {
  if (!ranked.length) return { bestCash: null, bestMonthly: null, bestOverall: null };

  // `ranked` arrives in `compareOffers` order: lowest out-the-door first, ties already settled.
  const bestCash = ranked[0];

  // §8c's preserved rule: a non-finance offer never occupies monthly rank, so it can never be the
  // Best Monthly card either. Absent any financed offer the card is genuinely absent.
  const financed = ranked.filter((r) => r.monthlyPayment != null);
  const bestMonthly = financed.length
    ? financed.reduce((a, b) => (b.monthlyPayment! < a.monthlyPayment! ? b : a))
    : null;

  // ── BEST OVERALL, AND WHY IT IS NOT SIMPLY THE LOWEST SCORE ────────────────────────────────
  //
  // `overallScore` is a WITHIN-CANDIDATE normalised rank: an offer's position among the other
  // offers on the same car. Comparing those numbers across candidates is comparing positions in
  // different races. Found by review, with the case that makes it plain: a candidate answered by
  // ONE dealership has no ranking to speak of, so its sole offer scores neutral (0.5) while the
  // winner of a two-offer race on another candidate scores 0.0 — and the card goes to the second
  // one for having had a rival to beat, however much better the first deal was.
  //
  // So the question is answered with the measure that IS cross-candidate, and §8c already names
  // it: "cross-candidate ranking on discount to listed market price". Across different cars, the
  // best overall value is the deepest concession against what the vehicle is listed at.
  //
  // On a single-candidate auction (and on a custom request) every offer is in one race, the
  // within-candidate score is exactly the right comparison, and it is used.
  const groups = new Set(ranked.map((r) => r.auctionVehicleId ?? "__custom__"));
  const crossCandidate = ranked.filter((r) => r.rankCrossCandidate != null);
  const bestOverall =
    groups.size > 1 && crossCandidate.length > 0
      ? crossCandidate.reduce((a, b) => (b.rankCrossCandidate! < a.rankCrossCandidate! ? b : a))
      : ranked.reduce((a, b) => (b.overallScore < a.overallScore ? b : a));

  return { bestCash, bestMonthly, bestOverall };
}
