// Block A / A3 — auction coverage assessment (shared primitive).
//
// Counts how many DISTINCT, CONTACTABLE dealerships sit within `radiusMiles` of
// the buyer, spanning both pools (registered Dealers + DealerProspects),
// rooftop-deduped (prefer registered). A prospect counts ONLY if
// resolveContactableEmail clears it as send-safe (contactable == send-safe), so
// coverage can never overstate what Block C can actually contact.
//
// This is the shared primitive Y3 (radius-escalation ladder, A4) and Y2
// (request-time gate, Block B) both consume. Resolution is a beneficial side
// effect: assessing coverage over freshly-discovered (email:null) prospects
// resolves + persists their contact so the count is real and Block C can reuse it.
//
// All effects injectable. `MIN_COVERAGE_DEALERS` is the named threshold callers
// escalate/soft-hold against.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { haversineMiles, boundingBox, type LatLng } from "@/lib/utils/zip-coords";
import { resolveContactableEmail } from "@/lib/services/dealer-recruitment/contact-resolution.service";
import { missingEmailEnvVars } from "@/lib/services/dealer-recruitment/email-channel-config";

// Mirror the invite engine's hard capacity cut (dealer-invitation.service.ts:50)
// so coverage counts only registered dealers that could actually BE invited.
const DEALER_MAX_AUCTION_LOAD = 5;

// The minimum distinct contactable dealerships an auction needs before it's
// considered adequately covered. Below this, callers escalate radius (Y3) or
// soft-hold + recruit (Y2). Named constant — the right value depends on live
// dealer density, so it lives here for one-line tuning.
export const MIN_COVERAGE_DEALERS = 3;

// Cap prospects scanned per assessment so a dense metro can't fan out unbounded
// resolution work (each unresolved prospect may cost an MX lookup / LLM call).
const MAX_PROSPECTS_PER_ASSESS = 60;

export interface CoverageResult {
  coverage: number; // distinct contactable dealerships within radius
  registered: number;
  prospects: number;
  radiusMiles: number;
  buyerGeocoded: boolean;
}

export interface CoverageDeps {
  prisma: PrismaClient;
  geocode: (zip: string) => Promise<LatLng | null>;
  // Platform precondition the real send path checks first (missingEmailEnvVars):
  // if the outreach channel isn't configured, NO prospect can actually be sent to,
  // so none may count as contactable — else a deposit charges into an auction
  // Block C would populate to zero.
  channelConfigured: () => boolean;
  boundingBox: (center: LatLng, radiusMiles: number) => { minLat: number; maxLat: number; minLng: number; maxLng: number };
  resolveContact: typeof resolveContactableEmail;
  haversine: (a: LatLng, b: LatLng) => number;
}

const defaultGeocode = async (zip: string): Promise<LatLng | null> => {
  const r = await geocodeZip(zip);
  return r ? { lat: r.lat, lng: r.lng } : null;
};

