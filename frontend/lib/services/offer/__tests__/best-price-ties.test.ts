// §8c parity row C10 — DETERMINISTIC TIES, AND EQUAL RESULTS PRESENTED AS EQUAL.
//
// §8c, verbatim: "Ties are broken deterministically: lowest out-the-door, then best
// required-feature match, then shortest distance, then earliest submission. Equal-value results
// are presented honestly as equal."
//
// Two requirements, and the old engine met neither. It ranked by `findIndex` over a single-key
// sort of an array whose order came from the database, so equal-priced offers were ordered by
// whatever Postgres returned — and every offer got a DISTINCT rank because the rank was the array
// index, so two identical $30,000 offers were shown as #1 and #2. That tells the buyer one is
// better when nothing distinguishes them, and hands the badge to whoever the database returned
// first.
//
//   npx tsx --test lib/services/offer/__tests__/best-price-ties.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { compareOffers, assignRanks, overallScore } from "../ranking";

type O = Parameters<typeof compareOffers>[0];

function off(over: Partial<O> & { offerId: string }): O {
  return {
    otdPriceCents: 3_000_000,
    featureMatchScore: null,
    distanceMiles: null,
    submittedAt: null,
    ...over,
  };
}

const sortIds = (offers: O[]) => [...offers].sort(compareOffers).map((o) => o.offerId);

// ── the four keys, in the stated order ──────────────────────────────────────────────────────────

test("key 1 — lowest out-the-door wins, before anything else is consulted", () => {
  // The cheaper offer wins even though it is worse on all three later keys.
  const cheap = off({ offerId: "cheap", otdPriceCents: 2_900_000, featureMatchScore: -5, distanceMiles: 400, submittedAt: new Date("2026-09-10") });
  const rest = off({ offerId: "rest", otdPriceCents: 3_000_000, featureMatchScore: 5, distanceMiles: 2, submittedAt: new Date("2026-09-01") });
  assert.deepEqual(sortIds([rest, cheap]), ["cheap", "rest"]);
});

test("key 2 — at the same price, the better required-feature match wins", () => {
  const good = off({ offerId: "good", featureMatchScore: 3, distanceMiles: 300 });
  const poor = off({ offerId: "poor", featureMatchScore: 1, distanceMiles: 1 });
  assert.deepEqual(sortIds([poor, good]), ["good", "poor"], "distance was consulted before feature match");
});

test("key 3 — at the same price and match, the shorter distance wins", () => {
  const near = off({ offerId: "near", featureMatchScore: 2, distanceMiles: 12, submittedAt: new Date("2026-09-10") });
  const far = off({ offerId: "far", featureMatchScore: 2, distanceMiles: 90, submittedAt: new Date("2026-09-01") });
  assert.deepEqual(sortIds([far, near]), ["near", "far"], "submission time was consulted before distance");
});

test("key 4 — at the same price, match and distance, the earliest submission wins", () => {
  const early = off({ offerId: "early", distanceMiles: 10, submittedAt: new Date("2026-09-01T08:00:00Z") });
  const late = off({ offerId: "late", distanceMiles: 10, submittedAt: new Date("2026-09-01T09:00:00Z") });
  assert.deepEqual(sortIds([late, early]), ["early", "late"]);
});

// ── unknown values: total order without penalising a data gap ───────────────────────────────────

test("an unknown feature match neither wins nor loses the tie", () => {
  // The scale is matches minus mismatches, so 0 is the genuine midpoint. An unestablished list
  // beats a net-negative match and loses to a net-positive one — it is not treated as worst.
  const unknown = off({ offerId: "unknown", featureMatchScore: null });
  const worse = off({ offerId: "worse", featureMatchScore: -1 });
  const better = off({ offerId: "better", featureMatchScore: 1 });
  assert.deepEqual(sortIds([worse, unknown, better]), ["better", "unknown", "worse"]);
});

test("an unknown distance sorts after every known one", () => {
  // The key exists to prefer a dealership the buyer can more easily reach; that cannot be said of
  // an unknown distance. It only applies after price and feature match have already tied.
  const known = off({ offerId: "known", distanceMiles: 500 });
  const unknown = off({ offerId: "unknown", distanceMiles: null });
  assert.deepEqual(sortIds([unknown, known]), ["known", "unknown"]);
});

test("the comparator is a TOTAL ORDER — same set, same list, whatever the input permutation", () => {
  // This is the property the old engine lacked, and the reason the report was not reproducible:
  // `findIndex` over a database-ordered array meant a re-run could reorder equal offers. The
  // "skip the key when either side is unknown" rule is the intuitive fix and is NOT transitive —
  // with 1, unknown, 2 the first ties the second and the second ties the third while the first
  // beats the third — so each key maps unknown onto a definite position instead.
  const offers = [
    off({ offerId: "a", featureMatchScore: 2, distanceMiles: null }),
    off({ offerId: "b", featureMatchScore: null, distanceMiles: 5 }),
    off({ offerId: "c", featureMatchScore: 2, distanceMiles: 5 }),
    off({ offerId: "d", otdPriceCents: 2_900_000 }),
    off({ offerId: "e", featureMatchScore: null, distanceMiles: null, submittedAt: new Date("2026-09-01") }),
  ];
  const expected = sortIds(offers);
  // Every rotation of the input must produce the same output.
  for (let i = 0; i < offers.length; i++) {
    const rotated = [...offers.slice(i), ...offers.slice(0, i)];
    assert.deepEqual(sortIds(rotated), expected, `rotation ${i} produced a different order`);
  }
  // ...and so must the reverse.
  assert.deepEqual(sortIds([...offers].reverse()), expected);
});

