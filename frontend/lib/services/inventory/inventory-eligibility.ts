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
//   4. fresh                              — dealer-managed inventory (a real dealerId)
//        is fresh while active, since dealers manage their own archive state and the
//        stale sweep never touches those rows; external listings must have been seen
//        within the window. That dealer exemption is capped at the shortlist window
//        so executable supply is always a subset of shortlist-eligible supply.
//
// This is the single source of truth for eligibility, shared by request matching,
// buyer matching, and (later) sourcing — so "existing" and "executable" never diverge.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS FILE ALSO OWNS THE STALE SWEEP AND THE SHORTLIST FRESHNESS GATE.
//
// They live here on purpose. Before this, the sweep predicate was hand-copied in
// three places (the cron's snapshot query, the cron's updateMany, and the
// orchestrator's own sweep) and the eligibility window lived here — four copies
// of one policy, free to drift. They did drift, and the drift was invisible.
//
// THREE WINDOWS, THREE JOBS. They are deliberately different sizes:
//
//   FRESHNESS_WINDOW_MS   48h  executable supply for matching/sourcing, AND the
//                              cutoff at which the stale sweep deactivates a row
//   STALE_FLAG_WINDOW_MS   7d  a DISPLAY FLAG only — never filters anything
//   SHORTLIST_MAX_AGE_MS  30d  shortlist eligibility
//
// The 30-day cutoff looks redundant next to a 48-hour sweep until you notice what
// the sweep exempts: dealer-managed and admin-curated rows are never swept, so
// without a second window they would stay shortlist-eligible forever. 30 days is
// the backstop for exactly those rows.

import type { Prisma } from "@prisma/client";

/** Freshness window for external (non-dealer-managed) listings. Also the sweep cutoff. */
export const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Past this, a listing is FLAGGED stale for the UI. It is not hidden or filtered. */
export const STALE_FLAG_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Past this, a listing may not enter a buyer's shortlist. */
export const SHORTLIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function freshnessCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - FRESHNESS_WINDOW_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Staleness reference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The timestamp staleness is measured from.
 *
 * `lastSeenAt` when the row has ever been confirmed by a feed or a write path;
 * `createdAt` otherwise. The fallback is not cosmetic: `lastSeenAt < cutoff` is
 * UNKNOWN for NULL in SQL, so a row that was never stamped is unreachable by any
 * sweep in any lane — permanently active, at any age. Production had exactly one
 * such row, four months old.
 */
