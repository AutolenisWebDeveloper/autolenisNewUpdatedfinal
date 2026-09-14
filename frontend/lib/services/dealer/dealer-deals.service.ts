// lib/services/dealer/dealer-deals.service.ts
// Dealer deal data access — keeps business logic out of page files.
// All queries scope by dealerId via offer.dealerId to ensure ownership.

import { prisma } from "@/lib/prisma";
import { PickupStatus, type DealStatus } from "@prisma/client";
import { isExecutedArtifactEnabled } from "@/lib/services/esign/esign-schema-gate";
import { dealerIdentityVisible } from "@/lib/services/deal/identity-firewall.service";

export interface DealerDealSummary {
  id: string;
  status: DealStatus;
  createdAt: Date;
  offer: {
    id: string;
    otdPriceCents: number;
    auctionId: string;
  } | null;
}

export interface DealerDealDetail {
  id: string;
  status: DealStatus;
  createdAt: Date;
  contractShieldScore: number | null;
  contractShieldStatus: string | null;
  financingPath: string | null;
  offer: {
    id: string;
    otdPriceCents: number;
    vehiclePriceCents: number;
    taxCents: number;
    feesCents: number;
    includesFinancing: boolean;
    aprRate: number | null;
    termMonths: number | null;
    auctionId: string;
    dealerId: string;
    // PHASE 7 — the dealership's OWN offer data, projected so the Stage 10 reaffirmation form can
    // be PRE-FILLED from it. It was not, and the form's own header said it was: the page passed
    // `vin: null, odometer: null, deliveryTerms: null` because this projection did not carry them.
    // A dealership therefore retyped its own VIN, and one wrong character tripped §10a rule 1 —
    // "This is a different vehicle from the one you chose" to the buyer, a rejection that cancels
    // the deal, and an SLA failure recorded against the rooftop. For a typo.
    //
    // §25.1 is not in play here: every one of these fields is the dealership's own submission.
    vin: string | null;
    odometer: number | null;
    deliveryTerms: string | null;
    junkFeeItems: unknown;
    addOnItems: unknown;
    incentiveItems: unknown;
  } | null;
  // PHASE 7 CORRECTED THIS COMMENT, and the correction is the point.
  //
  // It used to read: "Buyer identity is therefore safe to expose on this endpoint", on the ground
  // that the query filters by `offer.dealerId` so a dealership can only reach its own win.
  // OWNERSHIP IS NOT THE QUESTION §25.1 ASKS. The firewall is about WHEN, not WHOSE: "Name, email,
  // phone, and exact address are released only at Stage 10, when that dealership has won AND
  // REAFFIRMED." A dealership that has won and not yet confirmed owns the deal and must still see
  // nothing — and the platform already told dealerships so, in `app/api/dealer/messages/route.ts`
  // ("buyer contact details are released to the winning dealership at reaffirmation") and in the
  // Phase 5 invitation email, while this block released them earlier.
  //
  // `null` means withheld; `identityWithheldReason` says why.
  buyer: {
    firstName: string;
    lastName: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    email: string | null;
  } | null;
  /** Null when the buyer block is populated. Otherwise the firewall's own reason. */
  identityWithheldReason: string | null;
  pickup: {
    id: string;
    status: "NOT_SCHEDULED" | "SCHEDULED" | "COMPLETE" | string;
    scheduledAt: Date | null;
    qrCodeData: string | null;
  } | null;
  // Whether the buyer-signed EXECUTED contract copy is available to this dealer.
  // A privacy-safe boolean only (§11) — the storage key/hash and any signer
  // forensic evidence are never exposed here; the copy is fetched via the
  // role-scoped, signed-URL download route.
  executedContractAvailable: boolean;
}

/**
 * Returns up to 50 of the dealer's deals (most recent first),
 * scoped via the accepted offer's dealerId.
 */
/**
 * OWNERSHIP IS EITHER ID, and these two readers used only one.
 *
 * §13-D20 keeps `Offer.dealerId` on the outside-dealer PLACEHOLDER permanently and puts the
 * claimed dealership on `Deal.dealerId`. Every Phase 7 ROUTE resolves ownership as
 * `OR: [{ offer: { dealerId } }, { dealerId }]` — `recap/route.ts:40`, `reaffirm/route.ts:65`,
 * `extendVehicleHold`. These two PAGE readers resolved it as `offer: { dealerId }` alone, so for
 * an outside winner the API accepted the dealership and the page 404'd — while the dealership's
 * own "recap ready" email linked to that page. A surface that exists but cannot be reached by the
 * population it was built for is not a surface.
 */
