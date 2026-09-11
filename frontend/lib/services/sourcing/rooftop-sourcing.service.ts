// lib/services/sourcing/rooftop-sourcing.service.ts
//
// Stage 6 — the server-enforced sourcing ladder, §6b validation, and the §6c outcome.
//
// Turns a paid Vehicle Request into a validated, deduplicated, ranked field of ROOFTOPS
// recorded on its sourcing case. This is the thing §8.2 Phase 5 calls "the sourcing case
// service", and it is what replaces the legacy coverage gate (§13-D36) and the legacy
// A4 invite ladder once §13-D52 flips.
//
// THE UNIT IS A ROOFTOP, NOT A DEALERSHIP. `lib/services/auction/coverage.service.ts`
// counts contactable DEALERSHIPS across two pools and returns a number; §6a/§6c need the
// SET, per-rooftop, with each §6b validation outcome, its band, its distance and the
// candidates it can serve — and §33 step 29 is explicit that the invitation budget is per
// rooftop, not per dealership or per vehicle. So this is a different shape, not a wrapper,
// and it reuses the same primitives (`geocodeZip`, `haversineMiles`, `boundingBox`,
// `resolveContactableEmail`, `missingEmailEnvVars`, the capacity cut) rather than
// reimplementing them.
//
// THE LEGACY COVERAGE STACK IS LEFT RUNNING, DELIBERATELY. `assessCoverageForZip`,
// `selectCoverageRadius` and `inviteDealersToAuction` keep their behaviour because
// `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` defaults OFF and the flip is §13-D52, the
// owner's, which no earlier phase may action. Until it flips, the legacy path is the only
// way a dealer is invited at all. Nothing here is a second writer of anything the legacy
// path writes: this service writes `sourcing_candidates`, which has never had a writer.
//
// FAIL CLOSED ON LOCATION, AND THIS IS THE ONE BEHAVIOURAL DIFFERENCE THAT MATTERS MOST.
// `coverage.service.ts` counts a registered dealer with null coordinates as in-radius even
// when the buyer IS placeable (`:138-141`), while the invite path then discards exactly
// those dealers (`dealer-invitation.service.ts:103-108`). The consequence chain was
// measured in review: coverage reaches 3 at 25 miles entirely on coordless dealers, no soft
// hold fires, the deposit is taken, and `recordZeroInvitations(NO_DEALER_IN_RANGE)` follows
// — the incident class recorded at `buyer-location.service.ts:5-13`, reached THROUGH the
// gate built to prevent it. §10.6 S6-13 requires "coverage counting fails closed (coordless
// rooftop not invitation-ready)". A rooftop we cannot place is not invitation-ready here.
//
// §13-D8 — MATCH ONLY. Rooftops are found among the `dealer_rooftops` AutoLenis already
// holds. Nothing in this file mints a rooftop from a MarketCheck listing, and the
// resolution from a shortlisted listing to its holding rooftop reads the rooftop id the
// ingestion service already resolved (`inventory_items.rooftop_id`). The owner's 2026-09-11
// ruling is BUILD MATCH-ONLY pending the agreement reading, so the pool CEILING is recorded
// on the case and surfaced: a thin field must never be read as a thin market.

import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";
import { haversineMiles, boundingBox, type LatLng } from "@/lib/utils/zip-coords";
import { distanceMilesBetween } from "@/lib/services/shortlist/shortlist-radius";
import { resolveContactableEmail } from "@/lib/services/dealer-recruitment/contact-resolution.service";
import { missingEmailEnvVars } from "@/lib/services/dealer-recruitment/email-channel-config";
import {
  SOURCING_BAND,
  BAND_INNER_MILES,
  effectiveRadiusMiles,
  type SourcingBand,
  type SourcingCaseRecord,
} from "./sourcing-case.service";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Mirrors `DEALER_MAX_AUCTION_LOAD` in `dealer-invitation.service.ts:61` and
 * `coverage.service.ts:28`. A registered dealer already at capacity would never actually
 * be invited, so counting it would overstate the field — the same over-count guard, stated
 * once more here because this service counts rooftops rather than dealers.
 */
const DEALER_MAX_AUCTION_LOAD = 5;

/**
 * How many rooftops one band's scan may examine. The bounding box already narrows to the
 * annulus, so this caps the work a dense metro can fan out, not the reachable market.
 *
 * Deliberately larger than `coverage.service.ts`'s MAX_PROSPECTS_PER_ASSESS of 60, because
 * that cap paid for contact resolution at EVERY tier (up to 4 × 60 per call). Searching the
 * annulus only, and reusing already-validated `sourcing_candidates`, means each rooftop is
 * resolved at most once per case — so the cap can buy real coverage instead of rationing
 * repeated work.
 */
const MAX_ROOFTOPS_PER_BAND = 200;

/** §6c: "More than 8 — rank and invite the best eight." */
export const MAX_INVITATION_FIELD = 8;
/** §6c: "5–8 — launch automatically." */
export const MIN_AUTO_LAUNCH_FIELD = 5;
/** §6c: "3–4 — limited auction, only with audited Operations approval." */
export const MIN_LIMITED_AUCTION_FIELD = 3;

// ───────────────────────────────────────────────────────────────────────────────
// §6b — the validation record
// ───────────────────────────────────────────────────────────────────────────────

/** Machine-readable reasons a rooftop is not invitation-ready. One per §6b item. */
export type ValidationFailure =
  | "NO_PHYSICAL_ROOFTOP"
  | "LOCATION_UNKNOWN"
  | "OUT_OF_BAND"
  | "NO_MAKE_FIT"
  | "OPERATING_STATUS_CLOSED"
  | "DUPLICATE_ROOFTOP"
  | "SUPPRESSED"
  | "NO_DELIVERABLE_CONTACT"
  | "NO_ROLE_FIT"
  | "DEALER_AT_CAPACITY"
  | "DEALER_SUSPENDED";

/**
 * How a rooftop can be reached, recorded per candidate so the two counts §6c needs stay
 * separate all the way to the buyer-facing number.
 *
 * EMAIL is the only automated invitation channel in this phase. CALL_ONLY is a rooftop with
 * a usable phone and no send-safe email: it is NOT invitation-ready for the automated rail,
 * and it is NOT silently dropped either — it becomes an Operations task. SMS is deliberately
 * absent; see the channel note on `countsByChannel` below.
 */
export type RooftopChannel = "EMAIL" | "CALL_ONLY" | "NONE";

