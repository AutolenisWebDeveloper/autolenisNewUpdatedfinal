// lib/services/inventory/stale-sweep.service.ts
//
// THE single stale-sweep implementation. Before this file the predicate existed twice —
// inline in app/api/cron/inventory-stale-sweep/route.ts and again inside runInventorySync's
// mode==="full" branch — and both were wrong in the same way.
//
// ROOT CAUSE (production, read-only 2026-09-02, Supabase aieybibvewmvrubcpthm):
// the sweep ran 336 times in 7 days and deactivated nothing while 95 rows sat active and
// unseen for 3+ months. It was never crashing. Its predicate could not match them:
//
//   ... WHERE last_seen_at < now() - interval '48 hours'
//         AND lane <> 'LANE_1' AND is_active = true        → 0 rows
//
// All 95 carry lane='LANE_1' with dealer_id IS NULL and source_adapter IS NULL, created
// 2026-04-24..2026-06-10 by an older ingestion path. `lane != LANE_1` was shorthand for
// "dealer-verified, never auto-deactivate" — but LANE_1 is a TWO-part claim (an active
// AutoLenis dealer AND an explicitly linked vehicle), and the guard only ever checked the
// label. So it permanently protected rows nobody owned.
//
// Two further defects in the same clause:
//   - `{ lt: cutoff }` compiles to `<`, which is NULL for a NULL column and silently
//     excludes it. One of the 95 has last_seen_at IS NULL and was unreachable by any sweep.
//   - Admin-entered vehicles have no feed to vanish from, yet were swept 48h after entry.
//
// The destructive act is wrapped: dry_run by default, an absolute blast-radius breaker, and
// the deactivated ids recorded so the undo is a literal UPDATE ... WHERE id IN (...).

import type { Prisma, PrismaClient } from "@prisma/client";
import { InventoryLane } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { freshnessCutoff } from "./inventory-eligibility";

/**
 * Provenance strings written by the HUMAN-CURATED writers. Belt-and-braces beside the
 * addedByAdminId clause: app/api/admin/inventory/search-tool/add/route.ts historically wrote
 * sourceAdapter "manual_admin" with NO addedByAdminId. That route is corrected alongside this
 * change; this list still protects the rows it already wrote.
 */
export const CURATED_SOURCE_ADAPTERS = ["manual_admin", "csv_upload_admin"] as const;

/** Cap on how many rows one sweep may deactivate before it refuses and alerts instead. */
export const DEFAULT_SWEEP_ABORT_THRESHOLD = 150;

/** How many deactivated ids are recorded for undo before the list is truncated. */
export const MAX_RECORDED_IDS = 500;

export type SweepMode = "dry_run" | "enforce" | "off";

/** Deploy default is dry_run, and anything unrecognised also reads as dry_run — the
 *  destructive mode must be opted into explicitly, never reached by a typo. */
export function sweepMode(): SweepMode {
  const raw = (process.env.INVENTORY_STALE_SWEEP_MODE ?? "").trim();
  return raw === "enforce" || raw === "off" ? raw : "dry_run";
}

