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

// Y3 radius-escalation ladder tiers (miles), tried tightest-first. Named
// constants because the right radii depend on live dealer density. The ladder
// concentrates invites locally when supply is dense and widens only when sparse.
export const RADIUS_TIERS = [25, 50, 100, 150] as const;

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
  // When false, skip the prospect query + contact resolution entirely (prospects
  // = 0). The A4 invite ladder passes false because it only reads `registered`,
  // so it must not pay for (or repeat, per tier) prospect resolution it discards.
  // Y2 (total-coverage gate) leaves this true. Same helper, not a second path.
  includeProspects: boolean;
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

  // Prospects can only count if the caller wants them (the invite ladder doesn't)
  // AND the outreach channel is actually configured — otherwise every prospect
  // send would fail and coverage would lie.
  const includeProspects = deps?.includeProspects ?? true;
  const prospectsSendable = includeProspects && channelConfigured();
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
          email: true, emailVerificationStatus: true, emailVerifiedAt: true,
          latitude: true, longitude: true, rooftopId: true,
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
        emailVerifiedAt: p.emailVerifiedAt, rooftopId: p.rooftopId,
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

export interface CoverageLadderDeps extends CoverageDeps {
  // Injectable for tests; defaults to the real assessAuctionCoverage bound to deps.
  assess: (auctionId: string, radiusMiles: number) => Promise<CoverageResult>;
  // The stop predicate. Defaults to TOTAL coverage ≥ MIN (the end-state / Y2
  // gate). The A4 invite path passes a REGISTERED-based predicate, because only
  // registered dealers are invitable before Block C — so the ladder must widen
  // until enough INVITABLE-NOW dealers exist rather than stopping early on
  // not-yet-invitable prospects (which would regress distant-registered reach).
  stopWhen?: (c: CoverageResult) => boolean;
}

/**
 * Y3 radius-escalation ladder. Assesses coverage tightest-first and returns the
 * FIRST tier that satisfies `stopWhen` (concentrating invites locally), or the
 * widest tier's result if none does. Uses the ONE shared assessAuctionCoverage —
 * there is no second radius-aware coverage path (Y2's request-time gate consumes
 * the same primitive; only the stop predicate differs).
 */
export async function selectCoverageRadius(
  auctionId: string,
  deps?: Partial<CoverageLadderDeps>,
): Promise<CoverageResult> {
  const assess =
    deps?.assess ?? ((id: string, r: number) => assessAuctionCoverage(id, r, deps));
  const meets = deps?.stopWhen ?? ((c: CoverageResult) => c.coverage >= MIN_COVERAGE_DEALERS);
  let last: CoverageResult | null = null;
  for (const tier of RADIUS_TIERS) {
    const cov = await assess(auctionId, tier);
    last = cov;
    if (meets(cov)) return cov;
  }
  // No tier met the threshold — return the widest assessment (best effort; the
  // caller still invites who it can, and the deposit-activation no-dealer grace
  // owns the terminal soft-hold/close decision).
  return last ?? { coverage: 0, registered: 0, prospects: 0, radiusMiles: RADIUS_TIERS[RADIUS_TIERS.length - 1], buyerGeocoded: false };
}
