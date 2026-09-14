// §Stage 11 / §11a — the arithmetic behind the recap's running total.
//
// Extracted from `RecapConfirmClient` so it can be tested without a browser. It was inline, and
// inline is why the defect survived two review passes: the component rendered
// `money(baseOtdCents)` for "Your out-the-door total" one row under "Declined (not in your
// total)", and nothing could assert the contradiction.

export interface RecapProduct {
  key: string;
  label: string;
  amountCents: number;
  accepted: boolean | null;
}

export interface RecapTotals {
  /** Everything that is not an optional product: vehicle, taxes, documentation, title, delivery. */
  vehicleAndFeesCents: number;
  acceptedTotal: number;
  declinedTotal: number;
  undecidedTotal: number;
  /** What the buyer is being asked to agree to right now. */
  runningTotalCents: number;
}

/**
 * `baseOtdCents` is the recap's `itemised.otdCents` — the figure the dealership reaffirmed, which
 * CONTAINS every optional product. So the buckets are carved out of it, and the total is rebuilt
 * from the ones the buyer has actually agreed to.
 *
 * The defect this replaced: the component rendered "Your out-the-door total" as
 * `money(baseOtdCents)` one row under "Declined (not in your total)". Declining a $1,200 GAP
 * product struck the label through and changed the number by nothing.
 *
 * Undecided products sit outside the total for the same reason declined ones do: §11a makes
 * silence not an answer, and money nobody has accepted is not money the buyer has agreed to pay.
 * The total rises when they accept — which is what the "still to decide" row warns them about.
 *
 * The four buckets always partition `baseOtdCents` exactly, so the rows on screen can never sum to
 * something other than the total printed beneath them.
 */
export function recapTotals(baseOtdCents: number, products: RecapProduct[]): RecapTotals {
  const sum = (filter: (p: RecapProduct) => boolean) =>
    products.filter(filter).reduce((s, p) => s + p.amountCents, 0);

  const acceptedTotal = sum((p) => p.accepted === true);
  const declinedTotal = sum((p) => p.accepted === false);
  const undecidedTotal = sum((p) => p.accepted === null);
  const vehicleAndFeesCents = baseOtdCents - acceptedTotal - declinedTotal - undecidedTotal;

  return {
    vehicleAndFeesCents,
    acceptedTotal,
    declinedTotal,
    undecidedTotal,
    runningTotalCents: vehicleAndFeesCents + acceptedTotal,
  };
}
