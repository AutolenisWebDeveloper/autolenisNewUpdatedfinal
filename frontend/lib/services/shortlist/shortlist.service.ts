// lib/services/shortlist/shortlist.service.ts
//
// THE ONE GATED WRITER for a buyer's shortlist (§22a; Phase 4).
//
// There used to be two. `addToShortlist` here applied the cap and nothing else, while
// `app/api/buyer/shortlist/route.ts` applied the radius/freshness gate, the cap, and the
// duplicate check inline — so a caller reaching the service directly could put a car 400 miles
// away, or one nobody has seen in six weeks, straight into an auction. Two writers means the
// stricter one is optional, and an optional guard is not a guard.
//
// Now: the route parses and authenticates, and every decision is here. The gate's own reason
// code is the API's error code, so the card and the server can never disagree about WHY an
// action is unavailable.
//
// The service returns a RESULT, not an exception. `throw new Error("Shortlist limited to 5
// items")` cannot be turned into an error code by a caller without matching on prose, and the
// route needs a code — `SHORTLIST_FULL` is a different thing to a client than `OUT_OF_RADIUS`.
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";
import { isShortlistItemAvailable } from "./shortlist-availability";
import { shortlistGate, distanceMilesBetween, SHORTLIST_RADIUS_MILES, type GateReason } from "./shortlist-radius";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";

/**
 * Why the shortlist action is unavailable, in the buyer's words.
 *
 * Every message names the way forward. A refusal that only says "no" turns a browsable
 * catalogue into a dead end, which is the failure this whole feature exists to remove.
 */
export const SHORTLIST_REFUSALS: Record<string, string> = {
  NO_ZIP: "Add your ZIP code so we can check which vehicles are close enough to bring to auction.",
  OUT_OF_RADIUS:
    `This vehicle is more than ${SHORTLIST_RADIUS_MILES} miles away, so we cannot bring it to ` +
    `auction. Start a vehicle request and we will find one like it near you.`,
  DISTANCE_UNKNOWN:
    "We cannot confirm where this vehicle is located. Start a vehicle request and we will find one like it near you.",
  STALE_LISTING:
    "This listing has not been seen on the market for over 30 days. Start a vehicle request and we will find one like it near you.",
  UNAVAILABLE:
    "This vehicle is no longer available. Start a vehicle request and we will find one like it near you.",
  NOT_FOUND: "This vehicle is no longer listed. Start a vehicle request and we will find one like it near you.",
  SHORTLIST_FULL: `Your shortlist holds ${MAX_SHORTLIST_ITEMS} vehicles. Remove one to add another.`,
  ALREADY_IN_SHORTLIST: "This vehicle is already on your shortlist.",
  OK: "",
};

export type AddRefusalCode = GateReason | "NOT_FOUND" | "SHORTLIST_FULL" | "ALREADY_IN_SHORTLIST";

export type AddToShortlistResult =
  | { ok: true; item: { id: string; shortlistId: string; inventoryItemId: string; distanceMiles: number | null } }
  | { ok: false; code: AddRefusalCode; message: string };

/**
 * How many of these shortlist entries point at a vehicle that is still on the market.
 *
 * The cap must count AVAILABLE candidates, not rows. ShortlistItem.inventoryItemId has no
 * foreign key and the stale sweep deactivates listings, so a buyer whose saved cars have
 * sold would otherwise be told their shortlist is full while holding zero usable
 * candidates — locked out of adding the replacement for the car that just sold.
 */
export async function countAvailableItems(
  items: Array<{ inventoryItemId: string }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: items.map(i => i.inventoryItemId) } },
    select: { id: true, isActive: true, priceCents: true },
  });
  const byId = new Map(rows.map(r => [r.id, r]));
  // A missing row counts as unavailable — it is simply gone.
  return items.reduce(
    (n, i) => n + (isShortlistItemAvailable(byId.get(i.inventoryItemId) ?? null) ? 1 : 0),
    0,
  );
}

