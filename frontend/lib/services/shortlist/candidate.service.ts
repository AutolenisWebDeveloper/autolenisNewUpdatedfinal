// lib/services/shortlist/candidate.service.ts
//
// THE CANDIDATE MODEL (§22a; Phase 4 Stage 4).
//
// A shortlist entry is what the buyer SAVED. A candidate — an `auction_vehicles` row scoped to
// their Vehicle Request — is what dealers will actually be asked to bid on. The two are not the
// same and the gap between them is time: a car saved on Monday may be sold, repriced, relisted
// under a different VIN, moved to another rooftop, or simply not seen again by Friday.
// `revalidateCandidate` is the check that runs before that gap can hurt anyone.
//
// WHAT REVALIDATION DROPS, AND WHAT IT ONLY REPORTS.
//
//   DROPS   the listing row is gone; it is inactive or unpriced; its VIN changed (that is a
//           different car under the same id); it has not been seen in 30 days; it can no
//           longer be placed; or it is now beyond the 100-mile policy radius. Each of these
//           makes the candidate unauctionable, and each is the same rule `shortlistGate`
//           applies at add time — one policy, checked twice, because the world moves.
//
//   REPORTS a price change, or a move that is still inside the radius. The candidate stays
//           ACTIVE, the snapshot is refreshed, and `changed` names what moved so a surface can
//           show the buyer. A price rise is NOT a drop even when it lands above the buyer's
//           approved amount: R58's over-ceiling flag was deliberately deferred (owner ruling
//           2026-09-10 — an assumed tax rate producing a number a buyer reads as real is a
//           claim we cannot support), and dropping a car for the same unsupportable arithmetic
//           would be the stronger version of the thing that ruling refused.
//
// A STRUCTURAL CONSTRAINT, REPORTED RATHER THAN WORKED AROUND. `auction_vehicles.auction_id` is
// NOT NULL in production's physical schema, so a candidate row cannot exist before an auction
// does — and the auction is created at deposit settlement, which is Stage 5. At Stage 4 the
// SHORTLIST is therefore the candidate set, and `promoteShortlistToCandidates` materialises it
// the moment an auction exists. Making `auction_id` nullable would be a schema change this
// phase was not scoped for and is not attempted here.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";
import {
  shortlistGate, distanceMilesBetween, freshnessOf, SHORTLIST_RADIUS_MILES,
} from "./shortlist-radius";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";

/** Why a candidate can no longer be auctioned. Distinct from a fact that merely CHANGED. */
export type CandidateDropReason =
  | "LISTING_GONE"
  | "UNAVAILABLE"
  | "VIN_CHANGED"
  | "STALE_LISTING"
  | "DISTANCE_UNKNOWN"
  | "OUT_OF_RADIUS";

/** A fact that moved since the buyer chose the car. Reported, not necessarily fatal. */
export type CandidateChange = "price" | "vin" | "location" | "availability" | "freshness";

export interface RevalidationVerdict {
  candidateId: string;
  status: "ACTIVE" | "DROPPED";
  changed: CandidateChange[];
  dropReason?: CandidateDropReason;
  distanceMiles: number | null;
  priceCents: number | null;
}

/** The facts a candidate snapshot holds. Anything not here is not revalidated. */
interface ListingSnapshot {
  vin?: string | null;
  priceCents?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  lastSeenAt?: string | null;
  distanceMiles?: number | null;
  capturedAt?: string;
}

function snapshotOf(
  listing: { vin: string | null; priceCents: number; latitude: unknown; longitude: unknown; city: string | null; state: string | null; lastSeenAt: Date | null },
  distanceMiles: number | null,
  now: Date,
): ListingSnapshot {
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : v == null ? null : Number(v);
    return n != null && Number.isFinite(n) ? n : null;
  };
  return {
    vin: listing.vin,
    priceCents: listing.priceCents,
    latitude: num(listing.latitude),
    longitude: num(listing.longitude),
    city: listing.city,
    state: listing.state,
    lastSeenAt: listing.lastSeenAt ? listing.lastSeenAt.toISOString() : null,
    distanceMiles,
    capturedAt: now.toISOString(),
  };
}

/** Buyer coordinates, placed through the geocoder rather than the 128-entry static table. */
async function buyerCoords(buyerId: string | null): Promise<{ lat: number; lng: number } | null> {
  if (!buyerId) return null;
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { zip: true, latitude: true, longitude: true } });
  if (buyer?.latitude != null && buyer?.longitude != null) return { lat: buyer.latitude, lng: buyer.longitude };
  if (!buyer?.zip) return null;
  const placed = await geocodeZip(buyer.zip);
  return placed ? { lat: placed.lat, lng: placed.lng } : null;
}

/**
 * Re-check one candidate against the live listing and record the verdict.
 *
 * Always writes `revalidatedAt`, even when nothing changed: "we checked and it was fine" and
 * "nobody has looked since Monday" are different states, and a column that only moves on bad
 * news cannot tell them apart.
 */