export function staleReferenceAt(item: { lastSeenAt: Date | null; createdAt: Date }): Date {
  return item.lastSeenAt ?? item.createdAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rows the sweep must never deactivate.
 *
 * Note this deliberately does NOT look at `lane` at all. An admin bulk action can
 * move a row into or out of LANE_1 without touching `dealerId`
 * (app/api/admin/inventory/bulk-lane), and the aggregator upsert recomputes `lane`
 * from `assignLane()`, which cannot return LANE_1. Keying the exemption on the
 * dealer link alone means neither operation can accidentally grant a dealer
 * exemption to an aggregator row, or strip one from a dealer's own row.
 *
 * The old predicate was `lane != LANE_1`, whose comment read "Never auto-deactivate
 * dealer-verified Lane 1". But `lane` is a mutable column several paths set without
 * ever setting `dealerId`, so it is not evidence of a dealer. In production, 95 rows
 * were LANE_1 with `dealer_id IS NULL` — aggregator listings from Manhattan holding a
 * dealer exemption with no dealer behind it. They were structurally unreachable by the
 * sweep and stayed active for four months. The cron was healthy the whole time; its
 * definition of "protected" was wrong.
 *
 * The exemption is now what it always meant:
 *   • DEALER-MANAGED  — a real dealer link. Dealers own their archive state, and
 *     every dealer write path stamps both dealerId and lastSeenAt.
 *   • ADMIN-CURATED   — addedByAdminId set. A human deliberately placed this row
 *     (LANE_1 doubles as "Featured — homepage carousel" in the admin UI), so a feed
 *     going quiet must not silently un-feature it.
 *
 * `sourceAdapter` is NOT an exemption: it is provenance, not stewardship. Aggregator
 * rows are precisely what must age out.
 *
 * Admin-curated rows are exempt from the SWEEP only. They are still measured by the
 * 7-day stale flag and the 30-day shortlist cutoff below, so "exempt" never means
 * "immortal and unmarked".
 */
export function isDealerManaged(item: { dealerId: string | null }): boolean {
  return item.dealerId != null;
}

export function isSweepExempt(item: {
  dealerId: string | null;
  addedByAdminId: string | null;
}): boolean {
  if (isDealerManaged(item)) return true;
  if (item.addedByAdminId != null) return true;
  return false;
}

/** Pure predicate mirroring `staleSweepWhere` for a single in-memory row. */
export function isStaleForSweep(
  item: {
    isActive: boolean;
    dealerId: string | null;
    addedByAdminId: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
  },
  now: Date = new Date(),
): boolean {
  if (!item.isActive) return false;
  if (isSweepExempt(item)) return false;
  return staleReferenceAt(item).getTime() < now.getTime() - FRESHNESS_WINDOW_MS;
}

/**
 * Prisma `where` selecting every row the stale sweep should deactivate.
 *
 * ONE definition, consumed by the `inventory-stale-sweep` cron (both its dealer
 * notification snapshot and its updateMany) and by the orchestrator's full-sync
 * sweep. Previously each wrote its own copy.
 */
export function staleSweepWhere(now: Date = new Date()): Prisma.InventoryItemWhereInput {
  const cutoff = freshnessCutoff(now);
  return {
    isActive: true,
    NOT: {
      OR: [
        { dealerId: { not: null } },
        { addedByAdminId: { not: null } },
      ],
    },
    OR: [
      { lastSeenAt: { lt: cutoff } },
      // Never stamped: fall back to createdAt so the row is reachable at all.
      { AND: [{ lastSeenAt: null }, { createdAt: { lt: cutoff } }] },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing freshness — display flag + shortlist gate
// ─────────────────────────────────────────────────────────────────────────────

export interface ListingFreshness {
  /** The raw signal, never fabricated: null means the row was never confirmed. */
  lastSeenAt: Date | null;
  /** What the age was actually measured from (lastSeenAt, else createdAt). */
  referenceAt: Date;
  ageMs: number;
  /** Older than 7 days. A LABEL — it never hides, filters, or reorders a listing. */
  isStale: boolean;
  /** Within 30 days. False means it may not be added to a shortlist. */
  shortlistEligible: boolean;
}

/**
 * Freshness of one listing, for the UI and for the shortlist gate.
 *
 * No lane exemption. Dealer and admin write paths stamp `lastSeenAt` on create AND
 * on edit, so for hand-managed inventory this reads as "time since a human last
 * touched this row" — which is the actionable question, and the reason a listing
 * unconfirmed for a month should not be shortlist-eligible whoever owns it.
 *
 * That edit-stamping is load-bearing, not incidental: without it a dealer with no
 * feed who updates a price every week would still watch every listing fall out of
 * shortlist eligibility on day 31 after creation. If you add a write path that
 * mutates an inventory row, stamp `lastSeenAt`.
 */
export function listingFreshness(
  item: { lastSeenAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): ListingFreshness {
  const referenceAt = staleReferenceAt(item);
  const ageMs = now.getTime() - referenceAt.getTime();
  return {
    lastSeenAt: item.lastSeenAt,
    referenceAt,
    ageMs,
    isStale: ageMs > STALE_FLAG_WINDOW_MS,
    shortlistEligible: ageMs <= SHORTLIST_MAX_AGE_MS,
  };
}

/**
 * May this listing enter a buyer's shortlist?
 *
 * `isActive` is part of the gate, not decoration: a swept row is one the source
 * stopped listing, and shortlisting it sends a buyer after a car that is gone.
 */
export function isShortlistEligible(
  item: { isActive: boolean; lastSeenAt: Date | null; createdAt: Date },
  now: Date = new Date(),
): boolean {
  if (!item.isActive) return false;
  return listingFreshness(item, now).shortlistEligible;
}

/** Prisma `where` fragment mirroring `isShortlistEligible`. */
export function shortlistEligibleWhere(now: Date = new Date()): Prisma.InventoryItemWhereInput {
  const cutoff = new Date(now.getTime() - SHORTLIST_MAX_AGE_MS);
  return {
    isActive: true,
    OR: [
      { lastSeenAt: { gte: cutoff } },
      { AND: [{ lastSeenAt: null }, { createdAt: { gte: cutoff } }] },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executable supply (matching / sourcing) — unchanged behaviour
// ─────────────────────────────────────────────────────────────────────────────

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
      // Freshness — dealer-managed rows are exempt from the 48h window (they own
      // their archive state and are never swept), external listings must have been
      // seen inside it. Same `dealerId` test as `isSweepExempt`, by construction.
      { OR: [{ dealerId: { not: null } }, { lastSeenAt: { gte: cutoff } }] },
      // ...but the dealer exemption is CAPPED at the shortlist window. Without this
      // cap a dealer row unseen for 45 days is matchable while being rejected by the
      // shortlist gate — the buyer is shown a vehicle and gets a 409 when they try
      // to save it. Capping here makes executable supply a strict subset of
      // shortlist-eligible supply, so that dead end cannot occur.
      shortlistEligibleWhere(now),
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
    createdAt: Date;
  },
  now: Date = new Date()
): boolean {
  if (!item.isActive) return false;
  if (!(item.priceCents > 0)) return false;
  const hasProvenance = item.dealerId != null || item.sourceAdapter != null || item.addedByAdminId != null;
  if (!hasProvenance) return false;
  const fresh = isDealerManaged(item) || (item.lastSeenAt != null && item.lastSeenAt >= freshnessCutoff(now));
  if (!fresh) return false;
  // The dealer exemption is capped at the shortlist window — see executableSupplyWhere.
  return isShortlistEligible(item, now);
}
