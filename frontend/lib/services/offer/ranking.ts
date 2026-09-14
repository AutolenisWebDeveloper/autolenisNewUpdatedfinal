// lib/services/offer/ranking.ts
//
// §8c's RANKING RULES, as pure functions — the comparator, the equal-rank assignment, and the
// weighted overall score. Separated from `best-price.service.ts` because every one of them is a
// decision about fairness between dealerships, and a decision like that should be readable and
// exhaustively testable without a database.
//
// §8c, not paraphrased: "Ties are broken deterministically: lowest out-the-door, then best
// required-feature match, then shortest distance, then earliest submission. Equal-value results
// are presented honestly as equal."
//
// THOSE ARE TWO SEPARATE REQUIREMENTS AND THE OLD ENGINE MET NEITHER.
//
//   ORDER. `findIndex` over a single-key sort returned the position of the first row with a
//   matching id in an array whose order came from the database (`orderBy otdPriceCents`), so two
//   offers at the same price were ordered by whatever Postgres returned that day. Re-running the
//   ranking could reorder them; the buyer's report was not reproducible.
//
//   PRESENTATION. Every offer got a distinct rank because the rank WAS the array index. Two
//   identical $30,000 offers were shown as #1 and #2, which tells the buyer one is better when
//   nothing distinguishes them — and hands the #1 badge to whichever dealership the database
//   happened to return first.
//
// The two are solved separately here: `compareOffers` gives a total, reproducible ORDER, and
// `assignRanks` gives the RANK NUMBER, which is equal wherever the ranked dimension is equal. An
// offer's position in the list and its badge are allowed to disagree, and they must.
//
// Run: pnpm test:offer

/** The inputs the §8c tie-break reads. Everything nullable is genuinely unknown in production. */
export interface RankableOffer {
  offerId: string;
  otdPriceCents: number;
  /** §8a A17b, computed at submit. `null` = the vehicle's feature list was never established. */
  featureMatchScore: number | null;
  /** `auction_vehicles.distance_miles`, or the listing snapshot's. */
  distanceMiles: number | null;
  submittedAt: Date | null;
}

/**
 * UNKNOWN VALUES, AND WHY EACH ONE IS HANDLED DIFFERENTLY.
 *
 * A comparator has to be a TOTAL ORDER — transitive and antisymmetric — or `sort` produces
 * different output for different input permutations, which is exactly the reproducibility defect
 * this replaces. "Skip this key when either side is unknown" is the intuitive rule and it is not
 * transitive: with a=1, b=unknown, c=2, a ties b and b ties c while a beats c.
 *
 * So each key maps unknown onto a definite position, chosen per key on what it means:
 *
 *   FEATURE MATCH → 0. The scale is signed and centred: matches minus mismatches. Zero is the
 *   genuine midpoint (as many matches as misses), so an unestablished list neither wins nor loses
 *   a tie on a fact nobody knows. This is the same rule `feature-match.ts` enforces when it
 *   refuses to record an empty feed as a sheet of mismatches.
 *
 *   DISTANCE → last. The key exists to prefer a dealership the buyer can more easily reach. We
 *   cannot say that of an unknown distance, so it does not get the benefit — but it only applies
 *   after price and feature match have already tied.
 *
 *   SUBMISSION TIME → last. "Earliest submission" rewards answering promptly; an offer with no
 *   recorded time cannot claim it.
 */
const UNKNOWN_FEATURE_SCORE = 0;

function featureKey(o: RankableOffer): number {
  return o.featureMatchScore ?? UNKNOWN_FEATURE_SCORE;
}

/**
 * §8c's tie-break, in the stated order, with `offerId` last.
 *
 * `offerId` is NOT a fifth tie-break rule — §8c has four. It is the stabiliser that makes the
 * order total when all four keys are equal, so the same set of offers always produces the same
 * list. Two offers that reach it are genuinely equal, and `assignRanks` gives them the same rank
 * number however this happens to order them.
 */
export function compareOffers(a: RankableOffer, b: RankableOffer): number {
  // 1. lowest out-the-door
  if (a.otdPriceCents !== b.otdPriceCents) return a.otdPriceCents - b.otdPriceCents;

  // 2. best required-feature match (higher is better)
  const fa = featureKey(a);
  const fb = featureKey(b);
  if (fa !== fb) return fb - fa;

  // 3. shortest distance (unknown last)
  const da = a.distanceMiles;
  const db = b.distanceMiles;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }

  // 4. earliest submission (unknown last)
  const sa = a.submittedAt?.getTime() ?? null;
  const sb = b.submittedAt?.getTime() ?? null;
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  }

  // Total-order stabiliser only.
  return a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0;
}

export interface RankAssignment {
  /** 1 = best. Offers with an equal key share a number. */
  rank: number;
  /** The other offers sharing this rank. Empty when nothing ties. */
  tiedWith: string[];
}

