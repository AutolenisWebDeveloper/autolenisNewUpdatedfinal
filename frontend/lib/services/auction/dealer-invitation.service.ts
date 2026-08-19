// lib/services/auction/dealer-invitation.service.ts
// System 3 ENH — Dealer invitation scoring and capacity throttling

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { sendDealerAuctionInvitationEmail } from "@/lib/services/email/resend.service";
import { syncGhlTag } from "@/lib/services/ghl/tag-sync";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { dispatch } from "@/lib/qstash/dispatch";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { lookupCity, type LatLng } from "@/lib/utils/zip-coords";
import { getPreferredMakes } from "@/lib/services/auction/auction-capacity.service";
import { selectCoverageRadius } from "@/lib/services/auction/coverage.service";

const MAX_INVITATIONS_PER_AUCTION = 8;
// Widest invite radius, applied as a real cutoff when we have buyer coordinates
// but no ZIP to run the coverage ladder (city-only buyer). NOT a fail-open
// bypass: an unplaceable buyer invites zero (see the fail-closed early return in
// inviteDealersToAuction), and this radius still filters coordless dealers out.
const MAX_DISTANCE_MILES = 150;
// Y4 — ranking BONUS when a dealer's declared makes intersect the auction's
// requested make(s). A bonus ONLY: a non-matching dealer is never excluded.
const MAKE_MATCH_BONUS = 25;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Score factors for dealer invitation
interface InvitationScore {
  dealerId: string;
  score: number;
  factors: Record<string, number>;
}

async function scoreDealerForAuction(dealerId: string, vehicleTypes: string[]): Promise<number> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    include: {
      scorecardSnapshots: { orderBy: { snapshotDate: "desc" }, take: 1 },
      _count: { select: { invitations: { where: { auction: { status: "ACTIVE" } } } } },
    },
  });

  if (!dealer || dealer.status !== "ACTIVE") return 0;

  let score = 50; // Base score

  // Tier bonus
  const tierBonus: Record<string, number> = { PLATINUM: 30, GOLD: 20, STANDARD: 10, PROBATION: -20 };
  score += tierBonus[dealer.tier] ?? 0;

  // Capacity check — subtract if overloaded
  score -= dealer.currentAuctionLoad * 5;
  if (dealer.currentAuctionLoad >= 5) return 0; // Max capacity

  // Recent scorecard performance
  const snapshot = dealer.scorecardSnapshots[0];
  if (snapshot) {
    score += snapshot.offerWinRate * 20;
    score -= snapshot.junkFeeRatio * 15;
  }

  // Y4 — vehicle/make-match BONUS (never a gate). A dealer whose self-declared
  // preferredMakes intersect the auction's requested make(s) ranks higher, but a
  // non-matching dealer keeps its base score and can still be invited.
  if (vehicleTypes.length > 0) {
    const dealerMakes = await getPreferredMakes(dealerId);
    score += makeMatchBonus(dealerMakes, vehicleTypes);
  }

  return Math.max(0, Math.round(score));
}

