// lib/services/inventory/listing-rooftop-resolution.service.ts
//
// Resolve a swept listing to the rooftop physically holding the car.
//
// 0 of 148 active inventory_items carry a dealer_id: every row names a dealership the platform
// cannot match to anything it owns. Now that the adapter persists the provider's full dealer
// object, that name/phone/address is enough to MATCH the rooftop graph.
//
// MATCH, never MINT. dealer_rooftops is the dealer-prospecting system's entity graph, populated
// by discovery -> verification -> deduplication -> ingestion. Third-party listing text is
// unverified and noisy; creating a rooftop from it would fill the outreach pipeline with
// dealerships nobody discovered or verified, and would bypass the one sanctioned write path
// (autolenis-dealer-database-ingestion). So this service only ever sets inventory_items.
// rooftop_id — it never writes to dealer_rooftops. `created` is reported, and is always 0, so
// that invariant is asserted rather than assumed.
//
// Matching reuses the ONE shared strategy (dealerIdentityKeys / identitiesMatch) rather than a
// second set of rules: a listing and a prospect describing the same dealership must resolve the
// same way, or the catalogue and the outreach pipeline disagree about who holds the car.

import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { dealerIdentityKeys, identitiesMatch } from "@/lib/services/dealer/dealer-identity.service";

/** The persisted dealer facts a listing carries. All optional — providers are inconsistent. */
export interface ListingDealerFacts {
  id: string;
  externalDealerName?: string | null;
  externalDealerPhone?: string | null;
  externalDealerZip?: string | null;
  externalDealerCity?: string | null;
  externalDealerState?: string | null;
}

/** The identity columns of a rooftop. Selected narrowly — this runs over the whole graph. */
export interface RooftopRow {
  id: string;
  displayName: string;
  websiteHost: string | null;
  phoneKey: string | null;
  nameZipKey: string | null;
  nameCityStateKey: string | null;
}

export interface ResolutionDeps {
  loadRooftops: () => Promise<RooftopRow[]>;
  linkListing: (inventoryItemId: string, rooftopId: string) => Promise<void>;
}

export interface ResolutionResult {
  resolved: number;
  unmatched: number;
  /** Matched more than one rooftop — left unlinked rather than auto-merged. */
  ambiguous: number;
  /** No usable dealer facts at all; identity was never computed. */
  skipped: number;
  failed: number;
  /** Always 0. Listings match the rooftop graph; they never extend it. */
  created: number;
}

const defaultDeps: ResolutionDeps = {
  loadRooftops: () =>
    defaultPrisma.dealerRooftop.findMany({
      select: {
        id: true, displayName: true, websiteHost: true,
        phoneKey: true, nameZipKey: true, nameCityStateKey: true,
      },
    }),
  linkListing: async (inventoryItemId, rooftopId) => {
    // Narrowed select: an unnarrowed update returns every declared column, which raises P2022
    // for the whole batch while this migration is unapplied.
    await defaultPrisma.inventoryItem.update({
      where: { id: inventoryItemId },
      data: { rooftopId },
      select: { id: true },
    });
  },
};

/**
 * Link each listing to its holding rooftop.
 *
 * The rooftop graph is loaded ONCE and matched in memory. A sweep ingests up to 500 listings and
 * the graph is ~1,400 rows: 500 queries would cost more than the sweep itself, and most listings
 * in a single-market sweep share a handful of dealerships anyway.
 *
 * Every failure mode is contained per-listing. Resolution is an enrichment, not a precondition —
 * a listing with no rooftop is still a perfectly good listing.
 */
export async function resolveListingRooftops(
  listings: ListingDealerFacts[],
  deps: Partial<ResolutionDeps> = {},
): Promise<ResolutionResult> {
  const out: ResolutionResult = {
    resolved: 0, unmatched: 0, ambiguous: 0, skipped: 0, failed: 0, created: 0,
  };
  if (listings.length === 0) return out;

  const loadRooftops = deps.loadRooftops ?? defaultDeps.loadRooftops;
  const linkListing = deps.linkListing ?? defaultDeps.linkListing;

  let rooftops: RooftopRow[];
  try {
    rooftops = await loadRooftops();
  } catch (err) {
    // The rooftop graph being unreadable must not fail the sweep — the vehicles are already in.
    logger.warn("[listing-rooftop] rooftop load failed; skipping resolution for this run:", err);
    return { ...out, skipped: listings.length };
  }

  const graph = rooftops.map((r) => ({
    row: r,
    keys: {
      host: r.websiteHost, nameZip: r.nameZipKey,
      nameCityState: r.nameCityStateKey, phone: r.phoneKey,
    },
  }));

  // One dealership supplies many listings in a single-market sweep; memoise per identity so a
  // 50-car rooftop costs one scan, not fifty.
  const memo = new Map<string, string | null>();

  for (const listing of listings) {
    const keys = dealerIdentityKeys({
      name: listing.externalDealerName,
      zip: listing.externalDealerZip,
      city: listing.externalDealerCity,
      state: listing.externalDealerState,
      phone: listing.externalDealerPhone,
      // Listings carry no dealership website; host matching is left to the rooftop's own keys.
      website: null,
    });

    // Every key null means there is nothing to match on. Not a failure — just no provenance.
    if (!keys.host && !keys.nameZip && !keys.nameCityState && !keys.phone) {
      out.skipped++;
      continue;
    }

    const memoKey = `${keys.host}|${keys.nameZip}|${keys.nameCityState}|${keys.phone}`;
    let rooftopId: string | null | undefined = memo.get(memoKey);

    if (rooftopId === undefined) {
      const hits = graph.filter((g) => identitiesMatch(keys, g.keys));
      if (hits.length === 1) {
        rooftopId = hits[0]!.row.id;
      } else {
        if (hits.length > 1) {
          // A shared switchboard across a dealer group, or a genuine duplicate in the graph.
          // Either way, picking one would attach the car to the wrong rooftop half the time.
          logger.info(
            `[listing-rooftop] ambiguous match for "${listing.externalDealerName ?? "?"}" ` +
              `(${hits.length} rooftops) — left unlinked`,
          );
        }
        rooftopId = null;
      }
      memo.set(memoKey, rooftopId);
    }

    if (rooftopId === null) {
      // Ambiguity was already counted at match time via the memo; recompute cheaply here so the
      // per-listing tallies stay honest for repeated identities.
      const hits = graph.filter((g) => identitiesMatch(keys, g.keys));
      if (hits.length > 1) out.ambiguous++;
      else out.unmatched++;
      continue;
    }

    try {
      await linkListing(listing.id, rooftopId);
      out.resolved++;
    } catch (err) {
      out.failed++;
      logger.warn(`[listing-rooftop] link failed for item ${listing.id}:`, err);
    }
  }

  return out;
}