export interface RooftopValidation {
  invitationReady: boolean;
  failures: ValidationFailure[];
  distanceMiles: number | null;
  channel: RooftopChannel;
  /** §6b "a relevant sales, Internet Sales, BDC, or management role". */
  roleFit: boolean;
  /**
   * §6b "active operating status", read as a NEGATIVE filter per the owner's D36
   * sub-ruling of 2026-09-11. See `operatingStatusVerdict`.
   */
  operatingStatus: "OK" | "CLOSED" | "UNKNOWN";
  contactEmail: string | null;
  contactName: string | null;
  /** True when the make/inventory-fit item was satisfied by an audited admin override. */
  makeFitOverridden?: boolean;
  /** Which tier of the contact waterfall answered, for the spend record. */
  contactSource: string | null;
}

/**
 * §6b's "active operating status", as the owner ruled it on 2026-09-11.
 *
 * A NEGATIVE FILTER ONLY: exclude a rooftop explicitly marked closed or inactive; the
 * ABSENCE of a value is not evidence of closure. This is a deliberate, stated departure
 * from §6b's literal wording ("confirmed to have ... active operating status"), and the
 * reason is arithmetic: `dealer_rooftops.operating_status` is nullable TEXT that NOTHING
 * has ever written — the only references anywhere are the Phase 1 migration that created
 * it and the Prisma model. A predicate requiring 'ACTIVE' would reject all 1,422 rooftops
 * and produce zero coverage for every buyer, fail-closed, in production. Recorded as a
 * ruling in IMPLEMENTATION-WORKFLOW.md rather than left as a shortcut in code.
 *
 * The column starts being written where we learn it — see `markRooftopClosed`.
 */
export function operatingStatusVerdict(
  operatingStatus: string | null,
): "OK" | "CLOSED" | "UNKNOWN" {
  if (operatingStatus === null || operatingStatus.trim() === "") return "UNKNOWN";
  const v = operatingStatus.trim().toUpperCase();
  if (v === "CLOSED" || v === "INACTIVE" || v === "PERMANENTLY_CLOSED" || v === "OUT_OF_BUSINESS") {
    return "CLOSED";
  }
  return "OK";
}

/** The vocabulary `operating_status` is written with, on the one side we can learn. */
export const ROOFTOP_OPERATING_STATUS = {
  OK: "ACTIVE",
  CLOSED: "CLOSED",
} as const;

// ───────────────────────────────────────────────────────────────────────────────
// Step 0 — candidate → holding rooftop + comparable rooftops (§6a step 0, §33 #29)
// ───────────────────────────────────────────────────────────────────────────────

export interface CandidateRooftopSet {
  /** `inventory_items.rooftop_id` for each shortlisted listing that maps to one. */
  holding: Map<string, string[]>;
  /** Rooftops in band holding the comparable unit, with the candidates they serve. */
  comparable: Map<string, string[]>;
  /** Shortlisted candidate ids (inventory item ids) considered, in shortlist order. */
  candidateIds: string[];
  /** Candidates that resolve to no rooftop at all, reported rather than dropped silently. */
  unmappedCandidateIds: string[];
}

/**
 * §6a step 0 and §33 step 29, over the set the spec actually defines as candidates.
 *
 * §22a L1112 is explicit: "A shortlisted vehicle is a candidate." §10.6 row S6-03 says to
 * resolve "each `auction_vehicles` candidate", and that is a drafting error the owner
 * confirmed on 2026-09-11: `auction_vehicles.auction_id` is NOT NULL
 * (`schema.prisma:566`), so a candidate row cannot exist before an auction does — and this
 * phase creates the auction only AFTER readiness passes. During sourcing there are no
 * `auction_vehicles` rows to resolve.
 *
 * Phase 4 recorded the same constraint and handed the wiring forward:
 * `candidate.service.ts:27-32` — "At Stage 4 the SHORTLIST is therefore the candidate set,
 * and `promoteShortlistToCandidates` materialises it the moment an auction exists". So
 * sourcing reads the shortlist, and `launch-readiness.service.ts` calls that Phase-4
 * function at launch, which is where its only production caller was always going to be.
 */
