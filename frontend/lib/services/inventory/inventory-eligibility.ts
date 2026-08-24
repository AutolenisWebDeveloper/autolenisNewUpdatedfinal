// lib/services/inventory/inventory-eligibility.ts — Batch 1
//
// EXECUTABLE SUPPLY: the repository-grounded distinction between an inventory
// ROW EXISTING and inventory that is actually eligible to be matched and sourced.
//
// A row is executable supply only when ALL hold:
//   1. isActive = true                    — not archived / stale-swept.
//   2. priceCents > 0                     — a real, quotable price.
//   3. attributable provenance            — dealerId OR sourceAdapter OR addedByAdminId.
//        Orphan rows with NONE of these (e.g. the historical 206 unowned items whose
//        provenance was dropped before Batch 1) are NEVER treated as executable supply,
//        and are NEVER silently rewritten — they simply do not qualify.
//   4. fresh                              — LANE_1 dealer-owned inventory is fresh while
//        active (dealers manage their own archive state; the stale sweep never touches
//        LANE_1); external LANE_2/LANE_3 listings must have been seen within the window.
//
// This is the single source of truth for eligibility, shared by request matching,
// buyer matching, and (later) sourcing — so "existing" and "executable" never diverge.

import type { Prisma } from "@prisma/client";

/** Freshness window for external (non-LANE_1) listings. Matches the stale-sweep cadence. */
export const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;

export function freshnessCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - FRESHNESS_WINDOW_MS);
}

/**
 * Prisma `where` fragment selecting only executable dealer supply. Compose it with
 * request/buyer criteria via an outer AND.
 */
export function executableSupplyWhere(now: Date = new Date()): Prisma.InventoryItemWhereInput {
  const cutoff = freshnessCutoff(now);
  return {
    AND: [
      { isActive: true },
      { priceCents: { gt: 0 } },
      // Attributable provenance — excludes orphan (unowned, unsourced) rows.
      { OR: [{ dealerId: { not: null } }, { sourceAdapter: { not: null } }, { addedByAdminId: { not: null } }] },
      // Freshness — LANE_1 exempt (dealer-managed), external must be recently seen.
      { OR: [{ lane: "LANE_1" }, { lastSeenAt: { gte: cutoff } }] },
    ],
  };
}

/**
 * Pure predicate mirroring `executableSupplyWhere` for a single in-memory item.
 * Kept in lock-step with the Prisma fragment above so tests can assert both.
 */
export function isExecutableSupply(
  item: {
    isActive: boolean;
    priceCents: number;
    dealerId: string | null;
    sourceAdapter: string | null;
    addedByAdminId: string | null;
    lane: string;
    lastSeenAt: Date | null;
  },
  now: Date = new Date()
): boolean {
  if (!item.isActive) return false;
  if (!(item.priceCents > 0)) return false;
  const hasProvenance = item.dealerId != null || item.sourceAdapter != null || item.addedByAdminId != null;
  if (!hasProvenance) return false;
  const fresh = item.lane === "LANE_1" || (item.lastSeenAt != null && item.lastSeenAt >= freshnessCutoff(now));
  return fresh;
}