export async function revalidateCandidate(candidateId: string, now: Date = new Date()): Promise<RevalidationVerdict> {
  const candidate = await prisma.auctionVehicle.findUnique({
    where: { id: candidateId },
    select: {
      id: true, inventoryItemId: true, candidateStatus: true, listingSnapshot: true,
      distanceMiles: true,
      auction: { select: { buyerId: true } },
      vehicleRequest: { select: { buyerId: true } },
    },
  });
  if (!candidate) throw new Error(`candidate ${candidateId} not found`);

  const drop = async (reason: CandidateDropReason, changed: CandidateChange[], distanceMiles: number | null, priceCents: number | null): Promise<RevalidationVerdict> => {
    await prisma.auctionVehicle.update({
      where: { id: candidateId },
      data: { candidateStatus: "DROPPED", droppedReason: reason, revalidatedAt: now, distanceMiles },
      select: { id: true },
    });
    return { candidateId, status: "DROPPED", changed, dropReason: reason, distanceMiles, priceCents };
  };

  // A candidate with no listing behind it is an admin-entered vehicle, not a swept one: there is
  // nothing to revalidate against, so it is left exactly as it is.
  if (!candidate.inventoryItemId) {
    await prisma.auctionVehicle.update({ where: { id: candidateId }, data: { revalidatedAt: now }, select: { id: true } });
    return { candidateId, status: candidate.candidateStatus === "DROPPED" ? "DROPPED" : "ACTIVE", changed: [], distanceMiles: candidate.distanceMiles, priceCents: null };
  }

  const listing = await prisma.inventoryItem.findUnique({
    where: { id: candidate.inventoryItemId },
    select: {
      id: true, vin: true, priceCents: true, isActive: true, lastSeenAt: true,
      lane: true, dealerId: true, addedByAdminId: true,
      latitude: true, longitude: true, city: true, state: true,
    },
  });
  if (!listing) return drop("LISTING_GONE", ["availability"], candidate.distanceMiles, null);

  const snap = (candidate.listingSnapshot ?? {}) as ListingSnapshot;
  const coords = await buyerCoords(candidate.vehicleRequest?.buyerId ?? candidate.auction?.buyerId ?? null);
  const raw = distanceMilesBetween(coords, listing.latitude, listing.longitude);
  const distanceMiles = raw === null ? null : Math.round(raw * 10) / 10;

  const changed: CandidateChange[] = [];
  if (snap.priceCents != null && snap.priceCents !== listing.priceCents) changed.push("price");
  if (snap.vin != null && listing.vin != null && snap.vin !== listing.vin) changed.push("vin");
  if (snap.distanceMiles != null && distanceMiles != null && Math.abs(snap.distanceMiles - distanceMiles) >= 1) {
    changed.push("location");
  }
  const freshness = freshnessOf(listing.lastSeenAt, now);
  if (snap.lastSeenAt && freshness !== "FRESH") changed.push("freshness");

  // A VIN change under the same row id is a DIFFERENT CAR. Checked before the gate because the
  // gate would happily approve the replacement — it is active, near and fresh — and the buyer
  // would arrive at an auction for a vehicle they never chose.
  if (changed.includes("vin")) return drop("VIN_CHANGED", changed, distanceMiles, listing.priceCents);

  const gate = shortlistGate(
    {
      distanceMiles,
      isActive: listing.isActive,
      priceCents: listing.priceCents,
      lastSeenAt: listing.lastSeenAt,
      lane: listing.lane,
      dealerId: listing.dealerId,
      addedByAdminId: listing.addedByAdminId,
    },
    { hasZip: coords !== null },
    now,
  );

  if (gate.action !== "ADD") {
    const reason: CandidateDropReason =
      gate.reason === "UNAVAILABLE" ? "UNAVAILABLE"
      : gate.reason === "STALE_LISTING" ? "STALE_LISTING"
      : gate.reason === "OUT_OF_RADIUS" ? "OUT_OF_RADIUS"
      : "DISTANCE_UNKNOWN";
    if (!changed.includes("availability") && reason === "UNAVAILABLE") changed.push("availability");
    return drop(reason, changed, distanceMiles, listing.priceCents);
  }

  await prisma.auctionVehicle.update({
    where: { id: candidateId },
    data: {
      candidateStatus: "ACTIVE",
      droppedReason: null,
      revalidatedAt: now,
      distanceMiles,
      listingSnapshot: snapshotOf(listing, distanceMiles, now) as object,
    },
    select: { id: true },
  });
  return { candidateId, status: "ACTIVE", changed, distanceMiles, priceCents: listing.priceCents };
}