export async function resolveCandidateRooftops(
  buyerId: string,
  buyerCoords: LatLng | null,
  band: SourcingBand,
  radiusMiles: number,
  db: Db = defaultPrisma,
): Promise<CandidateRooftopSet> {
  const holding = new Map<string, string[]>();
  const comparable = new Map<string, string[]>();
  const unmappedCandidateIds: string[] = [];

  const shortlist = await db.shortlist.findUnique({
    where: { buyerId },
    select: { items: { select: { inventoryItemId: true, addedAt: true }, orderBy: { addedAt: "asc" } } },
  });
  const candidateIds = (shortlist?.items ?? []).map((i) => i.inventoryItemId);
  if (candidateIds.length === 0) {
    return { holding, comparable, candidateIds, unmappedCandidateIds };
  }

  const listings = await db.inventoryItem.findMany({
    where: { id: { in: candidateIds } },
    select: {
      id: true, rooftopId: true, year: true, make: true, model: true, trim: true,
      latitude: true, longitude: true, isActive: true,
    },
  });

  const inner = BAND_INNER_MILES[band];
  const inBand = (lat: unknown, lng: unknown): boolean => {
    // FAIL CLOSED. No buyer coords, or no listing coords, means we cannot place it, and an
    // unplaceable rooftop is not invitation-ready (S6-13). The legacy coverage counter
    // fails open here; this does not.
    //
    // `distanceMilesBetween` rather than `haversineMiles` directly, because
    // `inventory_items.latitude/longitude` are `Decimal(10,7)` — not Float like the buyer's
    // — and that helper is the existing Decimal-tolerant converter the shortlist gate uses.
    const d = distanceMilesBetween(buyerCoords, lat, lng);
    if (d === null) return false;
    return d > inner && d <= radiusMiles;
  };

  // ── the holding rooftop, "where mapped and in radius" (§6a step 0) ──
  for (const l of listings) {
    if (!l.rooftopId) {
      unmappedCandidateIds.push(l.id);
      continue;
    }
    holding.set(l.rooftopId, [...(holding.get(l.rooftopId) ?? []), l.id]);
  }

  // ── rooftops holding the COMPARABLE unit ──
  //
  // "Comparable" is the same year/make/model the buyer shortlisted, held by a DIFFERENT
  // rooftop in band. Trim is deliberately not required: §6a says "the comparable unit",
  // and §Stage 7 sends "the required-versus-preferred feature distinction" precisely
  // because a near-match rooftop is worth inviting. Year is matched exactly because a
  // model year is a different vehicle, not a different trim level.
  //
  // MATCH-ONLY (§13-D8): this reads rooftops already in `dealer_rooftops` via listings we
  // already hold. It mints nothing from a provider payload.
  const specs = listings
    .filter((l) => l.make && l.model && l.year)
    .map((l) => ({ id: l.id, year: l.year!, make: l.make!, model: l.model! }));

  if (specs.length > 0 && buyerCoords) {
    const bb = boundingBox(buyerCoords, radiusMiles);
    const comparableListings = await db.inventoryItem.findMany({
      where: {
        isActive: true,
        rooftopId: { not: null },
        id: { notIn: candidateIds },
        OR: specs.map((s) => ({ year: s.year, make: s.make, model: s.model })),
        latitude: { gte: bb.minLat, lte: bb.maxLat },
        longitude: { gte: bb.minLng, lte: bb.maxLng },
      },
      select: {
        id: true, rooftopId: true, year: true, make: true, model: true,
        latitude: true, longitude: true,
      },
      take: MAX_ROOFTOPS_PER_BAND * 5,
    });

    for (const cl of comparableListings) {
      if (!cl.rooftopId) continue;
      if (holding.has(cl.rooftopId)) continue; // already serving as a holding rooftop
      if (!inBand(cl.latitude, cl.longitude)) continue;
      // Which of the buyer's OWN candidates this rooftop can serve — that is what
      // §33 step 29 means by "recording which candidates each rooftop can serve", and it
      // is the buyer's candidate id that belongs on the invitation, not the comparable
      // listing's.
      const served = specs
        .filter((s) => s.year === cl.year && s.make === cl.make && s.model === cl.model)
        .map((s) => s.id);
      if (served.length === 0) continue;
      const existing = comparable.get(cl.rooftopId) ?? [];
      comparable.set(cl.rooftopId, [...new Set([...existing, ...served])]);
    }
  }

  if (unmappedCandidateIds.length > 0) {
    logger.info(
      `[sourcing] ${unmappedCandidateIds.length} of ${candidateIds.length} candidates map to no ` +
        `rooftop — reported, not dropped. Sourcing still covers them through comparable rooftops.`,
    );
  }
  return { holding, comparable, candidateIds, unmappedCandidateIds };
}

// ───────────────────────────────────────────────────────────────────────────────
// The band pool — §6a steps 1–5, annulus only
// ───────────────────────────────────────────────────────────────────────────────

export interface PoolRooftop {
  rooftopId: string;
  displayName: string;
  latitude: number | null;
  longitude: number | null;
  makes: string[];
  operatingStatus: string | null;
  websiteHost: string | null;
  /** The registered dealer on this rooftop, when there is one. */
  dealer: {
    id: string;
    status: string;
    currentAuctionLoad: number;
    email: string | null;
    dealershipName: string;
  } | null;
  /** The best contact profile for this rooftop, by PRIMARY_CONTACT_ORDER. */
  contact: {
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    emailVerificationStatus: string | null;
    contactSource: string | null;
  } | null;
}

/**
 * §6b "a relevant sales, Internet Sales, BDC, or management role".
 *
 * Imported rather than restated would be better, but `APOLLO_SALES_TITLES` in
 * `apollo.service.ts` is the list we ASK Apollo for, not the list we ACCEPT — and
 * `RANKED_TITLE_KEYWORDS` there is module-private. This is the accept-side list and it is
 * deliberately broader: a title we did not search for can still be the right person, and
 * §6b names four families rather than five job titles.
 *
 * A role-derived inbox (sales@, internetsales@) satisfies the item by construction — the
 * address IS the role — which is why `ROLE_DERIVED` short-circuits the title check.
 */
const ROLE_FIT_KEYWORDS = [
  "internet sales", "e-commerce", "ecommerce", "bdc", "business development",
  "sales", "general manager", "gm", "dealer principal", "owner", "manager",
  "director", "fleet", "used car", "pre-owned",
] as const;

export function titleSatisfiesRoleFit(
  title: string | null | undefined,
  emailVerificationStatus: string | null | undefined,
): boolean {
  // A role inbox is the role. §6b asks for a relevant role, not a relevant person.
  if (emailVerificationStatus === "ROLE_DERIVED") return true;
  const t = (title ?? "").toLowerCase();
  if (!t) return false;
  return ROLE_FIT_KEYWORDS.some((k) => t.includes(k));
}

/**
 * §6b "make or inventory fit".
 *
 * Satisfied by EITHER signal, which is what "make or inventory" means: the rooftop lists the
 * make, or it holds one of the candidates (holding or comparable). A rooftop that holds the
 * exact car the buyer shortlisted obviously fits, whatever its `makes` array says — and
 * `makes` is `@default([])` on 1,422 rows, so requiring it alone would reject almost
 * everything.
 */
export function makeFits(
  rooftopMakes: string[],
  servesCandidate: boolean,
  candidateMakes: Set<string>,
): boolean {
  if (servesCandidate) return true;
  if (rooftopMakes.length === 0) return false;
  const lower = new Set(rooftopMakes.map((m) => m.trim().toLowerCase()));
  for (const m of candidateMakes) if (lower.has(m.trim().toLowerCase())) return true;
  return false;
}

/**
 * The rooftops in ONE band's annulus, both sub-pools in §6a's order.
 *
 * Band 100 covers §6a steps 1 AND 2 — "registered dealerships within 100 miles" then
 * "outside dealerships within 100 miles" — because they are the same radius. The ORDER
 * matters for ranking, not for membership: §6b validates both identically and §6c ranks
 * across both, so the registered-first preference is expressed by the rooftop dedup
 * (a rooftop carrying a registered dealer is that dealer's) rather than by a separate query.
 *
 * ANNULUS ONLY (S6-09). `BAND_INNER_MILES` excludes everything the previous band already
 * searched. The caller reuses the `sourcing_candidates` rows from earlier bands rather than
 * re-validating them, which is the other half of "searches only the new band and reuses
 * valid candidates already found".
 */