export function sweepAbortThreshold(): number {
  const raw = Number(process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SWEEP_ABORT_THRESHOLD;
}

/**
 * The one true sweep predicate.
 *
 * Every clause below is written to be correct under SQL's three-valued logic. A predicate
 * over a nullable column that omits its NULL branch cannot see the rows most likely to be
 * broken — which is exactly how the original defect hid for months.
 */
export function staleSweepWhere(now: Date = new Date()): Prisma.InventoryItemWhereInput {
  const cutoff = freshnessCutoff(now); // reuses FRESHNESS_WINDOW_MS — never a second literal
  return {
    AND: [
      { isActive: true },

      // FRESHNESS. `{ lt }` is NULL for a NULL column and silently excludes it, so the
      // NULL branch is spelled out. createdAt is the fallback clock: a row created minutes
      // ago must not be swept before its first sync ever runs.
      {
        OR: [
          { lastSeenAt: { lt: cutoff } },
          { AND: [{ lastSeenAt: null }, { createdAt: { lt: cutoff } }] },
        ],
      },

      // DEALER-VERIFIED PROTECTION. Tests the invariant (LANE_1 *and* an actual dealer),
      // not the label. Written as an explicit OR rather than a Prisma NOT block so it does
      // not depend on NULL semantics. Dealer-owned LANE_2/LANE_3 rows REMAIN sweepable,
      // which is what keeps the cron's dealer removal email reachable.
      {
        OR: [
          { lane: { not: InventoryLane.LANE_1 } },
          { dealerId: null },
        ],
      },

      // HUMAN-CURATED PROTECTION. An admin-entered vehicle has no feed to vanish from;
      // deactivating it 48h after entry is the bug, not the fix.
      { addedByAdminId: null },

      // Same, for historical rows carrying curated provenance but no admin id. MUST be this
      // OR, never `NOT: { sourceAdapter: { in: [...] } }`: SQL `NULL NOT IN (...)` evaluates
      // to NULL, which would silently re-protect every row with a NULL source_adapter — all
      // 95 targets. The fix would ship, typecheck, run green, and change nothing.
      {
        OR: [
          { sourceAdapter: null },
          { sourceAdapter: { notIn: [...CURATED_SOURCE_ADAPTERS] } },
        ],
      },
    ],
  };
}

export interface SweepCandidate {
  isActive: boolean;
  lane: string;
  dealerId: string | null;
  addedByAdminId: string | null;
  sourceAdapter: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/**
 * Pure in-memory mirror of `staleSweepWhere`, kept in lock-step with it (the dual-form
 * convention this codebase already uses in inventory-eligibility.ts) so the predicate can be
 * asserted exhaustively without a database.
 */
export function isStaleSweepable(item: SweepCandidate, now: Date = new Date()): boolean {
  if (!item.isActive) return false;

  const cutoff = freshnessCutoff(now);
  const unseen = item.lastSeenAt != null ? item.lastSeenAt < cutoff : item.createdAt < cutoff;
  if (!unseen) return false;

  if (item.lane === InventoryLane.LANE_1 && item.dealerId != null) return false;
  if (item.addedByAdminId != null) return false;
  if (
    item.sourceAdapter != null &&
    (CURATED_SOURCE_ADAPTERS as readonly string[]).includes(item.sourceAdapter)
  ) {
    return false;
  }
  return true;
}

export interface SweepResult {
  mode: SweepMode;
  skipped: boolean;
  candidates: number;
  deactivated: number;
  aborted: boolean;
  abortThreshold: number;
  /** Ids flipped (enforce) or sampled (dry_run), for undo / evidence. Capped. */
  deactivatedIds: string[];
  idsTruncated: boolean;
  cutoff: Date | null;
  breakdown: { lane1NoDealer: number; nullLastSeen: number; other: number };
}

type PrismaLike = PrismaClient | typeof defaultPrisma;

/**
 * Run the sweep. The SELECT happens in every mode except `off` — evidence is never gated
 * behind the destructive switch, because the whole point of dry_run is to see the blast
 * radius before authorising it.
 */
export async function sweepStaleInventory(opts: {
  now?: Date;
  mode?: SweepMode;
  prisma?: PrismaLike;
} = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const mode = opts.mode ?? sweepMode();
  const db = (opts.prisma ?? defaultPrisma) as PrismaLike;
  const abortThreshold = sweepAbortThreshold();

  const empty: SweepResult = {
    mode, skipped: false, candidates: 0, deactivated: 0, aborted: false,
    abortThreshold, deactivatedIds: [], idsTruncated: false,
    cutoff: freshnessCutoff(now),
    breakdown: { lane1NoDealer: 0, nullLastSeen: 0, other: 0 },
  };

  // `off` short-circuits the work but the CALLER still writes its CronJobLog, so a disabled
  // sweep never reads as a dead cron.
  if (mode === "off") return { ...empty, skipped: true, cutoff: null };

  const where = staleSweepWhere(now);
  const rows = await db.inventoryItem.findMany({
    where,
    select: { id: true, lane: true, dealerId: true, lastSeenAt: true },
  });

  const breakdown = {
    lane1NoDealer: rows.filter((r) => r.lane === InventoryLane.LANE_1 && r.dealerId == null).length,
    nullLastSeen: rows.filter((r) => r.lastSeenAt == null).length,
    other: rows.filter((r) => !(r.lane === InventoryLane.LANE_1 && r.dealerId == null)).length,
  };
  const ids = rows.map((r) => r.id);

  // BLAST-RADIUS BREAKER. The legitimate first enforce run is 95 rows. A repeat of the
  // 2026-08-24..31 HTTP 429 blackout against a ~500-row catalogue would make EVERY row stale,
  // and with a correct predicate and no breaker that is a catalogue wipe. Refusing is the
  // right answer; an aborted sweep is not a failed cron — it did exactly what it was told.
  if (ids.length > abortThreshold) {
    await db.notification.create({
      data: {
        title: `Inventory stale sweep aborted: ${ids.length} candidates`,
        body:
          `The stale sweep found ${ids.length} deactivation candidates, over the ` +
          `${abortThreshold} safety threshold, and deactivated nothing. This usually means ` +
          `ingestion has stopped (check inventory_sync_runs for HTTP 429 / DEFERRED runs) ` +
          `rather than that the catalogue genuinely turned over.`,
        type: "SYSTEM_ALERT",
      },
    }).catch((e) => logger.warn("[stale-sweep] abort alert failed:", e));

    return { ...empty, candidates: ids.length, aborted: true, breakdown };
  }

  if (mode === "dry_run") {
    return {
      ...empty,
      candidates: ids.length,
      deactivatedIds: ids.slice(0, 50),
      idsTruncated: ids.length > 50,
      breakdown,
    };
  }

  if (ids.length === 0) return { ...empty, breakdown };

  // Flip by id, not by re-running the predicate: the rows were already selected, and a
  // second evaluation could pick up rows that changed in between.
  const { count } = await db.inventoryItem.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false },
  });

  return {
    ...empty,
    candidates: ids.length,
    deactivated: count,
    deactivatedIds: ids.slice(0, MAX_RECORDED_IDS),
    idsTruncated: ids.length > MAX_RECORDED_IDS,
    breakdown,
  };
}