/** Re-check every non-dropped candidate on a request. Failures are isolated per candidate. */
export async function revalidateRequestCandidates(vehicleRequestId: string, now: Date = new Date()): Promise<RevalidationVerdict[]> {
  const rows = await prisma.auctionVehicle.findMany({
    where: { vehicleRequestId, candidateStatus: { not: "DROPPED" } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const out: RevalidationVerdict[] = [];
  for (const r of rows) {
    try {
      out.push(await revalidateCandidate(r.id, now));
    } catch (e) {
      // One bad candidate must not stop the rest being checked before an auction opens.
      logger.warn(`[candidates] revalidation failed for ${r.id}:`, e);
    }
  }
  return out;
}

export interface PromotionResult {
  created: string[];
  /** Shortlist entries not promoted, with the gate's own reason. */
  skipped: Array<{ inventoryItemId: string; reason: string }>;
  /** Candidates that already existed for this request. */
  existing: number;
}

/**
 * Materialise the buyer's shortlist as candidates on their request, capped at five.
 *
 * The cap is enforced three times and that is deliberate: `MAX_SHORTLIST_ITEMS` here (the
 * friendly path), `auction_vehicles_enforce_cap_trg` in the database (the one that actually
 * holds under concurrency, BEFORE INSERT with FOR UPDATE on the request), and
 * `shortlist_items_enforce_cap_trg` upstream on the shortlist itself.
 *
 * Idempotent: an inventory item already standing as a non-dropped candidate on this request is
 * counted, not duplicated.
 */
export async function promoteShortlistToCandidates(
  buyerId: string,
  target: { auctionId: string; vehicleRequestId: string },
  now: Date = new Date(),
): Promise<PromotionResult> {
  const result: PromotionResult = { created: [], skipped: [], existing: 0 };

  const shortlist = await prisma.shortlist.findUnique({
    where: { buyerId },
    select: { items: { select: { inventoryItemId: true, addedAt: true }, orderBy: { addedAt: "asc" } } },
  });
  if (!shortlist || shortlist.items.length === 0) return result;

  const already = await prisma.auctionVehicle.findMany({
    where: { vehicleRequestId: target.vehicleRequestId, candidateStatus: { not: "DROPPED" } },
    select: { inventoryItemId: true },
  });
  const claimed = new Set(already.map((a) => a.inventoryItemId).filter(Boolean) as string[]);
  result.existing = already.length;

  const coords = await buyerCoords(buyerId);

  for (const item of shortlist.items) {
    if (result.existing + result.created.length >= MAX_SHORTLIST_ITEMS) {
      result.skipped.push({ inventoryItemId: item.inventoryItemId, reason: "CAP_REACHED" });
      continue;
    }
    if (claimed.has(item.inventoryItemId)) continue;

    const listing = await prisma.inventoryItem.findUnique({
      where: { id: item.inventoryItemId },
      select: {
        id: true, vin: true, year: true, make: true, model: true, trim: true, mileage: true,
        priceCents: true, isActive: true, lastSeenAt: true, lane: true, dealerId: true,
        addedByAdminId: true, latitude: true, longitude: true, city: true, state: true,
      },
    });
    if (!listing) { result.skipped.push({ inventoryItemId: item.inventoryItemId, reason: "LISTING_GONE" }); continue; }

    const raw = distanceMilesBetween(coords, listing.latitude, listing.longitude);
    const distanceMiles = raw === null ? null : Math.round(raw * 10) / 10;
    const gate = shortlistGate(
      {
        distanceMiles, isActive: listing.isActive, priceCents: listing.priceCents,
        lastSeenAt: listing.lastSeenAt, lane: listing.lane, dealerId: listing.dealerId,
        addedByAdminId: listing.addedByAdminId,
      },
      { hasZip: coords !== null },
      now,
    );
    // Re-gated at promotion, not trusted from add time. Between the two the car may have sold.
    if (gate.action !== "ADD") { result.skipped.push({ inventoryItemId: item.inventoryItemId, reason: gate.reason }); continue; }

    try {
      const row = await prisma.auctionVehicle.create({
        data: {
          auctionId: target.auctionId,
          vehicleRequestId: target.vehicleRequestId,
          inventoryItemId: listing.id,
          year: listing.year, make: listing.make, model: listing.model, trim: listing.trim,
          mileage: listing.mileage,
          candidateStatus: "ACTIVE",
          distanceMiles,
          revalidatedAt: now,
          listingSnapshot: snapshotOf(listing, distanceMiles, now) as object,
        },
        select: { id: true },
      });
      result.created.push(row.id);
    } catch (e) {
      // The database cap (P0001) is the authority. Losing the race is a refusal, not a crash.
      const msg = String((e as Error)?.message ?? "");
      if (/candidate|cap/i.test(msg) || (e as { code?: string })?.code === "P0001") {
        result.skipped.push({ inventoryItemId: item.inventoryItemId, reason: "CAP_REACHED" });
        continue;
      }
      throw e;
    }
  }
  return result;
}

/** Exported for the surfaces that need to state the ceiling without importing the policy twice. */
export const CANDIDATE_RADIUS_MILES = SHORTLIST_RADIUS_MILES;
