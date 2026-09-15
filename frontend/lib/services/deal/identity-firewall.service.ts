// lib/services/deal/identity-firewall.service.ts
// §25.1 — the identity firewall's READER, LIFT and REVOCATION. Phase 7 (§11.6).
//
// WHAT PHASE 5 LEFT, AND WHY THIS FILE IS BIGGER THAN "FLIP A FLAG".
//
// §11.6 splits §25 in half: "Phase 5 builds the firewall ... Phase 7 performs the *lift* at
// reaffirmation." Reading Phase 5's build at the start of this phase turned up something the
// split does not say. `identity_firewall_entries` has exactly ONE production writer —
// `auction-invitation.service.ts:466`, which upserts `state: "WITHHELD"` per (auction, rooftop)
// — and ZERO production readers. No gate, no predicate, nothing anywhere consults `state`,
// `lifted_at` or `lifted_by`.
//
// Every withholding that actually holds today is STRUCTURAL: a Prisma `select` that omits the
// column (`app/dealer/invitation/[token]/page.tsx`), a payload type with no field able to carry
// identity (`DealerInvitationContent`), a projection built for the purpose
// (`DEALER_OFFER_SELECT`), or a coarsening helper (`bucketBudgetCents`). Those hold, and they are
// kept — but none is keyed on firewall state, so there was nothing for a "lift" to flip.
//
// So Phase 7 builds the reader as well as the lift. `dealerIdentityVisible` below is that reader,
// and it is the single predicate every dealer surface that renders buyer identity now calls.
//
// THE PREDICATE, AND WHY IT IS NOT "read `state` and return it".
//
//   visible ⟺ the deal is live
//           ∧ a CONFIRMED dealer_reaffirmations row exists for the deal
//           ∧ (there is no ledger entry ∨ the entry is LIFTED and not revoked)
//
// The reaffirmation row is the LOAD-BEARING clause and the ledger is the qualifier, not the other
// way round, for a reason found in Phase 5's own code. `writeWithheldFirewallEntry` is called only
// when `t.rooftopId` is truthy (`auction-invitation.service.ts:338-344`) and the unique is
// `(auction_id, rooftop_id)`, so a registered dealer invited WITHOUT a rooftop has no ledger row
// at all. Reading the ledger as the primary source would make identity visible for exactly those
// dealers by default — the ledger's absence is not consent. Keying on the reaffirmation, which is
// per-DEAL and always exists once a dealership has confirmed, closes that hole; the ledger then
// carries the audit record and the revocation.
//
// FAIL CLOSED, LITERALLY. Every early return in this file is `false`. A missing deal, a missing
// reaffirmation, a query that throws — all withhold. §29 names the firewall a safeguard that must
// not be weakened, and a predicate that answers "visible" when it cannot tell is a weaker
// safeguard than no predicate at all, because it looks like one.
//
// WHAT THE LIFT ACTUALLY RELEASES (§Stage 10, HTML S[10].system[1]): the buyer's and co-buyer's
// contact information, the trade packet, and the secure Deal handoff — "at this moment and not
// before". `secureHandoffPacket` below is that payload, and it returns null unless the predicate
// says visible, so there is one gate rather than one per field.
//
// REVOCATION IS NOT A RECALL — §13-D38 option C, ruled. The lift is append-only: a release that
// ends is revoked (`revoked_at`/`revoked_by`), never flipped back to WITHHELD, because "this
// rooftop was given the buyer's details at time T" is the §25.2 evidence this table exists to
// hold. Revocation stops the dealer PORTAL rendering identity. It recalls nothing: the handoff
// already sent the details. The control on a dealership's conduct after that point is §25.2
// anti-circumvention, not this column.