// ── equal results presented as equal ────────────────────────────────────────────────────────────

test("two identical prices SHARE rank 1 — neither is badged better than the other", () => {
  const a = off({ offerId: "a", submittedAt: new Date("2026-09-01") });
  const b = off({ offerId: "b", submittedAt: new Date("2026-09-02") });
  const c = off({ offerId: "c", otdPriceCents: 3_100_000 });
  const ordered = [a, b, c].sort(compareOffers);
  const ranks = assignRanks(ordered, (o) => o.otdPriceCents);

  assert.equal(ranks.get("a")!.rank, 1);
  assert.equal(ranks.get("b")!.rank, 1, "the second identical offer was badged #2");
  assert.deepEqual(ranks.get("a")!.tiedWith, ["b"]);
  assert.deepEqual(ranks.get("b")!.tiedWith, ["a"]);
});

test("the rank AFTER a tie skips the numbers the tie consumed (1, 1, 3)", () => {
  const ordered = [
    off({ offerId: "a" }),
    off({ offerId: "b" }),
    off({ offerId: "c", otdPriceCents: 3_100_000 }),
  ].sort(compareOffers);
  const ranks = assignRanks(ordered, (o) => o.otdPriceCents);
  assert.equal(ranks.get("c")!.rank, 3, "a two-way tie for first must be followed by third, not second");
  assert.deepEqual(ranks.get("c")!.tiedWith, []);
});

test("the LIST ORDER and the RANK NUMBER are allowed to disagree, and must", () => {
  // The comparator gives a reproducible sequence; the badge says what is actually distinguishable.
  // `a` is listed before `b` because it submitted earlier, and both are #1 because the ranked
  // dimension — price — is identical.
  const a = off({ offerId: "a", distanceMiles: 10, submittedAt: new Date("2026-09-01") });
  const b = off({ offerId: "b", distanceMiles: 10, submittedAt: new Date("2026-09-02") });
  const ordered = [b, a].sort(compareOffers);
  assert.deepEqual(ordered.map((o) => o.offerId), ["a", "b"]);
  const ranks = assignRanks(ordered, (o) => o.otdPriceCents);
  assert.equal(ranks.get("a")!.rank, 1);
  assert.equal(ranks.get("b")!.rank, 1);
});

test("a dimension an offer does not have EXCLUDES it rather than ranking it worst", () => {
  // §8c's preserved engine rule: non-finance offers never occupy monthly rank. Ranking a cash
  // offer last on monthly payment would report a comparison nobody made.
  const financed = off({ offerId: "fin" });
  const cash = off({ offerId: "cash" });
  const monthly = new Map([["fin", 48_000]]);
  const ranks = assignRanks([financed, cash].sort(compareOffers), (o) => monthly.get(o.offerId) ?? null);
  assert.equal(ranks.get("fin")!.rank, 1);
  assert.equal(ranks.has("cash"), false, "a cash offer was given a monthly rank");
});

// ── the overall score ───────────────────────────────────────────────────────────────────────────

test("a cash offer is not penalised for having no monthly rank", () => {
  // The old formula divided the monthly term by max(financedCount, 1) and applied it to EVERY
  // offer, so a cash-only offer carried a term derived from a ranking it was not in. Renormalising
  // over the applicable dimensions scores it on what it has, on the same 0–1 scale.
  const w = { otd: 0.4, monthly: 0.25, fees: 0.2, junk: 0.15 };
  const cash = overallScore([
    { rank: 1, count: 4, weight: w.otd },
    { rank: null, count: 0, weight: w.monthly },
    { rank: 1, count: 4, weight: w.fees },
    { rank: 1, count: 4, weight: w.junk },
  ]);
  const financedSameRanks = overallScore([
    { rank: 1, count: 4, weight: w.otd },
    { rank: 1, count: 1, weight: w.monthly },
    { rank: 1, count: 4, weight: w.fees },
    { rank: 1, count: 4, weight: w.junk },
  ]);
  assert.ok(cash < 1, "a best-on-everything cash offer scored worse than the scale allows");
  assert.ok(
    cash <= financedSameRanks + 1e-9,
    "the cash offer was penalised on a dimension it does not have",
  );
});

test("lower is better, and the best possible score is the best rank everywhere", () => {
  const best = overallScore([
    { rank: 1, count: 5, weight: 0.4 },
    { rank: 1, count: 5, weight: 0.6 },
  ]);
  const worst = overallScore([
    { rank: 5, count: 5, weight: 0.4 },
    { rank: 5, count: 5, weight: 0.6 },
  ]);
  assert.ok(best < worst);
  assert.equal(worst, 1);
});

test("no applicable dimension scores the midpoint, not zero", () => {
  // Zero would read as "best on everything" for an offer nothing could be said about.
  assert.equal(overallScore([{ rank: null, count: 0, weight: 1 }]), 0.5);
  assert.equal(overallScore([]), 0.5);
});