export async function getOrCreateShortlist(buyerId: string) {
  return prisma.shortlist.upsert({ where: { buyerId }, create: { buyerId }, update: {}, include: { items: true } });
}

/**
 * Distance from the buyer to a listing, or null when either end cannot be placed.
 *
 * Placed through `geocodeZip` (static table -> cached Google -> Google, fail-closed) rather
 * than the 128-entry static table alone, which does not hold 76011 — the market production is
 * configured for.
 */
async function distanceFor(
  buyerId: string,
  vehicle: { latitude: unknown; longitude: unknown },
): Promise<{ distanceMiles: number | null; hasZip: boolean }> {
  const buyerRow = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { zip: true } });
  const coords = buyerRow?.zip ? await geocodeZip(buyerRow.zip) : null;
  const raw = distanceMilesBetween(coords, vehicle.latitude, vehicle.longitude);
  return { distanceMiles: raw === null ? null : Math.round(raw * 10) / 10, hasZip: !!coords };
}

/**
 * Add a listing to the buyer's shortlist, or say why not.
 *
 * Order: the vehicle must exist, the GATE must allow it, the cap must have room, and it must
 * not already be there. The gate runs BEFORE the cap deliberately — a buyer told "your
 * shortlist is full" about a car they were never allowed to add has been told the wrong thing.
 *
 * `distanceMiles` is written at insert time. It was declared by the Phase 1 wave and never
 * populated: all 15 production rows carry NULL, so nothing downstream could tell a candidate
 * 4 miles away from one 400 miles away without recomputing from coordinates the old adapter
 * had never written. It is a SNAPSHOT of the distance when the buyer chose the car;
 * `revalidateCandidate` is what re-checks it later.
 */
export async function addToShortlist(buyerId: string, inventoryItemId: string): Promise<AddToShortlistResult> {
  const refuse = (code: AddRefusalCode): AddToShortlistResult =>
    ({ ok: false, code, message: SHORTLIST_REFUSALS[code] ?? "This vehicle cannot be added." });

  // Narrowed to the gate's inputs: an unnarrowed read returns every declared column and raises
  // P2022 in the window between a deploy and its migration.
  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    select: {
      id: true, isActive: true, priceCents: true, lastSeenAt: true,
      lane: true, dealerId: true, addedByAdminId: true, latitude: true, longitude: true,
    },
  });
  if (!vehicle) return refuse("NOT_FOUND");

  // Radius + freshness, enforced HERE and not only in the card. The UI decides which button to
  // render; the server decides what is allowed. Fail CLOSED on an unplaceable buyer — the
  // opposite of assessCoverageForZip, and deliberately so: wrongly soft-holding a deposit is
  // the dangerous direction there, whereas here the buyer loses nothing by being routed to a
  // custom Vehicle Request, and every refusal above offers exactly that route.
  const { distanceMiles, hasZip } = await distanceFor(buyerId, vehicle);
  const gate = shortlistGate(
    {
      distanceMiles,
      isActive: vehicle.isActive,
      priceCents: vehicle.priceCents,
      lastSeenAt: vehicle.lastSeenAt,
      lane: vehicle.lane,
      dealerId: vehicle.dealerId,
      addedByAdminId: vehicle.addedByAdminId,
    },
    { hasZip },
  );
  if (gate.action !== "ADD") return refuse(gate.reason);

  const shortlist = await getOrCreateShortlist(buyerId);

  if (shortlist.items.some(i => i.inventoryItemId === inventoryItemId)) {
    return refuse("ALREADY_IN_SHORTLIST");
  }
  // The cap counts AVAILABLE candidates, not rows: five dead entries would otherwise report
  // "5 of 5 full" while the auction has zero candidates in it.
  if (await countAvailableItems(shortlist.items) >= MAX_SHORTLIST_ITEMS) {
    return refuse("SHORTLIST_FULL");
  }

  try {
    const item = await prisma.shortlistItem.create({
      data: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY", distanceMiles },
      select: { id: true, shortlistId: true, inventoryItemId: true, distanceMiles: true },
    });
    return { ok: true, item };
  } catch (e) {
    // `shortlist_items_enforce_cap_trg` is a BEFORE INSERT trigger taking FOR UPDATE on the
    // parent shortlist, so two concurrent adds at four items cannot both land. It raises
    // P0001. The count above is the friendly path; this is the one that actually holds.
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2010" || code === "P0001" || /shortlist/i.test(String((e as Error)?.message))) {
      logger.warn(`[shortlist] database cap refused an add for buyer ${buyerId}`);
      return refuse("SHORTLIST_FULL");
    }
    throw e;
  }
}