/**
 * Competition ranking on one dimension: equal keys share a rank, and the next distinct key skips
 * the numbers they consumed (1, 1, 3 — never 1, 1, 2).
 *
 * `keyOf` returns `null` for an offer the dimension does not apply to — a cash offer has no
 * monthly payment — and those are EXCLUDED rather than ranked last. §8c's engine rule, preserved
 * from the route this replaces: "non-finance offers never occupy monthly rank". Ranking them worst
 * would say a dealership offering cash terms lost on monthly payment, which is not a comparison
 * anyone made.
 *
 * The ORDER comes from `compareOffers` (already applied by the caller), so two offers equal on
 * this dimension still appear in a reproducible sequence.
 */
export function assignRanks(
  ordered: readonly RankableOffer[],
  keyOf: (o: RankableOffer) => number | null,
): Map<string, RankAssignment> {
  const applicable = ordered.filter((o) => keyOf(o) !== null);
  const sorted = [...applicable].sort((a, b) => {
    const ka = keyOf(a)!;
    const kb = keyOf(b)!;
    return ka !== kb ? ka - kb : compareOffers(a, b);
  });

  const out = new Map<string, RankAssignment>();
  let i = 0;
  while (i < sorted.length) {
    const key = keyOf(sorted[i])!;
    const group: string[] = [];
    while (i < sorted.length && keyOf(sorted[i])! === key) {
      group.push(sorted[i].offerId);
      i++;
    }
    const rank = i - group.length + 1;
    for (const id of group) {
      out.set(id, { rank, tiedWith: group.filter((g) => g !== id) });
    }
  }
  return out;
}

export interface OverallWeights {
  weightOtd: number;
  weightMonthly: number;
  weightFees: number;
  weightJunkFees: number;
}

export interface OverallTerm {
  /** This offer's rank on the dimension, or `null` when the dimension does not apply to it. */
  rank: number | null;
  /** How many offers were ranked on the dimension. */
  count: number;
  weight: number;
}

/**
 * A rank's position on a 0–1 scale, where 0 is best. This is the arithmetic the weighted score is
 * built on, and getting it wrong is not a rounding matter — it decides who the buyer is shown as
 * the best overall value.
 *
 * `(rank - 1) / (count - 1)`, NOT `rank / count`, which was the old engine's formula and carries
 * two distortions that survive into any weighting placed on top of it:
 *
 *   IT NEVER REACHES ZERO, so the best offer on a dimension always pays a residual penalty — and
 *   the size of that penalty depends only on HOW MANY DEALERSHIPS BID. Rank 1 of 2 scored 0.5 and
 *   rank 1 of 10 scored 0.1: the same achievement, scored five times apart, rewarding a dealership
 *   for the size of the field it happened to win rather than for its offer.
 *
 *   IT MAXIMALLY PENALISES A SOLE PARTICIPANT. Rank 1 of 1 is 1.0 — the WORST value on the scale.
 *   Measured: an offer ranked #1 on all four dimensions scored 0.4375 while an offer ranked #1 on
 *   only three scored 0.2500, because the first was the only financed offer on the auction. Being
 *   the one dealership willing to quote financing made it lose.
 *
 * A SOLE PARTICIPANT IS EXCLUDED, not scored. A dimension with one entrant distinguishes nobody,
 * so it is dropped and the remaining weights renormalise — exactly what already happens for an
 * offer the dimension does not apply to. Scoring it instead, at any value, would make "was anyone
 * else financing?" part of the comparison between two offers that are otherwise identical.
 */
function normalizeRank(rank: number, count: number): number {
  return (rank - 1) / (count - 1);
}

/**
 * The weighted overall score. LOWER IS BETTER, because the inputs are ranks.
 *
 * RENORMALISED OVER THE DIMENSIONS THAT APPLY, which is the fix for a real unfairness in the old
 * formula. It divided the monthly term by `max(financedCount, 1)` and included it for every offer,
 * so a cash-only offer — which has no monthly rank at all — carried a term derived from a ranking
 * it was not in. Dropping the term and renormalising says the honest thing instead: this offer was
 * scored on the dimensions it has, on the same 0–1 scale as every other.
 *
 * §8c also asks for FEES AND JUNK FEES AS SEPARATE RANKS. The old engine added `weightFees` and
 * `weightJunkFees` together and applied the sum to ONE junk-fee rank, so `weightFees` — 20% of the
 * configured model — was silently spent on a dimension the administrator did not point it at, and
 * total fees were never ranked at all.
 */
export function overallScore(terms: readonly OverallTerm[]): number {
  let weighted = 0;
  let applied = 0;
  for (const t of terms) {
    // `count <= 1` is the exclusion described on `normalizeRank`: one entrant separates nobody.
    if (t.rank === null || t.count <= 1 || t.weight <= 0) continue;
    weighted += normalizeRank(t.rank, t.count) * t.weight;
    applied += t.weight;
  }
  // Every weight zero or every dimension inapplicable: no basis to separate this offer from any
  // other, so it scores the neutral midpoint rather than 0 (which would read as "best").
  if (applied === 0) return 0.5;
  return weighted / applied;
}
