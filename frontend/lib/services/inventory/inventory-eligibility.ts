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
//   4. fresh                              — dealer-MANAGED inventory (LANE_1 AND a real
//        dealerId) and admin-entered rows are exempt (they have no feed to be re-seen
//        in); every other listing must have been seen within the window.
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
      // Freshness. Exempt only rows that genuinely have no feed to be re-seen in:
      // dealer-MANAGED inventory (LANE_1 *and* an actual dealerId — the label alone is
      // not the invariant) and admin-entered vehicles. Everything else must have been
      // seen inside the window.
      //
      // `{ lane: "LANE_1" }` alone used to grant a permanent exemption, which meant the
      // 95 production orphans (LANE_1, dealer_id NULL) read as forever-fresh here and
      // forever-protected in the stale sweep — the same wrong proxy in both places. They
      // stayed invisible to buyers only because they also lose the provenance clause
      // above, which is an accident rather than a design.
      //
      // Kept in lock-step with staleSweepWhere() in stale-sweep.service.ts: a row must
      // never be both exempt here and sweepable there (cross-checked by test).
      {
        OR: [
          { AND: [{ lane: "LANE_1" }, { dealerId: { not: null } }] },
          { addedByAdminId: { not: null } },
          { lastSeenAt: { gte: cutoff } },
        ],
      },
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
  const exemptFromFreshness =
    (item.lane === "LANE_1" && item.dealerId != null) || item.addedByAdminId != null;
  const fresh =
    exemptFromFreshness || (item.lastSeenAt != null && item.lastSeenAt >= freshnessCutoff(now));
  return fresh;
}
