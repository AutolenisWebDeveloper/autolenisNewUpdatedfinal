// lib/services/vehicle-request/request-progression.service.ts — Batch 3
//
// Deterministic, idempotent automatic progression of a VehicleRequest through the
// pre-auction sourcing statuses:  SUBMITTED → INTAKE → ACTIVE_SOURCING.
//
// This fixes the stall (requests sat at SUBMITTED because the only auto-advance was
// a best-effort, conditional INTAKE bump in the request route that silently failed).
//
// Scope boundary (deposit-first model, locked with the owner):
//   - Progression STOPS at ACTIVE_SOURCING. It surfaces matched inventory + coverage
//     but NEVER launches the competitive dealer auction (that stays gated on the $99
//     deposit) and NEVER creates an offer or a Deal (those remain admin-only — the
//     vehicle-request module's isolation invariant).
//   - Thin coverage does NOT block advancement (owner decision "advance + flag"): a
//     request advances and the existing coverage-hold marker is set for admin
//     visibility + recruitment.
//
// Concurrency-safe: each transition is a conditional updateMany on the exact prior
// status, so only one caller can perform a given transition; re-running is a no-op.

import { logger } from "@/lib/logger";
import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { matchInventoryForRequest } from "@/lib/services/inventory/request-inventory-match.service";
import { applyRequestCoverageGate } from "@/lib/services/acquisition/request-coverage-gate.service";

export interface ProgressionDeps {
  prisma: PrismaClient;
  // Populate VehicleRequestMatchResult for the request (Batch 1). Best-effort.
  matchInventory: (requestId: string) => Promise<unknown>;
  // Assess + flag coverage (sets the soft-hold marker; recruit off here). Best-effort.
  applyCoverageGate: (requestId: string) => Promise<unknown>;
}

function resolveDeps(deps?: Partial<ProgressionDeps>): ProgressionDeps {
  const prisma = deps?.prisma ?? defaultPrisma;
  return {
    prisma,
    matchInventory: deps?.matchInventory ?? ((id) => matchInventoryForRequest(id)),
    applyCoverageGate: deps?.applyCoverageGate ?? ((id) => applyRequestCoverageGate(id, { prisma, recruitOnThin: false })),
  };
}

// Only SUBMITTED / INTAKE are auto-advanceable. Everything at/after ACTIVE_SOURCING
// (offers/deal) is admin/offer-driven and left untouched.
const ADVANCEABLE = new Set(["SUBMITTED", "INTAKE"]);

interface RequestRow {
  status: string;
  makePreference: string | null;
  modelPreference: string | null;
  notes: string | null;
  buyer: { zip: string | null } | null;
}

/** A submission is complete enough to leave SUBMITTED: it can be geolocated and has vehicle intent. */
export function isWellFormedForIntake(req: {
  makePreference: string | null;
  modelPreference: string | null;
  notes: string | null;
  buyer: { zip: string | null } | null;
}): boolean {
  const hasZip = !!req.buyer?.zip;
  const hasIntent = !!(req.makePreference || req.modelPreference || (req.notes && req.notes.trim().length > 0));
  return hasZip && hasIntent;
}

export interface ProgressionResult {
  requestId: string;
  found: boolean;
  advanced: boolean;
  from: string;
  to: string;
  reason?: string;
}

async function writeEvent(prisma: PrismaClient, requestId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await prisma.vehicleRequestEvent.create({ data: { requestId, eventType, payload: payload as Prisma.InputJsonValue } }).catch(() => {});
}

/**
 * Advance a single request as far as it can deterministically go toward
 * ACTIVE_SOURCING. Idempotent and safe to call repeatedly.
 */
export async function advanceVehicleRequest(requestId: string, deps?: Partial<ProgressionDeps>): Promise<ProgressionResult> {
  const { prisma, matchInventory, applyCoverageGate } = resolveDeps(deps);

  const req = (await prisma.vehicleRequest.findUnique({
    where: { id: requestId },
    select: { status: true, makePreference: true, modelPreference: true, notes: true, buyer: { select: { zip: true } } },
  })) as RequestRow | null;

  if (!req) {
    return { requestId, found: false, advanced: false, from: "", to: "", reason: "not_found" };
  }
  const from = req.status;
  if (!ADVANCEABLE.has(req.status)) {
    return { requestId, found: true, advanced: false, from, to: from, reason: "not_advanceable" };
  }

  let status = req.status;

  // SUBMITTED → INTAKE (only when the submission is well-formed).
  if (status === "SUBMITTED") {
    if (!isWellFormedForIntake(req)) {
      return { requestId, found: true, advanced: false, from, to: "SUBMITTED", reason: "incomplete_submission" };
    }
    const upd = await prisma.vehicleRequest.updateMany({ where: { id: requestId, status: "SUBMITTED" }, data: { status: "INTAKE" } });
    if (upd.count > 0) {
      await writeEvent(prisma, requestId, "AUTO_INTAKE", { reason: "well-formed submission auto-advanced" });
      status = "INTAKE";
    } else {
      // Lost the race — re-read the winner's status and continue from there.
      status = (await prisma.vehicleRequest.findUnique({ where: { id: requestId }, select: { status: true } }))?.status ?? status;
    }
  }

  // INTAKE → ACTIVE_SOURCING. Surface matches + flag coverage first (best-effort —
  // neither ever blocks advancement), then flip the status.
  if (status === "INTAKE") {
    await matchInventory(requestId).catch((e) => logger.error(`[request-progression] match failed for ${requestId}:`, e));
    await applyCoverageGate(requestId).catch((e) => logger.error(`[request-progression] coverage gate failed for ${requestId}:`, e));
    const upd = await prisma.vehicleRequest.updateMany({ where: { id: requestId, status: "INTAKE" }, data: { status: "ACTIVE_SOURCING" } });
    if (upd.count > 0) {
      await writeEvent(prisma, requestId, "AUTO_SOURCING", { reason: "matches surfaced + coverage assessed" });
      status = "ACTIVE_SOURCING";
    } else {
      status = (await prisma.vehicleRequest.findUnique({ where: { id: requestId }, select: { status: true } }))?.status ?? status;
    }
  }

  return { requestId, found: true, advanced: status !== from, from, to: status };
}

export interface ProgressionReconcileResult {
  found: number;
  advanced: number;
  incomplete: number;
  failed: number;
}

/**
 * Reconciler: scan pre-sourcing requests and advance each. This is what makes
 * progression reliable — a request whose inline after() advance failed is picked
 * up here on the next tick. Bounded per run; per-request isolated.
 */
export async function reconcileRequestProgression(deps?: Partial<ProgressionDeps> & { limit?: number }): Promise<ProgressionReconcileResult> {
  const { prisma } = resolveDeps(deps);
  const limit = Math.min(Math.max(deps?.limit ?? 100, 1), 500);

  const rows = await prisma.vehicleRequest.findMany({
    where: { status: { in: ["SUBMITTED", "INTAKE"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: ProgressionReconcileResult = { found: rows.length, advanced: 0, incomplete: 0, failed: 0 };
  for (const row of rows) {
    try {
      const r = await advanceVehicleRequest(row.id, deps);
      if (r.advanced) result.advanced += 1;
      else if (r.reason === "incomplete_submission") result.incomplete += 1;
    } catch (err) {
      logger.error(`[request-progression] reconcile failed for ${row.id}:`, err);
      result.failed += 1;
    }
  }
  if (result.found > 0) {
    logger.info(`[request-progression] reconcile: found=${result.found} advanced=${result.advanced} incomplete=${result.incomplete} failed=${result.failed}`);
  }
  return result;
}