// Pure Y4 make-match bonus: a positive bonus when the dealer's makes intersect
// the auction's requested make(s) (case-insensitive), else 0. NEVER negative and
// NEVER excludes — it can only raise a matching dealer's rank, never drop a
// non-matching one below the field.
export function makeMatchBonus(dealerMakes: string[], auctionMakes: string[]): number {
  const wanted = new Set(auctionMakes.map((m) => m.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return 0;
  return dealerMakes.some((m) => wanted.has(m.trim().toLowerCase())) ? MAKE_MATCH_BONUS : 0;
}

// Pure geo-filter for invitations — FAIL CLOSED. Returns only entries whose
// coordinates lie within `radiusMiles` of the buyer. Two invariants encode
// "never invite everyone": (1) if the buyer has no coordinates we return [] —
// an unplaceable buyer means we can't confirm anyone is in range, so we invite
// no one rather than fall back to the whole active roster; (2) an entry with no
// coordinates is EXCLUDED — an unplaceable dealer can't be confirmed local, and
// inviting one is the reputation/geographic-relevance risk Block A closes.
export function pickNearbyDealers<T extends { coords: LatLng | null }>(
  entries: T[],
  buyerCoords: LatLng | null,
  radiusMiles: number,
): T[] {
  if (!buyerCoords) return [];
  return entries.filter(
    (e) =>
      e.coords != null &&
      haversineMiles(buyerCoords.lat, buyerCoords.lng, e.coords.lat, e.coords.lng) <= radiusMiles,
  );
}

// A4 — ensure the auction carries the buyer's requested vehicle (the make signal)
// so scoring can make-match and the invite email names the real vehicle.
// Idempotent: if an AuctionVehicle already exists (e.g. admin-provided), it is
// used as-is and never overwritten. Degrades gracefully: no (non-cancelled)
// VehicleRequest or no make → returns empty makes and the invite proceeds
// make-agnostic (bonus simply doesn't apply).
export async function ensureAuctionVehicleFromRequest(
  auctionId: string,
  buyerId: string,
): Promise<{ makes: string[]; primary: { make: string | null; model: string | null; year: number | null } | null }> {
  const existing = await prisma.auctionVehicle.findFirst({
    where: { auctionId },
    select: { make: true, model: true, year: true },
  });
  if (existing) {
    return { makes: existing.make ? [existing.make] : [], primary: existing };
  }
  const req = await prisma.vehicleRequest.findFirst({
    where: { buyerId, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    select: { makePreference: true, modelPreference: true, yearMin: true },
  });
  if (!req || !req.makePreference) {
    return { makes: [], primary: null };
  }
  await prisma.auctionVehicle.create({
    data: {
      auctionId,
      make: req.makePreference,
      model: req.modelPreference,
      year: req.yearMin,
    },
  });
  return {
    makes: [req.makePreference],
    primary: { make: req.makePreference, model: req.modelPreference, year: req.yearMin },
  };
}

export async function inviteDealersToAuction(auctionId: string, _buyerId: string): Promise<number> {
  // _buyerId is part of the public signature for callers; buyer is resolved via the auction relation below.

  // Resolve buyer location (for geographic pre-filter and email body)
  const auctionForBuyer = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: {
      endsAt: true,
      buyerId: true,
      buyer: { select: { zip: true, city: true, state: true } },
    },
  });
  const buyerId = auctionForBuyer?.buyerId ?? _buyerId;
  const buyerZip = auctionForBuyer?.buyer?.zip ?? null;

  // A4 — make signal (idempotent): populate AuctionVehicle from the buyer's latest
  // request so scoring can make-match and the email names the real vehicle.
  const { makes: auctionMakes, primary } = await ensureAuctionVehicleFromRequest(auctionId, buyerId);

  // Y3 — pick the invite radius via the ONE shared coverage ladder. Escalate on
  // REGISTERED availability toward the invite CAP (not the soft-hold floor): widen
  // until we can fill the competitive field (≥ MAX_INVITATIONS_PER_AUCTION
  // registered) as locally as possible, else the widest tier. Only registered
  // dealers are invitable pre-Block-C, so a prospect-dense/registered-sparse local
  // area still widens to reach distant registered dealers rather than under-filling.
  // includeProspects:false — this ladder reads only `registered`, so it must not
  // pay for prospect resolution (that's Block C / Y2's job).
  // Buyer coordinates, FAIL CLOSED: ZIP geocode first, then static city+state
  // (no API key needed). If neither resolves, buyerCoords stays null and NO
  // dealers are invited below (pickNearbyDealers returns []) — we never fall
  // back to inviting the whole active roster.
  const zipCoords = buyerZip ? await geocodeZip(buyerZip) : null;
  const buyerCity = auctionForBuyer?.buyer?.city ?? null;
  const buyerState = auctionForBuyer?.buyer?.state ?? null;
  const buyerCoords: LatLng | null =
    (zipCoords ? { lat: zipCoords.lat, lng: zipCoords.lng } : null) ??
    (buyerCity && buyerState ? lookupCity(buyerCity, buyerState) : null);

  // Radius: the coverage ladder assesses by the buyer's ZIP, so only run it when
  // we have ZIP coords. A city-only buyer can still be geo-filtered (via the
  // static city coords) but at the widest nominal radius, since the ladder can't
  // meaningfully assess tiers without the ZIP.
  const radiusMiles = zipCoords
    ? (await selectCoverageRadius(auctionId, {
        includeProspects: false,
        stopWhen: (c) => c.registered >= MAX_INVITATIONS_PER_AUCTION,
      })).radiusMiles
    : MAX_DISTANCE_MILES;

  if (!buyerCoords) {
    // Fail closed: with no buyer location we can't confirm any dealer is in range,
    // so we invite NO ONE (never the whole active roster). Return early — the
    // outcome is already fixed, so skip the dealer query and the per-dealer
    // geocode calls that would otherwise run and be discarded.
    logger.warn(
      `[dealer-invitation] buyer for auction ${auctionId} is not geocodable ` +
        `(zip=${buyerZip ?? "none"}, city=${buyerCity ?? "none"}, state=${buyerState ?? "none"}) — ` +
        `no dealers invited (fail closed). Set GOOGLE_GEOCODING_API_KEY to widen geocoding coverage.`,
    );
    return 0;
  }

  // Get active dealers. Exclude the system "Outside Dealer" placeholder.
  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE", isSystemPlaceholder: false },
    select: { id: true, zip: true, latitude: true, longitude: true },
  });

  // Resolve each dealer's coordinates (Y5 persisted coords first, then a live
  // ZIP geocode), then geo-filter FAIL CLOSED via pickNearbyDealers: a dealer
  // with no resolvable coords is excluded, and if the buyer is unplaceable no
  // dealers pass at all.
  const withCoords = await Promise.all(
    dealers.map(async (d) => {
      let coords: LatLng | null =
        d.latitude != null && d.longitude != null ? { lat: d.latitude, lng: d.longitude } : null;
      if (!coords && d.zip) {
        const g = await geocodeZip(d.zip);
        coords = g ? { lat: g.lat, lng: g.lng } : null;
      }
      return { dealer: d, coords };
    }),
  );
  const nearbyDealers = pickNearbyDealers(withCoords, buyerCoords, radiusMiles).map((e) => e.dealer);

  const scores: InvitationScore[] = await Promise.all(
    nearbyDealers.map(async (d) => ({
      dealerId: d.id,
      score: await scoreDealerForAuction(d.id, auctionMakes),
      factors: {},
    }))
  );

  // Sort by score, take top MAX_INVITATIONS_PER_AUCTION
  const topDealers = scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INVITATIONS_PER_AUCTION);

  // Create invitations
  const invitations = await Promise.all(
    topDealers.map(({ dealerId, score }) =>
      prisma.auctionInvitation.upsert({
        where: { auctionId_dealerId: { auctionId, dealerId } },
        create: { auctionId, dealerId, invitationScore: score, sentAt: new Date() },
        update: { invitationScore: score },
      })
    )
  );

  // Update dealer auction load
  await prisma.dealer.updateMany({
    where: { id: { in: topDealers.map(d => d.dealerId) } },
    data: { currentAuctionLoad: { increment: 1 } },
  });

  // Notify invited dealers (in-app notification + email)
  for (const { dealerId } of topDealers) {
    const dealer = await prisma.dealer.findUnique({
      where: { id: dealerId },
      select: {
        dealershipName: true,
        user: { select: { email: true } },
      },
    });

    // In-app notification (existing)
    await prisma.notification.create({
      data: {
        dealerId,
        title: "New Auction Invitation",
        body: "You have been invited to submit an offer. The auction closes in 48 hours.",
        type: "AUCTION_STARTED",
      },
    }).catch(() => {});

    // Email notification (non-blocking)
    if (dealer?.user?.email) {
      await sendDealerAuctionInvitationEmail({
        to: dealer.user.email,
        contactName: dealer.dealershipName ?? "Dealer",
        // A4 — name the real requested vehicle when we have it (falls back to the
        // generic placeholders only when no make signal exists).
        vehicleMake: primary?.make ?? "Vehicle",
        vehicleModel: primary?.model ?? "Requested",
        vehicleYear: primary?.year ?? new Date().getFullYear(),
        vehicleTrim: null,
        buyerCity: auctionForBuyer?.buyer?.city ?? "Location",
        buyerState: auctionForBuyer?.buyer?.state ?? "TBD",
        auctionUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/dealer/opportunities`,
        expiryHours: AUCTION_DURATION_HOURS,
        auctionId,
      }).catch(err =>
        logger.error(`[dealer-invitation] email failed for dealer ${dealerId}:`, err)
      );
    }

    // QStash — dealer invitation notification + bid-deadline reminders.
    if (dealer?.user?.email) {
      dispatch({
        path: "/api/jobs/dealer-invited",
        body: {
          dealerId,
          firstName: dealer.dealershipName ?? "Dealer",
          email: dealer.user.email,
          auctionId,
          expiresAt: auctionForBuyer?.endsAt?.toISOString() ?? null,
        },
      }).catch(() => {});
    }

    syncGhlTag(dealer?.user?.email, "dealer-invited");
  }

  return invitations.length;
}

// Decrement auction load when auction closes
export async function releaseAuctionLoad(auctionId: string): Promise<void> {
  const invitations = await prisma.auctionInvitation.findMany({
    where: { auctionId },
    select: { dealerId: true },
  });

  if (invitations.length) {
    await prisma.dealer.updateMany({
      where: { id: { in: invitations.map(i => i.dealerId) } },
      data: { currentAuctionLoad: { decrement: 1 } },
    });
  }
}