/**
 * Remove one entry. Addressable by shortlist-item id or by inventory-item id, because the card
 * knows the vehicle and the list row knows itself; both callers existed before this
 * consolidation and both are preserved.
 */
export async function removeFromShortlist(
  buyerId: string,
  target: string | { itemId?: string; inventoryItemId?: string },
): Promise<{ removed: number }> {
  const sel = typeof target === "string" ? { itemId: target } : target;
  if (!sel.itemId && !sel.inventoryItemId) return { removed: 0 };

  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId }, select: { id: true } });
  if (!shortlist) return { removed: 0 };

  const removed = await prisma.shortlistItem.deleteMany({
    where: {
      shortlistId: shortlist.id,
      ...(sel.itemId ? { id: sel.itemId } : {}),
      ...(sel.inventoryItemId ? { inventoryItemId: sel.inventoryItemId } : {}),
    },
  });
  return { removed: removed.count };
}

/**
 * Backfill `distance_miles` on entries that predate the column being written.
 *
 * Phase 4 writes it forward; this is the other half. All 15 production rows carry NULL, so
 * every candidate reads as "distance unknown" and fails closed — which is safe but wrong for
 * a car that is genuinely nearby. It never overwrites a value that is already there, and a
 * row whose buyer or listing cannot be placed is left NULL rather than given a guess.
 */
export async function backfillShortlistDistances(limit = 500): Promise<{
  scanned: number; updated: number; unplaceable: number;
}> {
  const rows = await prisma.shortlistItem.findMany({
    where: { distanceMiles: null },
    take: limit,
    select: {
      id: true,
      inventoryItem: { select: { latitude: true, longitude: true } },
      shortlist: { select: { buyer: { select: { id: true, zip: true } } } },
    },
  });

  let updated = 0;
  let unplaceable = 0;
  const coordCache = new Map<string, { lat: number; lng: number } | null>();

  for (const row of rows) {
    const zip = row.shortlist?.buyer?.zip ?? null;
    let coords = zip ? coordCache.get(zip) : null;
    if (zip && coords === undefined) {
      const placed = await geocodeZip(zip);
      coords = placed ? { lat: placed.lat, lng: placed.lng } : null;
      coordCache.set(zip, coords);
    }
    const raw = distanceMilesBetween(coords ?? null, row.inventoryItem?.latitude, row.inventoryItem?.longitude);
    if (raw === null) { unplaceable++; continue; }
    await prisma.shortlistItem.update({
      where: { id: row.id },
      data: { distanceMiles: Math.round(raw * 10) / 10 },
      select: { id: true },
    });
    updated++;
  }
  return { scanned: rows.length, updated, unplaceable };
}

export async function getShortlistReadiness(buyerId: string) {
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { preQualification: true } });
  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId }, include: { items: true } });
  const hasPrequal = buyer?.preQualification && buyer.preQualification.expiresAt > new Date();
  // Readiness counts AVAILABLE candidates: a buyer whose every saved car has sold is not
  // ready to auction, however many rows their shortlist holds.
  const itemCount = shortlist ? await countAvailableItems(shortlist.items) : 0;
  return {
    isReady: hasPrequal && itemCount > 0,
    itemCount, hasPrequal: !!hasPrequal,
    nextStep: !hasPrequal ? "complete-prequal" : itemCount === 0 ? "add-vehicles" : "activate-auction",
  };
}