export async function assessAuctionCoverage(
  auctionId: string,
  radiusMiles: number,
  deps?: Partial<CoverageDeps>,
): Promise<CoverageResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const geocode = deps?.geocode ?? defaultGeocode;
  const resolveContact = deps?.resolveContact ?? resolveContactableEmail;
  const haversine = deps?.haversine ?? haversineMiles;
  const channelConfigured = deps?.channelConfigured ?? (() => missingEmailEnvVars().length === 0);
  const bbox = deps?.boundingBox ?? boundingBox;

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    select: { buyer: { select: { zip: true } } },
  });
  const buyerZip = auction?.buyer?.zip ?? null;
  const buyerCoords = buyerZip ? await geocode(buyerZip) : null;

  // Fail OPEN toward inclusion when the buyer can't be geocoded: without coords we
  // can't filter by radius, so counting all contactable candidates avoids WRONGLY
  // soft-holding a deposit (the dangerous direction). Flagged via buyerGeocoded.
  const withinRadius = (lat: number | null | undefined, lng: number | null | undefined): boolean => {
    if (!buyerCoords) return true;
    if (lat == null || lng == null) return false; // unknown location can't be placed in-radius
    return haversine(buyerCoords, { lat, lng }) <= radiusMiles;
  };

  const countedRooftops = new Set<string>();

  // Registered ACTIVE dealers are already onboarded → contactable via their account
  // (internal AuctionInvitation), so they count without a cold-contact resolve.
  // Mirror the invite engine's hard capacity cut so we don't count dealers that are
  // already full and would never actually be invited (M2 over-count guard).
  const dealers = await prisma.dealer.findMany({
    where: {
      status: "ACTIVE",
      isSystemPlaceholder: false,
      currentAuctionLoad: { lt: DEALER_MAX_AUCTION_LOAD },
    },
    select: { id: true, latitude: true, longitude: true, rooftopId: true },
  });
  let registered = 0;
  for (const d of dealers) {
    // Registered dealers with unknown coords are INCLUDED (they're not cold; this
    // mirrors the existing invite geo-filter's fail-open for missing coords).
    const include = !buyerCoords || d.latitude == null || d.longitude == null
      ? true
      : haversine(buyerCoords, { lat: d.latitude, lng: d.longitude }) <= radiusMiles;
    if (!include) continue;
    registered += 1;
    if (d.rooftopId) countedRooftops.add(d.rooftopId);
  }

  // Prospects can only count if the outreach channel is actually configured —
  // otherwise every prospect send would fail and coverage would lie (M3).
  const prospectsSendable = channelConfigured();
  if (!prospectsSendable) {
    logger.warn(
      `[coverage] outreach channel not configured — excluding all prospects from coverage for auction ${auctionId}`,
    );
  }

  // Geo-scope the prospect query to a bounding box around the buyer BEFORE `take`,
  // so the cap selects from the right area (M1 fix — the stored distanceMiles is
  // relative to discovery origin, not this buyer, so ordering+take on it could
  // select 60 out-of-radius rows and miss in-radius ones). Exact radius is still
  // applied in-memory below. When the buyer isn't geocodable we can't box — fail
  // open and cap.
  const prospectRows = prospectsSendable
    ? await prisma.dealerProspect.findMany({
        where: {
          status: { notIn: ["DEAD", "ONBOARDED"] },
          ...(buyerCoords
            ? (() => {
                const bb = bbox(buyerCoords, radiusMiles);
                return {
                  latitude: { gte: bb.minLat, lte: bb.maxLat },
                  longitude: { gte: bb.minLng, lte: bb.maxLng },
                };
              })()
            : {}),
        },
        select: {
          id: true, name: true, website: true, city: true, state: true,
          email: true, emailVerificationStatus: true, latitude: true, longitude: true, rooftopId: true,
        },
        orderBy: [{ distanceMiles: "asc" }, { searchScore: "desc" }],
        take: MAX_PROSPECTS_PER_ASSESS,
      })
    : [];

  let prospects = 0;
  for (const p of prospectRows) {
    if (!withinRadius(p.latitude, p.longitude)) continue;
    // Rooftop dedup — prefer registered: a prospect sharing a counted rooftop is
    // the same dealership already counted, skip it.
    if (p.rooftopId && countedRooftops.has(p.rooftopId)) continue;
    let resolved;
    try {
      resolved = await resolveContact({
        id: p.id, name: p.name, website: p.website, city: p.city, state: p.state,
        email: p.email, emailVerificationStatus: p.emailVerificationStatus,
      });
    } catch (err) {
      logger.warn(`[coverage] contact resolution failed for prospect ${p.id}:`, err);
      continue;
    }
    if (resolved.contactable) {
      prospects += 1;
      if (p.rooftopId) countedRooftops.add(p.rooftopId);
    }
  }

  const result: CoverageResult = {
    coverage: registered + prospects,
    registered,
    prospects,
    radiusMiles,
    buyerGeocoded: !!buyerCoords,
  };
  logger.info(
    `[coverage] auction ${auctionId} @ ${radiusMiles}mi: coverage=${result.coverage} ` +
      `(registered=${registered} prospects=${prospects}) buyerGeocoded=${result.buyerGeocoded}`,
  );
  return result;
}