export async function collectBandRooftops(
  buyerCoords: LatLng | null,
  band: SourcingBand,
  radiusMiles: number,
  excludeRooftopIds: Set<string>,
  db: Db = defaultPrisma,
): Promise<PoolRooftop[]> {
  // No buyer coordinates means no band. FAIL CLOSED: §6b requires "a known location and
  // calculated distance", and the incident at `buyer-location.service.ts:5-13` is what
  // happens when a sourcing decision is taken without one.
  if (!buyerCoords) {
    logger.warn(`[sourcing] buyer not geocodable — band ${band} yields no rooftops (fail closed)`);
    return [];
  }

  const bb = boundingBox(buyerCoords, radiusMiles);
  const rows = await db.dealerRooftop.findMany({
    where: {
      latitude: { gte: bb.minLat, lte: bb.maxLat },
      longitude: { gte: bb.minLng, lte: bb.maxLng },
      ...(excludeRooftopIds.size > 0 ? { id: { notIn: [...excludeRooftopIds] } } : {}),
    },
    select: {
      id: true, displayName: true, latitude: true, longitude: true, makes: true,
      operatingStatus: true, websiteHost: true,
      dealers: {
        where: { isSystemPlaceholder: false },
        select: {
          id: true, status: true, currentAuctionLoad: true, dealershipName: true,
          user: { select: { email: true } },
        },
        take: 1,
      },
      contacts: {
        select: {
          name: true, title: true, email: true, phone: true,
          emailVerificationStatus: true, contactSource: true,
        },
        // PRIMARY_CONTACT_ORDER, the order `outreach-queue.service.ts:268-272` declares and
        // the SMS gate shares. Ordered in SQL rather than capped-then-sorted: the
        // independent review found `getRooftopContacts` takes an unordered LIMIT 10 and then
        // sorts in memory, so for a rooftop with more than ten email-bearing profiles the
        // only VERIFIED contact can be excluded before ranking ever happens.
        orderBy: [
          { isPrimaryContact: "desc" },
          { apolloLastSyncedAt: "desc" },
          { createdAt: "asc" },
        ],
      },
    },
    orderBy: { id: "asc" }, // deterministic scan window — never database order (defect 4)
    take: MAX_ROOFTOPS_PER_BAND,
  });

  const inner = BAND_INNER_MILES[band];
  const out: PoolRooftop[] = [];
  for (const r of rows) {
    if (r.latitude == null || r.longitude == null) continue; // fail closed
    const d = haversineMiles(buyerCoords, { lat: r.latitude, lng: r.longitude });
    if (d <= inner || d > radiusMiles) continue; // the annulus, and only the annulus
    const dealerRow = r.dealers[0] ?? null;
    // Prefer a contact with a send-safe email; fall back to the first, which may be
    // phone-only. The channel decision is made in `validateRooftop`, not here.
    const sendSafe = r.contacts.find(
      (c) => c.email && (c.emailVerificationStatus === "VERIFIED" || c.emailVerificationStatus === "ROLE_DERIVED"),
    );
    out.push({
      rooftopId: r.id,
      displayName: r.displayName,
      latitude: r.latitude,
      longitude: r.longitude,
      makes: r.makes,
      operatingStatus: r.operatingStatus,
      websiteHost: r.websiteHost,
      dealer: dealerRow
        ? {
            id: dealerRow.id,
            status: dealerRow.status,
            currentAuctionLoad: dealerRow.currentAuctionLoad,
            email: dealerRow.user?.email ?? null,
            dealershipName: dealerRow.dealershipName,
          }
        : null,
      contact: sendSafe ?? r.contacts[0] ?? null,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// §6b — validate one rooftop
// ───────────────────────────────────────────────────────────────────────────────

export interface ValidateRooftopInput {
  rooftop: PoolRooftop;
  buyerCoords: LatLng;
  radiusMiles: number;
  /** Candidate ids this rooftop can serve, from `resolveCandidateRooftops`. */
  servedCandidateIds: string[];
  /** Makes across the buyer's shortlist, for the make-fit item. */
  candidateMakes: Set<string>;
  /** Rooftops already counted in this case — the dedup item. */
  alreadyCounted: Set<string>;
  /**
   * §6b: "Paid enrichment runs only after payment and only when stored and public paths
   * fail." TRUE only when the caller is a sourcing case whose deposit is settled, and only
   * for an in-band rooftop. The waterfall's own default is false.
   */
  allowPaid: boolean;
  /** Set when a paid reveal is permitted, so the spend is linked to the case (§6c). */
  sourcingCaseId?: string | null;
}

export interface ValidateRooftopDeps {
  resolveContact: typeof resolveContactableEmail;
  channelConfigured: () => boolean;
}

/**
 * §6b, item by item, with every outcome recorded.
 *
 * "A rooftop becomes invitation-ready only when confirmed to have: a real physical rooftop;
 * a known location and calculated distance; make or inventory fit; active operating status;
 * no duplicate or suppression; a deliverable contact; and a relevant sales, Internet Sales,
 * BDC, or management role."
 *
 * Every failure is COLLECTED rather than short-circuited. §6c's 1–2 and 0 branches send a
 * case to Operations, and an operator needs to know whether the field is thin because
 * nobody is in range or because everybody in range has no email — those are different
 * problems with different fixes, and a first-failure-wins check cannot tell them apart.
 */
export async function validateRooftop(
  input: ValidateRooftopInput,
  deps?: Partial<ValidateRooftopDeps>,
): Promise<RooftopValidation> {
  const resolveContact = deps?.resolveContact ?? resolveContactableEmail;
  const channelConfigured = deps?.channelConfigured ?? (() => missingEmailEnvVars().length === 0);
  const { rooftop: r } = input;
  const failures: ValidationFailure[] = [];

  // ── a real physical rooftop ──
  // The rooftop row IS the physical-location record (§33 #29 makes it the sourcing unit).
  // What makes it real rather than a name is an identifying key: a location, or the unique
  // website host the dealer graph keys on.
  if (!r.websiteHost && (r.latitude == null || r.longitude == null)) {
    failures.push("NO_PHYSICAL_ROOFTOP");
  }

  // ── a known location and calculated distance ── FAIL CLOSED
  let distanceMiles: number | null = null;
  if (r.latitude == null || r.longitude == null) {
    failures.push("LOCATION_UNKNOWN");
  } else {
    distanceMiles = Math.round(haversineMiles(input.buyerCoords, { lat: r.latitude, lng: r.longitude }) * 10) / 10;
    if (distanceMiles > input.radiusMiles) failures.push("OUT_OF_BAND");
  }

  // ── make or inventory fit ──
  if (!makeFits(r.makes, input.servedCandidateIds.length > 0, input.candidateMakes)) {
    failures.push("NO_MAKE_FIT");
  }

  // ── active operating status ── negative filter only (owner ruling, D36 sub-decision)
  const operatingStatus = operatingStatusVerdict(r.operatingStatus);
  if (operatingStatus === "CLOSED") failures.push("OPERATING_STATUS_CLOSED");

  // ── no duplicate ──
  if (input.alreadyCounted.has(r.rooftopId)) failures.push("DUPLICATE_ROOFTOP");

  // ── the registered dealer's own eligibility, where there is one ──
  //
  // Two gates, both of which the legacy invite path already applies and neither of which
  // the legacy COVERAGE counter did — which is how a field could be counted and then not
  // invited.
  //
  // DEALER_SUSPENDED is §13-D42's enforcement point, built now and filled by Phase 10.
  // The owner's 2026-09-11 ruling is that Phase 5 records and warns while Phase 10 enforces
  // suspension; a suspension that nothing reads would make Phase 10's write a no-op, so the
  // READ exists here from the start and a dealer whose status is not ACTIVE is not
  // invitation-ready.
  if (r.dealer) {
    if (r.dealer.status !== "ACTIVE") failures.push("DEALER_SUSPENDED");
    else if (r.dealer.currentAuctionLoad >= DEALER_MAX_AUCTION_LOAD) failures.push("DEALER_AT_CAPACITY");
  }

  // ── a deliverable contact, and no suppression ──
  //
  // THE WATERFALL IS CALLED, NOT REIMPLEMENTED. `resolveContactableEmail` is the §6b
  // preference order already: rooftop-profile reuse → prospect reuse → role derivation →
  // Gemini → paid Apollo behind `allowPaid`. Its own header states the rule this phase
  // needs — "contactable == send-safe", using the FULL suppression tier rather than the hard
  // one, because a soft-suppressed address counted contactable and then blocked at send is
  // an empty-auction footgun. That is defect 1 seen from the resolver's side: the resolver
  // has always been right and the SEND path was the half that was wrong.
  let contactEmail: string | null = null;
  let contactSource: string | null = null;
  let emailVerificationStatus: string | null = r.contact?.emailVerificationStatus ?? null;

  if (!channelConfigured()) {
    // The platform precondition the real send path checks first. With the channel
    // unconfigured NO rooftop can be mailed, so none may be counted invitation-ready —
    // otherwise a deposit charges into an auction that could never be populated.
    failures.push("NO_DELIVERABLE_CONTACT");
  } else {
    // A registered dealer is reachable through its own account email without a cold
    // resolve, which is what made it "already contactable" in the legacy counter.
    if (r.dealer?.email) {
      contactEmail = r.dealer.email;
      contactSource = "registered_dealer_account";
      emailVerificationStatus = "VERIFIED";
    } else {
      try {
        const resolved = await resolveContact({
          id: r.rooftopId,
          name: r.displayName,
          website: r.websiteHost,
          city: null,
          state: null,
          email: r.contact?.email ?? null,
          emailVerificationStatus: r.contact?.emailVerificationStatus ?? null,
          rooftopId: r.rooftopId,
          allowPaid: input.allowPaid,
        });
        if (resolved.contactable && resolved.email) {
          contactEmail = resolved.email;
          contactSource = resolved.source ?? null;
          emailVerificationStatus = resolved.status ?? emailVerificationStatus;
        }
      } catch (err) {
        // A RESOLUTION FAILURE IS A FAILURE, NEVER A CONFIDENT EMPTY. The carry-forward
        // rule from Phases 2–4. The rooftop is recorded not-ready with a reason rather than
        // counted as having no contact, so a provider outage reads as an outage.
        logger.warn(`[sourcing] contact resolution failed for rooftop ${r.rooftopId}:`, err);
      }
    }
    if (!contactEmail) failures.push("NO_DELIVERABLE_CONTACT");
  }

  // ── a relevant role ──
  const roleFit = contactEmail
    ? titleSatisfiesRoleFit(r.contact?.title, emailVerificationStatus)
    : false;
  if (contactEmail && !roleFit) failures.push("NO_ROLE_FIT");

  // ── the channel, and the two counts that must never be conflated ──
  //
  // SMS IS OUT OF SCOPE FOR THIS PHASE, and the reason is in the existing code rather than
  // in a preference. `deliverSms` requires a CRM `contacts` row with `consent_sms` true
  // (`comms-outbox.service.ts:303-331`); `dealer_contact_profiles.consentBasis` defaults
  // "NONE" and nothing writes it; `dncStatus` is NULL on every profile because the wired
  // reveal never buys phone data (`apollo-orchestration.service.ts:652-663`), so
  // `evaluateConsentBasis` refuses; and `isSmsSuppressed` FAILS OPEN on a lookup error
  // (`suppression.service.ts:70-79` reads only `{ data }`), which makes an automated dealer
  // SMS rail unsafe independently of consent. Capturing dealer SMS consent is an A2P/TCPA
  // batch, not §8.1 row 5.
  //
  // So a phone-only rooftop is CALL_ONLY: not invitation-ready for the automated rail, and
  // raised as an Operations task by the caller rather than dropped. §6c's buyer-facing count
  // is the EMAIL count, and the CALL_ONLY count is recorded beside it so "invitations sent"
  // can never be read as "the market was reached".
  const phone = r.contact?.phone ?? null;
  const channel: RooftopChannel = contactEmail ? "EMAIL" : phone ? "CALL_ONLY" : "NONE";

  // Suppression is not re-checked here: `resolveContactableEmail` already applied the full
  // store, and a second check against a different tier is how the two halves of defect 1
  // came to disagree. The readiness checklist re-checks at launch (S7-05), which is a
  // different question — time has passed.
  const invitationReady = failures.length === 0 && channel === "EMAIL";

  return {
    invitationReady,
    failures,
    distanceMiles,
    channel,
    roleFit,
    operatingStatus,
    contactEmail,
    contactName: r.contact?.name ?? r.dealer?.dealershipName ?? null,
    contactSource,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// §6c — rank, cap, and decide
// ───────────────────────────────────────────────────────────────────────────────

export interface RankedRooftop {
  rooftopId: string;
  validation: RooftopValidation;
  band: SourcingBand;
  servedCandidateIds: string[];
  source: "HOLDING" | "COMPARABLE";
  isRegistered: boolean;
  dealerId: string | null;
  score: number;
  displayName: string;
  contactEmail: string | null;
  contactName: string | null;
}

/**
 * §6c "More than 8 — rank and invite the best eight", with a DETERMINISTIC order.
 *
 * Defect 4 was that the automatic tie-break followed database order
 * (`dealer.findMany` with no `orderBy`, `launch-auction/route.ts:107-114`), so two runs over
 * the same data could invite different dealerships and neither was explainable. The sort key
 * here is total: every comparison ends at `rooftopId`, which is unique.
 *
 * The order encodes §6a's ladder rather than inventing a preference. Registered before
 * outside is step 1 before step 2; nearer before farther is the ladder's own direction; and
 * score orders within those, using the platform's existing dealer score.
 */
export function rankRooftops(candidates: RankedRooftop[]): RankedRooftop[] {
  return [...candidates].sort((a, b) => {
    if (a.isRegistered !== b.isRegistered) return a.isRegistered ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    const da = a.validation.distanceMiles ?? Number.POSITIVE_INFINITY;
    const db_ = b.validation.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (da !== db_) return da - db_;
    // The total tie-break. Defect 4's root cause was the absence of this line.
    return a.rooftopId < b.rooftopId ? -1 : a.rooftopId > b.rooftopId ? 1 : 0;
  });
}

export type SourcingOutcome =
  | "AUTO_LAUNCH"
  | "LIMITED_PENDING_APPROVAL"
  | "THIN_COVERAGE_REVIEW"
  | "ZERO_COVERAGE_REVIEW"
  | "EXPAND";

export interface OutcomeDecision {
  outcome: SourcingOutcome;
  /** The rooftops that would be invited — capped at 8 (§6c). */
  field: RankedRooftop[];
  readyCount: number;
  /** Rooftops with a phone and no send-safe email. An Operations task, never a silent skip. */
  callOnlyCount: number;
  /** True when a further band exists to search before any review branch is taken. */
  canExpand: boolean;
}

/**
 * §6c's decision table, verbatim:
 *
 *   | Invitation-ready rooftops | Action                                            |
 *   | 5–8                       | Launch automatically                              |
 *   | More than 8               | Rank and invite the best eight                    |
 *   | 3–4                       | Limited auction, only with audited Ops approval    |
 *   | 1–2                       | Continue expansion, source manually, or close      |
 *   | 0                         | Close as no coverage after Operations review      |
 *
 * EXPANSION COMES FIRST, and that is not in the table — it is in §6a. The table decides what
 * to do with a FINISHED ladder: "Continue expansion" is literally the first option of the
 * 1–2 row, and §Stage 6's failure clause only triggers "at 250 miles without coverage". So
 * while a further band exists and the field is below the auto-launch threshold, the answer is
 * EXPAND and no review branch is taken. Reading the table without §6a would send a buyer to
 * Operations at 100 miles for a field that 150 miles would have filled.
 */
export function decideOutcome(
  ranked: RankedRooftop[],
  callOnlyCount: number,
  canExpand: boolean,
): OutcomeDecision {
  const ready = ranked.filter((r) => r.validation.invitationReady);
  const readyCount = ready.length;
  const field = ready.slice(0, MAX_INVITATION_FIELD);

  if (readyCount >= MIN_AUTO_LAUNCH_FIELD) {
    // 5–8 launches; more than 8 is the same action over a capped field.
    return { outcome: "AUTO_LAUNCH", field, readyCount, callOnlyCount, canExpand };
  }
  if (canExpand) {
    return { outcome: "EXPAND", field, readyCount, callOnlyCount, canExpand };
  }
  if (readyCount >= MIN_LIMITED_AUCTION_FIELD) {
    return { outcome: "LIMITED_PENDING_APPROVAL", field, readyCount, callOnlyCount, canExpand };
  }
  if (readyCount >= 1) {
    return { outcome: "THIN_COVERAGE_REVIEW", field, readyCount, callOnlyCount, canExpand };
  }
  return { outcome: "ZERO_COVERAGE_REVIEW", field, readyCount, callOnlyCount, canExpand };
}

/**
 * Write `operating_status` where we learn it — the other half of the D36 sub-ruling.
 *
 * The column is a negative filter because nothing populates it; this is what starts
 * populating it. Called when a rooftop's every channel has failed in a way that indicates
 * the business is gone rather than the address being wrong: a hard bounce on a role-derived
 * address at a domain that no longer resolves. Deliberately narrow — a bounce alone is a bad
 * mailbox, not a closed dealership.
 *
 * Best-effort: a failure to record the fact must not fail the sourcing run that noticed it.
 */
export async function markRooftopClosed(
  rooftopId: string,
  reason: string,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<void> {
  try {
    await db.dealerRooftop.update({
      where: { id: rooftopId },
      data: {
        operatingStatus: ROOFTOP_OPERATING_STATUS.CLOSED,
        operatingStatusCheckedAt: now,
      },
    });
    logger.info(`[sourcing] rooftop ${rooftopId} marked CLOSED: ${reason}`);
  } catch (err) {
    logger.warn(`[sourcing] could not record operating status for rooftop ${rooftopId}:`, err);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// The orchestrator — one band per call, driven by the reconciler
// ───────────────────────────────────────────────────────────────────────────────

export interface AdvanceSourcingResult {
  caseId: string;
  band: SourcingBand;
  outcome: SourcingOutcome | "NOT_PAID" | "NO_CASE" | "NOT_PLACEABLE" | "TERMINAL";
  readyCount: number;
  callOnlyCount: number;
  /**
   * §13-D8 — how many rooftops the whole permitted radius contains, before §6b. Recorded so
   * a thin FIELD is never read as a thin MARKET: under match-only the ceiling is the
   * `dealer_rooftops` AutoLenis holds, not the market MarketCheck can see.
   */
  poolCeiling: number;
  newlyValidated: number;
  reusedFromEarlierBands: number;
}

export interface AdvanceSourcingDeps {
  prisma: PrismaClient;
  geocode: (zip: string) => Promise<LatLng | null>;
  resolveContact: typeof resolveContactableEmail;
  channelConfigured: () => boolean;
  scoreDealer: (dealerId: string, makes: string[]) => Promise<number>;
}

/**
 * Advance ONE rung of the §6a ladder for a request, and record the §6c outcome.
 *
 * CALLED REPEATEDLY, ONE BAND PER CALL. §6a's "each expansion searches only the new band"
 * is a statement about work, and a loop that ran every band in one invocation would pay the
 * full cost even when band 1 was enough. The reconciler ticks this; `outcome: "EXPAND"` is
 * the signal that another rung remains.
 *
 * DOES NOT CREATE AN AUCTION OR SEND ANYTHING. The §6c outcome is recorded on the case and
 * the launch is `launch-readiness.service.ts`'s, which is the §7 gate. This separation is
 * the whole point of Stage 6 existing as a stage: "the auction launches only when the
 * invitation field is ready".
 */
export async function advanceSourcing(
  vehicleRequestId: string,
  existingCase: SourcingCaseRecord,
  deps?: Partial<AdvanceSourcingDeps>,
): Promise<AdvanceSourcingResult> {
  const db = (deps?.prisma ?? defaultPrisma) as Db;
  const geocode = deps?.geocode ?? (async (zip: string) => {
    const r = await geocodeZip(zip);
    return r ? { lat: r.lat, lng: r.lng } : null;
  });
  const scoreDealer = deps?.scoreDealer ?? (async (dealerId: string, makes: string[]) => {
    const { scoreDealerForAuction } = await import("@/lib/services/auction/dealer-invitation.service");
    return scoreDealerForAuction(dealerId, makes);
  });

  const base = {
    caseId: existingCase.id,
    band: existingCase.band,
    readyCount: existingCase.coverageCount,
    callOnlyCount: 0,
    poolCeiling: 0,
    newlyValidated: 0,
    reusedFromEarlierBands: 0,
  };

  if (existingCase.status === "CLOSED" || existingCase.status === "LAUNCHED") {
    return { ...base, outcome: "TERMINAL" };
  }

  // ── the payment gate, read from the DEPOSIT and not from the status ──
  //
  // S7-01b and §Stage 6's entry. `ACTIVE_SOURCING` is NOT proof of payment: it is still
  // written with no deposit check by `request-progression.service.ts:123`, driven every 15
  // minutes by the `coverage-hold-reconcile` cron. So the status cannot be the gate, and
  // the request-scoped deposit predicate is.
  const { isRequestFulfillmentUnlocked } = await import("@/lib/services/payment/fulfillment-gate");
  if (!(await isRequestFulfillmentUnlocked(vehicleRequestId))) {
    logger.info(`[sourcing] ${vehicleRequestId}: no settled deposit bound to the request — not sourcing`);
    return { ...base, outcome: "NOT_PAID" };
  }

  const request = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: {
      id: true, buyerId: true, makePreference: true, modelPreference: true,
      latitude: true, longitude: true, zip: true,
      buyer: { select: { zip: true, latitude: true, longitude: true } },
    },
  });
  if (!request) return { ...base, outcome: "NO_CASE" };

  // ── buyer coordinates, or nothing ──
  //
  // THE REQUEST'S OWN LOCATION WINS. Phase 1 put `latitude`/`longitude`/`zip` on
  // `vehicle_requests` and Phase 2's intake handler writes them, so the request carries
  // where the buyer wants to buy — which is not always where the buyer account says they
  // live. The buyer row is the fallback, and the ZIP geocode is the fallback to that.
  let buyerCoords: LatLng | null =
    request.latitude != null && request.longitude != null
      ? { lat: request.latitude, lng: request.longitude }
      : request.buyer?.latitude != null && request.buyer?.longitude != null
        ? { lat: request.buyer.latitude, lng: request.buyer.longitude }
        : null;
  const zip = request.zip ?? request.buyer?.zip ?? null;
  if (!buyerCoords && zip) buyerCoords = await geocode(zip);
  if (!buyerCoords) {
    // FAIL CLOSED, and loudly. The §7.1 incident this guards is recorded at
    // `buyer-location.service.ts:5-13`: a deposit charged, an auction opened, zero
    // invitations, because sourcing proceeded without a placeable buyer.
    logger.warn(`[sourcing] ${vehicleRequestId}: buyer not placeable — refusing to source`);
    return { ...base, outcome: "NOT_PLACEABLE" };
  }

  const band = existingCase.band;
  const radiusMiles = effectiveRadiusMiles(band, existingCase.authorizedRadiusMiles);
  if (radiusMiles === null) {
    // AUTHORIZED band with no authorisation. Refuse to search rather than search unbounded.
    logger.info(`[sourcing] ${vehicleRequestId}: band AUTHORIZED with no buyer authorisation — holding`);
    return { ...base, outcome: "ZERO_COVERAGE_REVIEW" };
  }

  // ── reuse what earlier bands already validated (§6a, S6-09) ──
  const existing = await db.sourcingCandidate.findMany({
    where: { sourcingCaseId: existingCase.id },
    select: {
      rooftopId: true, source: true, distanceMiles: true, servedCandidateIds: true,
      validation: true, excludedReason: true,
    },
  });
  const alreadyCounted = new Set(existing.map((e) => e.rooftopId).filter(Boolean) as string[]);

  // ── step 0: candidates → holding + comparable rooftops (§6a step 0, §33 #29) ──
  const sets = await resolveCandidateRooftops(request.buyerId, buyerCoords, band, radiusMiles, db);
  const candidateMakes = new Set<string>();
  if (request.makePreference) candidateMakes.add(request.makePreference);
  const candidateListings = sets.candidateIds.length
    ? await db.inventoryItem.findMany({
        where: { id: { in: sets.candidateIds } },
        select: { make: true },
      })
    : [];
  for (const c of candidateListings) if (c.make) candidateMakes.add(c.make);

  // ── the band's rooftops, annulus only, minus everything already validated ──
  const pool = await collectBandRooftops(buyerCoords, band, radiusMiles, alreadyCounted, db);

  // §13-D8's pool ceiling: every rooftop inside the permitted radius regardless of band or
  // validation. Under match-only this is what AutoLenis holds, not what the market contains.
  const bb = boundingBox(buyerCoords, radiusMiles);
  const poolCeiling = await db.dealerRooftop.count({
    where: {
      latitude: { gte: bb.minLat, lte: bb.maxLat },
      longitude: { gte: bb.minLng, lte: bb.maxLng },
    },
  });

  // ── §6b on each, then persist ──
  const ranked: RankedRooftop[] = [];
  let callOnlyCount = 0;
  for (const rt of pool) {
    const served = [
      ...(sets.holding.get(rt.rooftopId) ?? []),
      ...(sets.comparable.get(rt.rooftopId) ?? []),
    ];
    const source: "HOLDING" | "COMPARABLE" = sets.holding.has(rt.rooftopId) ? "HOLDING" : "COMPARABLE";
    const validation = await validateRooftop(
      {
        rooftop: rt,
        buyerCoords,
        radiusMiles,
        servedCandidateIds: [...new Set(served)],
        candidateMakes,
        alreadyCounted,
        // §6b: paid enrichment only after payment, and only on failure of stored and public
        // paths. The gate above proved payment; the waterfall itself only reaches its paid
        // tier after the stored and public tiers fail, so passing true here is exactly
        // "only when stored and public paths fail" rather than "spend now".
        allowPaid: true,
        sourcingCaseId: existingCase.id,
      },
      { resolveContact: deps?.resolveContact, channelConfigured: deps?.channelConfigured },
    );
    if (validation.channel === "CALL_ONLY") callOnlyCount += 1;
    const score = rt.dealer ? await scoreDealer(rt.dealer.id, [...candidateMakes]) : 0;
    ranked.push({
      rooftopId: rt.rooftopId,
      validation,
      band,
      servedCandidateIds: [...new Set(served)],
      source,
      isRegistered: !!rt.dealer,
      dealerId: rt.dealer?.id ?? null,
      score,
      displayName: rt.displayName,
      contactEmail: validation.contactEmail,
      contactName: validation.contactName,
    });
  }

  await persistCandidates(existingCase.id, ranked, db);

  // ── merge the reused rows back in, so §6c sees the whole field ──
  const reused: RankedRooftop[] = existing
    .filter((e) => e.rooftopId)
    .map((e) => {
      const v = (e.validation ?? {}) as Partial<RooftopValidation>;
      return {
        rooftopId: e.rooftopId!,
        validation: {
          invitationReady: v.invitationReady ?? false,
          failures: v.failures ?? [],
          distanceMiles: e.distanceMiles ?? null,
          channel: v.channel ?? "NONE",
          roleFit: v.roleFit ?? false,
          operatingStatus: v.operatingStatus ?? "UNKNOWN",
          contactEmail: v.contactEmail ?? null,
          contactName: v.contactName ?? null,
          contactSource: v.contactSource ?? null,
        },
        band,
        servedCandidateIds: e.servedCandidateIds ?? [],
        source: e.source === "HOLDING" ? "HOLDING" : "COMPARABLE",
        isRegistered: false,
        dealerId: null,
        score: 0,
        displayName: "",
        contactEmail: v.contactEmail ?? null,
        contactName: v.contactName ?? null,
      } satisfies RankedRooftop;
    });
  for (const r of reused) if (r.validation.channel === "CALL_ONLY") callOnlyCount += 1;

  const all = rankRooftops([...ranked, ...reused]);
  const canExpand = nextBandIsSearchable(band, existingCase.authorizedRadiusMiles);
  const decision = decideOutcome(all, callOnlyCount, canExpand);

  logger.info(
    `[sourcing] ${vehicleRequestId} band=${band} r=${radiusMiles}mi: ready=${decision.readyCount} ` +
      `callOnly=${decision.callOnlyCount} poolCeiling=${poolCeiling} outcome=${decision.outcome} ` +
      `(new=${ranked.length} reused=${reused.length})`,
  );

  return {
    caseId: existingCase.id,
    band,
    outcome: decision.outcome,
    readyCount: decision.readyCount,
    callOnlyCount: decision.callOnlyCount,
    poolCeiling,
    newlyValidated: ranked.length,
    reusedFromEarlierBands: reused.length,
  };
}

/**
 * Whether a further rung exists AND can actually be searched.
 *
 * The AUTHORIZED rung exists structurally but is only searchable once the buyer has recorded
 * a maximum beyond 250 — which is the whole point of §Stage 6's failure clause. Treating it
 * as searchable without an authorisation would let the ladder "expand" forever and never
 * reach `RADIUS_AUTHORIZATION_REQUIRED`.
 */
export function nextBandIsSearchable(
  band: SourcingBand,
  authorizedRadiusMiles: number | null,
): boolean {
  const next = band === SOURCING_BAND.B100
    ? SOURCING_BAND.B150
    : band === SOURCING_BAND.B150
      ? SOURCING_BAND.B250
      : band === SOURCING_BAND.B250
        ? SOURCING_BAND.AUTHORIZED
        : null;
  if (next === null) return false;
  if (next === SOURCING_BAND.AUTHORIZED) {
    return authorizedRadiusMiles !== null && authorizedRadiusMiles > 250;
  }
  // S6-10: a buyer-authorised maximum below the next band's edge means the next band adds
  // nothing, so there is nothing to expand into.
  const inner = BAND_INNER_MILES[next];
  const reach = effectiveRadiusMiles(next, authorizedRadiusMiles);
  return reach !== null && reach > inner;
}

/**
 * Write this band's validation outcomes to `sourcing_candidates`.
 *
 * UPSERT ON (case, rooftop), which the Phase 5 migration's composite unique makes
 * meaningful. Without it a reconciler tick overlapping a buyer-triggered expansion inserts
 * the same rooftop twice and `coverage_count` double-counts — which makes the §6c table read
 * a field of 8 that is really 4, launching an auction the spec says needs audited approval.
 *
 * Rows are never deleted. A rooftop that failed §6b is recorded WITH its failures
 * (`excludedReason`), because §6c's review branches send an operator here and "why is this
 * field thin" is the question they are answering.
 */
async function persistCandidates(
  sourcingCaseId: string,
  ranked: RankedRooftop[],
  db: Db,
): Promise<void> {
  for (const r of ranked) {
    const data = {
      rooftopId: r.rooftopId,
      source: r.source,
      distanceMiles: r.validation.distanceMiles,
      servedCandidateIds: r.servedCandidateIds,
      validation: r.validation as unknown as Prisma.InputJsonValue,
      excludedReason: r.validation.invitationReady ? null : r.validation.failures.join(","),
    };
    try {
      await db.sourcingCandidate.upsert({
        where: { sourcingCaseId_rooftopId: { sourcingCaseId, rooftopId: r.rooftopId } },
        create: { id: randomUUID(), sourcingCaseId, ...data },
        update: data,
      });
    } catch (err) {
      // One rooftop failing to persist must not abandon the band. It will be re-validated on
      // the next tick — which is safe because the upsert is keyed, not appended.
      logger.warn(`[sourcing] could not persist candidate ${r.rooftopId} on case ${sourcingCaseId}:`, err);
    }
  }
}