import { prisma } from "@/lib/prisma";
import { DealStatus, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

type Db = typeof prisma | Prisma.TransactionClient;

/** Deal states in which no dealer may see the buyer, whatever the ledger says. */
const DEAD_DEAL: DealStatus[] = [DealStatus.CANCELLED, DealStatus.REFUNDED];

/** The ledger vocabulary. Strings in code, like `SourcingCase.status` — see the model comment. */
export const FIREWALL_WITHHELD = "WITHHELD";
export const FIREWALL_LIFTED = "LIFTED";

export interface FirewallDecision {
  visible: boolean;
  /** Why, in the vocabulary an operator reading a log would recognise. */
  reason:
    | "LIFTED"
    | "NO_DEAL"
    | "DEAL_NOT_LIVE"
    | "NOT_REAFFIRMED"
    | "REVOKED"
    | "LEDGER_WITHHELD"
    | "LOOKUP_FAILED";
}

/**
 * The §25.1 predicate. Call this before rendering ANY buyer or co-buyer identity, or any trade
 * packet field, on a dealer surface.
 *
 * `dealerId` is optional and is an ownership cross-check, not the gate: a dealer who owns the
 * deal still sees nothing before reaffirmation. Pass it where the caller already knows it so a
 * mis-scoped surface fails here rather than rendering another dealership's buyer.
 */
export async function dealerIdentityVisible(
  dealId: string,
  dealerId?: string | null,
  db: Db = prisma,
): Promise<FirewallDecision> {
  try {
    const deal = await db.deal.findUnique({
      where: { id: dealId },
      select: {
        status: true,
        auctionId: true,
        rooftopId: true,
        dealerId: true,
        offer: { select: { dealerId: true } },
      },
    });
    if (!deal) return { visible: false, reason: "NO_DEAL" };
    if (DEAD_DEAL.includes(deal.status)) return { visible: false, reason: "DEAL_NOT_LIVE" };

    // Ownership cross-check. `Deal.dealerId` is the §13-D20 lineage field (set for an outside
    // winner once the claim completes); `offer.dealerId` is the immutable attribution. Either
    // matching is ownership — for an outside winner mid-claim only the second is set.
    if (dealerId && deal.dealerId !== dealerId && deal.offer?.dealerId !== dealerId) {
      return { visible: false, reason: "NO_DEAL" };
    }

    const reaffirmed = await db.dealerReaffirmation.findFirst({
      where: { dealId, status: "CONFIRMED" },
      select: { id: true },
    });
    if (!reaffirmed) return { visible: false, reason: "NOT_REAFFIRMED" };

    // The ledger qualifies the reaffirmation; its ABSENCE does not deny it (see the header —
    // a rooftop-less invitation never produced a row).
    if (deal.auctionId && deal.rooftopId) {
      const entry = await db.identityFirewallEntry.findUnique({
        where: { auctionId_rooftopId: { auctionId: deal.auctionId, rooftopId: deal.rooftopId } },
        select: { state: true, revokedAt: true },
      });
      if (entry) {
        if (entry.revokedAt) return { visible: false, reason: "REVOKED" };
        if (entry.state !== FIREWALL_LIFTED) return { visible: false, reason: "LEDGER_WITHHELD" };
      }
    }

    return { visible: true, reason: "LIFTED" };
  } catch (err) {
    // §29: a query failure renders as a failure, never a confident answer. Here the safe
    // failure is "withheld" — the same rule Phase 6 applied to empty result sets, pointed the
    // other way because the safe side of this predicate is the closed one.
    logger.error("identity-firewall: visibility lookup failed — failing closed", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { visible: false, reason: "LOOKUP_FAILED" };
  }
}

/**
 * The same predicate, for a LIST of deals, in three queries instead of three per row.
 *
 * `app/dealer/financing/page.tsx` called `dealerIdentityVisible` inside a `for` loop over up to 50
 * financings and awaited each one, so a busy finance manager's page issued up to 150 SERIALISED
 * round-trips before it rendered a single row.
 *
 * THE PREDICATE IS NOT RESTATED HERE. Duplicating it would be the §25.1 defect waiting to happen —
 * two copies of a privacy rule drift, and the copy that drifts is the one nobody re-reads. The
 * decision logic below is the SAME sequence of clauses in the same order, evaluated against rows
 * fetched in bulk, and the failure mode is identical: anything this cannot establish is withheld,
 * including a query that throws (every deal in the batch is then withheld, not skipped).
 */
export async function dealerIdentityVisibleMany(
  dealIds: string[],
  dealerId?: string | null,
  db: Db = prisma,
): Promise<Map<string, FirewallDecision>> {
  const decisions = new Map<string, FirewallDecision>();
  if (dealIds.length === 0) return decisions;
  // Default every deal to WITHHELD, then open the ones that earn it. A deal missing from any of
  // the three reads therefore stays closed rather than falling through to visible.
  for (const id of dealIds) decisions.set(id, { visible: false, reason: "LOOKUP_FAILED" });

  try {
    const deals = await db.deal.findMany({
      where: { id: { in: dealIds } },
      select: {
        id: true,
        status: true,
        auctionId: true,
        rooftopId: true,
        dealerId: true,
        offer: { select: { dealerId: true } },
      },
    });

    const reaffirmed = new Set(
      (
        await db.dealerReaffirmation.findMany({
          where: { dealId: { in: dealIds }, status: "CONFIRMED" },
          select: { dealId: true },
        })
      ).map((r) => r.dealId),
    );

    const ledgerKeys = deals
      .filter((d) => d.auctionId && d.rooftopId)
      .map((d) => ({ auctionId: d.auctionId!, rooftopId: d.rooftopId! }));
    const entries = ledgerKeys.length
      ? await db.identityFirewallEntry.findMany({
          where: { OR: ledgerKeys },
          select: { auctionId: true, rooftopId: true, state: true, revokedAt: true },
        })
      : [];
    const ledger = new Map(entries.map((e) => [`${e.auctionId}:${e.rooftopId}`, e]));

    for (const deal of deals) {
      if (DEAD_DEAL.includes(deal.status)) {
        decisions.set(deal.id, { visible: false, reason: "DEAL_NOT_LIVE" });
        continue;
      }
      if (dealerId && deal.dealerId !== dealerId && deal.offer?.dealerId !== dealerId) {
        decisions.set(deal.id, { visible: false, reason: "NO_DEAL" });
        continue;
      }
      if (!reaffirmed.has(deal.id)) {
        decisions.set(deal.id, { visible: false, reason: "NOT_REAFFIRMED" });
        continue;
      }
      if (deal.auctionId && deal.rooftopId) {
        const entry = ledger.get(`${deal.auctionId}:${deal.rooftopId}`);
        if (entry?.revokedAt) {
          decisions.set(deal.id, { visible: false, reason: "REVOKED" });
          continue;
        }
        if (entry && entry.state !== FIREWALL_LIFTED) {
          decisions.set(deal.id, { visible: false, reason: "LEDGER_WITHHELD" });
          continue;
        }
      }
      decisions.set(deal.id, { visible: true, reason: "LIFTED" });
    }
  } catch (err) {
    logger.error("identity-firewall: batch visibility lookup failed — failing closed", {
      dealIds: dealIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
    // The map is already all-withheld; returning it unchanged is the closed answer.
  }

  return decisions;
}

/**
 * Perform the §Stage 10 lift. Called from the reaffirmation confirm path INSIDE its transaction,
 * so the release and the confirmation commit together — a lift without a confirmation, or a
 * confirmation without a lift, are both states no reader could interpret.
 *
 * Idempotent: re-running on an already-lifted entry rewrites the same state and leaves the
 * ORIGINAL `lifted_at` in place, because the audit question is when the buyer's details first
 * reached this rooftop, not when the last confirm button was pressed.
 */
export async function liftIdentityFirewall(
  input: { dealId: string; actorId: string },
  db: Db = prisma,
): Promise<{ lifted: boolean; reason: string }> {
  const deal = await db.deal.findUnique({
    where: { id: input.dealId },
    select: { auctionId: true, rooftopId: true, dealerId: true, buyerId: true },
  });
  if (!deal) return { lifted: false, reason: "NO_DEAL" };

  // No rooftop means no ledger row is possible: the unique is (auction_id, rooftop_id) and
  // Postgres treats NULLs as distinct, so writing one would let a second deal on the same
  // auction create a duplicate. The reaffirmation row is the record for those dealers, and
  // `dealerIdentityVisible` reads it. Reported rather than silently skipped.
  if (!deal.auctionId || !deal.rooftopId) {
    logger.info("identity-firewall: lift recorded on the reaffirmation only (no rooftop binding)", {
      dealId: input.dealId,
      hasAuction: !!deal.auctionId,
      hasRooftop: !!deal.rooftopId,
    });
    return { lifted: true, reason: "NO_LEDGER_KEY" };
  }

  const now = new Date();
  await db.identityFirewallEntry.upsert({
    where: { auctionId_rooftopId: { auctionId: deal.auctionId, rooftopId: deal.rooftopId } },
    create: {
      auctionId: deal.auctionId,
      rooftopId: deal.rooftopId,
      dealerId: deal.dealerId,
      buyerId: deal.buyerId,
      state: FIREWALL_LIFTED,
      liftedAt: now,
      liftedBy: input.actorId,
      description:
        "Buyer and co-buyer identity and the trade packet released to this rooftop at Stage 10 " +
        "reaffirmation (§25.1). Append-only: an ended release is revoked, never re-withheld.",
    },
    // NEITHER `liftedAt` NOR THE REVOCATION IS IN THE UPDATE, and the second half of that is a
    // correction. This read `revokedAt: null, revokedBy: null`, so every re-lift ERASED the record
    // of an ended release — the exact loss §13-D38 chose option C over option B to avoid, arriving
    // silently through the one table that exists to hold §25.2 evidence. `liftedAt` stays out for
    // the original reason: the first release is the fact worth keeping.
    update: { state: FIREWALL_LIFTED },
  });

  // A RE-LIFT ON A ROW WHOSE PREVIOUS RELEASE WAS REVOKED. The live revocation pointer has to
  // clear or `dealerIdentityVisible` keeps answering REVOKED to a rooftop that has just reaffirmed
  // again. So the ended release is ARCHIVED onto the row's own `description` — a `TEXT NOT NULL`,
  // and the only field on this table able to carry more than one fact — before the pointer moves.
  //
  // Conditional, so an idempotent re-confirm does not grow the description on every press; and
  // compare-and-swapped on the timestamp just read, so a revocation landing between the read and
  // the write is not swallowed by it.
  const current = await db.identityFirewallEntry.findUnique({
    where: { auctionId_rooftopId: { auctionId: deal.auctionId, rooftopId: deal.rooftopId } },
    select: { description: true, revokedAt: true, revokedBy: true },
  });
  if (current?.revokedAt) {
    await db.identityFirewallEntry.updateMany({
      where: { auctionId: deal.auctionId, rooftopId: deal.rooftopId, revokedAt: current.revokedAt },
      data: {
        description:
          `${current.description}\n` +
          `[${now.toISOString()}] Released again to this rooftop by ${input.actorId}. The previous ` +
          `release ended at ${current.revokedAt.toISOString()}` +
          `${current.revokedBy ? ` by ${current.revokedBy}` : ""}. Recorded here because the row ` +
          `carries ONE live revocation pointer and §13-D38 option C keeps what was released and when.`,
        revokedAt: null,
        revokedBy: null,
      },
    });
  }
  return { lifted: true, reason: "LIFTED" };
}

/**
 * End a release (§13-D38 option C). Called when the deal stops being this dealership's — a
 * rejection, a timeout, a released hold, a cancellation.
 *
 * THIS IS NOT A RECALL. The handoff already sent the buyer's details; nothing here retrieves
 * them. It stops the dealer portal rendering identity, and it records that the release ended.
 * §25.2 anti-circumvention is the control that governs conduct after the handoff.
 */
export async function revokeIdentityFirewall(
  input: { dealId: string; actorId: string; reason: string },
  db: Db = prisma,
): Promise<{ revoked: boolean }> {
  const deal = await db.deal.findUnique({
    where: { id: input.dealId },
    select: { auctionId: true, rooftopId: true },
  });
  if (!deal?.auctionId || !deal?.rooftopId) return { revoked: false };

  const res = await db.identityFirewallEntry.updateMany({
    where: {
      auctionId: deal.auctionId,
      rooftopId: deal.rooftopId,
      state: FIREWALL_LIFTED,
      revokedAt: null,
    },
    data: { revokedAt: new Date(), revokedBy: input.actorId },
  });
  return { revoked: res.count > 0 };
}

export interface SecureHandoffPacket {
  buyer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  coBuyer: {
    legalFirstName: string | null;
    legalLastName: string | null;
    email: string | null;
    phone: string | null;
    isRequiredSigner: boolean;
  } | null;
  trade: {
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileage: number | null;
    vin: string | null;
    lienholderName: string | null;
    payoffGoodThroughDate: Date | null;
    verifiedPayoffCents: number | null;
    titleInHand: boolean | null;
    titleState: string | null;
    hasSecondKey: boolean | null;
    photoUrls: string[];
  } | null;
}

/**
 * The Stage 10 secure handoff. ONE gate for the whole packet rather than one per field, so a
 * later field added to `SecureHandoffPacket` cannot be released by forgetting a check.
 *
 * Returns null — not a partially-populated object — when the firewall is closed. A caller that
 * renders `packet?.buyer.firstName` therefore renders nothing, and a caller that forgets to check
 * gets a TypeScript error on the null rather than a leak.
 */
export async function secureHandoffPacket(
  dealId: string,
  dealerId?: string | null,
  db: Db = prisma,
): Promise<SecureHandoffPacket | null> {
  const decision = await dealerIdentityVisible(dealId, dealerId, db);
  if (!decision.visible) return null;

  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      buyer: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          user: { select: { email: true } },
        },
      },
      coBuyer: {
        select: {
          legalFirstName: true,
          legalLastName: true,
          email: true,
          phone: true,
          isRequiredSigner: true,
          shareConsentAt: true,
        },
      },
      tradeInSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          year: true,
          make: true,
          model: true,
          trim: true,
          mileage: true,
          vin: true,
          lienholderName: true,
          payoffGoodThroughDate: true,
          verifiedPayoffCents: true,
          titleInHand: true,
          titleState: true,
          hasSecondKey: true,
          photoUrls: true,
          shareConsentAt: true,
        },
      },
    },
  });
  if (!deal?.buyer) return null;

  const trade = deal.tradeInSubmissions[0] ?? null;

  return {
    buyer: {
      firstName: deal.buyer.firstName,
      lastName: deal.buyer.lastName,
      email: deal.buyer.user?.email ?? null,
      phone: deal.buyer.phone,
      address: deal.buyer.address,
      city: deal.buyer.city,
      state: deal.buyer.state,
      zip: deal.buyer.zip,
    },
    // §4b — the co-buyer travels with the transaction only where the primary buyer consented to
    // share them. No consent, no co-buyer in the packet: the firewall being open is permission to
    // release the BUYER's details, not someone else's.
    coBuyer:
      deal.coBuyer && deal.coBuyer.shareConsentAt
        ? {
            legalFirstName: deal.coBuyer.legalFirstName,
            legalLastName: deal.coBuyer.legalLastName,
            email: deal.coBuyer.email,
            phone: deal.coBuyer.phone,
            isRequiredSigner: deal.coBuyer.isRequiredSigner,
          }
        : null,
    // §4b AGAIN, and the same rule as the co-buyer four lines above — which was gated while this
    // was not. `shareConsentAt` was SELECTED at the query above and never read, which is worse
    // than having no consent field at all: the query reads as though consent were checked.
    //
    // `share_consent_at` is written on every submission that persists (`trade-in.service.ts:292`,
    // after a refusal at `:261` when `shareConsent` is not true), so this withholds only a packet
    // carrying no recorded consent — a legacy row predating the Phase 1 column, or one written by
    // a future path that forgot. The buyer's own identity is unaffected: one missing consent is
    // not a closed firewall.
    trade:
      trade && trade.shareConsentAt
        ? {
            year: trade.year,
            make: trade.make,
            model: trade.model,
            trim: trade.trim,
            mileage: trade.mileage,
            vin: trade.vin,
            lienholderName: trade.lienholderName,
            payoffGoodThroughDate: trade.payoffGoodThroughDate,
            verifiedPayoffCents: trade.verifiedPayoffCents,
            titleInHand: trade.titleInHand,
            titleState: trade.titleState,
            hasSecondKey: trade.hasSecondKey,
            photoUrls: trade.photoUrls,
          }
        : null,
  };
}