export async function getDealerDeals(dealerId: string): Promise<DealerDealSummary[]> {
  return prisma.deal.findMany({
    where: { OR: [{ offer: { dealerId } }, { dealerId }] },
    select: {
      id: true,
      status: true,
      createdAt: true,
      offer: { select: { id: true, otdPriceCents: true, auctionId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Returns a single deal for the given dealer, or null if not found / not owned.
 */
export async function getDealerDealById(dealId: string, dealerId: string): Promise<DealerDealDetail | null> {
  const deal = await prisma.deal.findFirst({
    // Either id is ownership — see the note on `getDealerDeals`.
    where: { id: dealId, OR: [{ offer: { dealerId } }, { dealerId }] },
    select: {
      id: true,
      status: true,
      createdAt: true,
      contractShieldScore: true,
      contractShieldStatus: true,
      financingPath: true,
      offer: {
        select: {
          id: true,
          otdPriceCents: true,
          vehiclePriceCents: true,
          taxCents: true,
          feesCents: true,
          includesFinancing: true,
          aprRate: true,
          termMonths: true,
          auctionId: true,
          dealerId: true,
          vin: true,
          odometer: true,
          deliveryTerms: true,
          junkFeeItems: true,
          addOnItems: true,
          incentiveItems: true,
        },
      },
      buyer: {
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          city: true,
          state: true,
          zip: true,
          user: { select: { email: true } },
        },
      },
      pickup: {
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          qrCodeData: true,
        },
      },
      // Executed-copy availability only — never the storage key/hash or forensic
      // signer evidence (§11). executedDocumentKey is projected ONLY while the
      // executed-artifact schema gate is open; with migrations 20261014/20261015
      // unapplied the column does not exist and no executed copy can exist either.
      eSignEnvelope: {
        select: isExecutedArtifactEnabled()
          ? { status: true, executedDocumentKey: true }
          : { status: true },
      },
    },
  });
  if (!deal) return null;

  // Resolved BEFORE the mapping so the projection below has one answer to consult, rather than
  // each field deciding for itself.
  const firewall = await dealerIdentityVisible(deal.id, dealerId);

  return {
    id: deal.id,
    status: deal.status,
    createdAt: deal.createdAt,
    contractShieldScore: deal.contractShieldScore,
    contractShieldStatus: deal.contractShieldStatus,
    financingPath: deal.financingPath,
    offer: deal.offer,
    executedContractAvailable:
      deal.eSignEnvelope?.status === "COMPLETED" &&
      !!(deal.eSignEnvelope as { executedDocumentKey?: string | null } | null)?.executedDocumentKey,
    // §25.1, PHASE 7 — the identity firewall, applied.
    //
    // This block released the buyer's full contact details on any deal past PENDING, which meant a
    // dealership saw them from award dispatch onward. §11.6 moves the release to REAFFIRMATION,
    // and §Stage 10 states it exactly: "At this moment and not before, the identity firewall
    // lifts." `dealerIdentityVisible` is that predicate and it FAILS CLOSED — a missing
    // reaffirmation, a revoked release, a dead deal or a query that throws all withhold.
    //
    // WITHHELD IS `null`, NOT AN EMPTY OBJECT. A surface rendering `buyer?.firstName` then renders
    // nothing, and a surface that forgot to check gets a TypeScript error on the null rather than
    // a blank where a name should be.
    buyer: firewall.visible && deal.buyer
      ? {
          firstName: deal.buyer.firstName,
          lastName: deal.buyer.lastName,
          phone: deal.buyer.phone,
          city: deal.buyer.city,
          state: deal.buyer.state,
          zip: deal.buyer.zip,
          email: deal.buyer.user?.email ?? null,
        }
      : null,
    /** Why the buyer block is null, for a surface that wants to say so rather than show a gap. */
    identityWithheldReason: firewall.visible ? null : firewall.reason,
    pickup: deal.pickup,
  };
}


// D2 — a dealer pickup awaiting or in the confirm/propose round-trip, or already
// confirmed (ready to scan). Isolation: exposes buyer city/state ONLY — never
// name/email/phone. `proposedAt` is the CAS token the client echoes on confirm/
// counter so a stale action loses cleanly.
export interface DealerPickupAction {
  id: string; // dealId
  createdAt: Date;
  buyerCity: string | null;
  buyerState: string | null;
  pickup: {
    status: PickupStatus;
    scheduledAt: Date | null;
    proposedTime: Date | null;
    proposedAt: Date | null;
    proposedBy: string | null;
    counterCount: number;
    qrCodeImage: string | null;
  };
}

const DEALER_PICKUP_ACTION_STATUSES: PickupStatus[] = [
  PickupStatus.PROPOSED,
  PickupStatus.DEALER_COUNTERED,
  PickupStatus.SCHEDULED,
  PickupStatus.CHECKED_IN,
];

/**
 * Pickups needing the dealer's attention (PROPOSED / DEALER_COUNTERED) or ready
 * for handoff (SCHEDULED / CHECKED_IN), scoped by the accepted offer's dealerId.
 */
export async function getDealerPickupActions(dealerId: string): Promise<DealerPickupAction[]> {
  const deals = await prisma.deal.findMany({
    where: { offer: { dealerId }, pickup: { status: { in: DEALER_PICKUP_ACTION_STATUSES } } },
    select: {
      id: true,
      createdAt: true,
      buyer: { select: { city: true, state: true } },
      pickup: {
        select: {
          status: true,
          scheduledAt: true,
          proposedTime: true,
          proposedAt: true,
          proposedBy: true,
          counterCount: true,
          qrCodeImage: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return deals
    .filter((d) => d.pickup)
    .map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      buyerCity: d.buyer?.city ?? null,
      buyerState: d.buyer?.state ?? null,
      pickup: d.pickup!,
    }));
}
