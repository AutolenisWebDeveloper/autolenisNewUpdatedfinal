// Decision logic for the buyer-location backfill
// (docs/plans/BUYER-LOCATION-BACKFILL.md).
//
// Ten buyers reached an auction with NULL location because prequal collected a
// validated address, forwarded it to MicroBilt, and discarded it. Fix 1 stops
// that for new buyers; these rows still need filling from an existing source.
//
// The source is `buyer_opportunities.zip`, joined to buyers via
// `vehicle_requests.buyer_opportunity_id`. It is CORROBORATED, not assumed:
// where a buyer also carries its own ZIP the two agree (3 of 3 in production).
// This module enforces that rather than trusting it — a source that contradicts
// the buyer, or two opportunities that contradict each other, is a human
// question and must stop the row.
//
// Pure by design: no Prisma, no I/O. `scripts/backfill-buyer-location.ts` is a
// thin CLI over it, which is also what makes the corroboration rule testable
// without a database.

export interface BuyerRow {
  id: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export type BackfillAction =
  /** A corroborated ZIP is available and the buyer has none. */
  | "FILL"
  /** The buyer already carries a ZIP (and any source agrees with it). */
  | "ALREADY_SET"
  /** No opportunity ZIP exists — needs customer contact, not a script. */
  | "NO_SOURCE"
  /** Sources disagree with each other or with the buyer. Never auto-resolved. */
  | "CONFLICT";

export interface BackfillDecision {
  buyerId: string;
  action: BackfillAction;
  /** Present only on FILL. This source carries no city/state, so neither is returned. */
  zip?: string;
  reason: string;
}

/** Compare ZIPs the way `lookupZip` does — first five characters, trimmed. */
function zip5(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return t ? t.slice(0, 5) : null;
}

/**
 * Decide what, if anything, to write for one buyer.
 *
 * `opportunityZips` is every `buyer_opportunities.zip` reachable from this
 * buyer through `vehicle_requests.buyer_opportunity_id`, in any order, with
 * nulls and blanks permitted (they are filtered here rather than by the caller).
 */
export function decideBackfill(
  buyer: BuyerRow,
  opportunityZips: Array<string | null | undefined>,
): BackfillDecision {
  const buyerZip = zip5(buyer.zip);
  const sourced = [...new Set(opportunityZips.map(zip5).filter((z): z is string => z !== null))];

  if (sourced.length > 1) {
    return {
      buyerId: buyer.id,
      action: "CONFLICT",
      reason: `opportunity ZIPs disagree (${sourced.join(", ")}) — a script must not pick a winner`,
    };
  }

  const candidate = sourced[0] ?? null;

  if (buyerZip) {
    if (candidate && candidate !== buyerZip) {
      return {
        buyerId: buyer.id,
        action: "CONFLICT",
        reason:
          `opportunity ZIP ${candidate} does not corroborate the buyer's own ZIP ${buyerZip} — ` +
          `the premise that these sources agree has broken for this row`,
      };
    }
    return {
      buyerId: buyer.id,
      action: "ALREADY_SET",
      reason: candidate
        ? `buyer ZIP ${buyerZip} corroborated by the opportunity source`
        : `buyer already carries ZIP ${buyerZip}`,
    };
  }

  if (!candidate) {
    return {
      buyerId: buyer.id,
      action: "NO_SOURCE",
      reason: "no opportunity ZIP anywhere for this buyer — requires customer contact",
    };
  }

  return {
    buyerId: buyer.id,
    action: "FILL",
    zip: candidate,
    reason: `sourced from buyer_opportunities.zip (${candidate})`,
  };
}
