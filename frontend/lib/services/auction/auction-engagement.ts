// lib/services/auction/auction-engagement.ts
//
// Program 3 — the single source of TRUTHFUL buyer-facing auction engagement copy.
//
// The buyer must never be told dealers are "bidding", "competing", or "reviewing"
// merely because an auction record exists. Real participation is measured ONLY by
// SUBMITTED offers. An invitation is not participation (a dealer may never bid, or
// the invite may not have been delivered), and zero invited dealers is not
// "reviewing". This pure helper derives the engagement label + social-proof string
// from real counts so the API route and any UI render exactly one truthful signal.

export interface AuctionEngagementInput {
  /** AuctionStatus (informational — engagement is driven by the counts). */
  status: string;
  /** Registered + outside invitations minted for this auction. */
  dealersInvited: number;
  /** Real dealer participation: count of SUBMITTED offers. */
  offerCount: number;
}

export interface AuctionEngagement {
  engagementLevel: "Sourcing" | "Awaiting Offers" | "Active" | "High" | "Very High";
  /** Real participation — always the SUBMITTED offer count, never the invited count. */
  dealersBidding: number;
  /** A truthful, identity-free, amount-free social-proof line. */
  socialProof: string;
}

export function deriveAuctionEngagement(input: AuctionEngagementInput): AuctionEngagement {
  const offers = Number.isFinite(input.offerCount) ? Math.max(0, Math.floor(input.offerCount)) : 0;
  const invited = Number.isFinite(input.dealersInvited) ? Math.max(0, Math.floor(input.dealersInvited)) : 0;

  // Real participation exists — describe it by the true offer count.
  if (offers >= 1) {
    const engagementLevel = offers >= 5 ? "Very High" : offers >= 3 ? "High" : "Active";
    const socialProof =
      offers === 1
        ? "1 dealer has submitted an offer"
        : `${offers} dealers have submitted offers`;
    return { engagementLevel, dealersBidding: offers, socialProof };
  }

  // No offers yet. Be honest about invited-but-not-yet-bidding vs. still sourcing.
  if (invited >= 1) {
    return {
      engagementLevel: "Awaiting Offers",
      dealersBidding: 0,
      socialProof:
        invited === 1
          ? "1 dealer has been invited — awaiting their offer"
          : `${invited} dealers have been invited — awaiting their offers`,
    };
  }

  // No dealers invited yet — do not imply any dealer engagement.
  return {
    engagementLevel: "Sourcing",
    dealersBidding: 0,
    socialProof: "We're finding qualified dealers for your request",
  };
}
