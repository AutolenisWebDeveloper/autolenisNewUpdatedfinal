// POST /api/admin/lineage/reparent
//
// THE audited escape hatch for §3's orphan rule, and the only place in the system
// where a parent id may be written onto an existing row.
//
//   "A payment, auction, offer, deal, contract, or pickup that cannot resolve its
//    parent is an orphan: it raises an Operations exception and is never silently
//    re-parented or duplicated into a parallel transaction."  — §3
//
// "Never SILENTLY re-parented" is the operative word. A mis-parented row is a real
// operational condition and it has to be fixable; what §3 forbids is a service
// doing it on its own initiative, with no human and no record. So this route
// exists, it is the single allowlisted entry in
// `lib/services/operations/__tests__/no-service-reparent.test.ts`, and everything a
// silent re-parent would omit is mandatory here:
//
//   • a named admin with OPERATIONS_ADMIN or SUPER_ADMIN;
//   • a non-empty reason;
//   • the new parent must resolve BEFORE the write — re-parenting onto a second
//     ghost is the same defect twice;
//   • the previous value and the new value are both recorded on the audit row, so
//     the change is reversible from the record alone;
//   • the LINEAGE_ORPHAN exception that reported the row is resolved through the
//     single writer, which throws rather than reporting a resolution it did not
//     perform.
//
// Without a route like this the only way to repair a mis-parented row would be raw
// SQL against production, which CLAUDE.md forbids outright. Reported and fixable
// beats reported and stuck.

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { logger } from "@/lib/logger";
import { resolve as resolveQueueItem, listOpen } from "@/lib/services/operations/queue-item.service";

/**
 * The classes §3 names, with the parent column each may be re-parented on. The map
 * is exhaustive and closed: a class not listed here cannot be re-parented at all,
 * and adding one is a reviewable diff rather than a free-text column name.
 */
const REPARENTABLE = {
  deposit: { parentField: "vehicleRequestId", parentModel: "vehicleRequest" },
  auction: { parentField: "vehicleRequestId", parentModel: "vehicleRequest" },
  offer: { parentField: "auctionId", parentModel: "auction" },
  deal: { parentField: "offerId", parentModel: "offer" },
  contractVersion: { parentField: "dealId", parentModel: "deal" },
  pickup: { parentField: "dealId", parentModel: "deal" },
} as const;

type ReparentClass = keyof typeof REPARENTABLE;

const schema = z.object({
  recordClass: z.enum(Object.keys(REPARENTABLE) as [ReparentClass, ...ReparentClass[]]),
  recordId: z.string().min(1),
  newParentId: z.string().min(1),
  reason: z.string().min(1, "A reason is required — a re-parent with no reason is a silent re-parent"),
  /** Optional: the LINEAGE_ORPHAN queue item this repair closes. */
  queueItemId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "Insufficient permissions — OPERATIONS_ADMIN or SUPER_ADMIN required", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { recordClass, recordId, newParentId, reason, queueItemId } = parsed.data;
  const spec = REPARENTABLE[recordClass];

  // The record itself.
  // The delegate is selected by a closed union of model names, so the cast is
  // narrowing a known-safe set rather than trusting caller input. Through
  // `unknown` because the six delegates have no common supertype.
  const model = prisma[recordClass] as unknown as {
    findUnique: (a: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
    update: (a: { where: { id: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  };
  const record = await model.findUnique({ where: { id: recordId } });
  if (!record) return adminError("NOT_FOUND", `${recordClass} ${recordId} not found`, 404);

  // The new parent must resolve first. Re-parenting onto a second ghost would
  // satisfy the request and leave the row exactly as orphaned as it was.
  const parentModel = prisma[spec.parentModel] as unknown as {
    findUnique: (a: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null>;
  };
  const parent = await parentModel.findUnique({ where: { id: newParentId }, select: { id: true } });
  if (!parent) {
    return adminError("VALIDATION_ERROR", `${spec.parentModel} ${newParentId} does not exist — re-parenting onto it would leave the row orphaned`, 400);
  }

  const previousParentId = (record[spec.parentField] as string | null) ?? null;
  if (previousParentId === newParentId) {
    return adminError("VALIDATION_ERROR", `${recordClass} ${recordId} already points at ${newParentId}`, 400);
  }

  const updated = await model.update({ where: { id: recordId }, data: { [spec.parentField]: newParentId } });

  // The audit row is awaited, not best-effort. A re-parent that is not recorded is
  // the silent re-parent §3 forbids, so it must fail the request rather than
  // succeed unrecorded.
  await createAuditLog(admin, request, {
    action: "LINEAGE_REPARENT",
    entityType: recordClass,
    entityId: recordId,
    reason,
    metadata: { parentField: spec.parentField, parentModel: spec.parentModel, queueItemId: queueItemId ?? null },
    previousState: { [spec.parentField]: previousParentId },
    newState: { [spec.parentField]: newParentId },
  });

  // Close the exception that reported it, when the caller named one. `resolve`
  // throws if the item is not open, so a stale id surfaces rather than being
  // absorbed — but the re-parent itself has already happened and is audited, so
  // the failure is reported without pretending the repair did not occur.
  let resolvedQueueItemId: string | null = null;
  if (queueItemId) {
    try {
      const item = await resolveQueueItem({
        queueItemId,
        resolution: `Re-parented ${recordClass} ${recordId}: ${spec.parentField} ${previousParentId ?? "NULL"} → ${newParentId}. ${reason}`,
        resolvedBy: admin.adminId,
      });
      resolvedQueueItemId = item.id;
    } catch (err) {
      logger.error("lineage.reparent: re-parent applied but the queue item did not close", {
        queueItemId,
        recordClass,
        recordId,
        error: err instanceof Error ? err.message : String(err),
      });
      return adminSuccess({
        recordClass,
        recordId,
        previousParentId,
        newParentId,
        resolvedQueueItemId: null,
        warning: `The re-parent was applied and audited, but queue item ${queueItemId} could not be closed. Close it manually.`,
      });
    }
  }

  return adminSuccess({
    recordClass,
    recordId,
    parentField: spec.parentField,
    previousParentId,
    newParentId,
    resolvedQueueItemId,
    remainingOrphanExceptions: (await listOpen({ exceptionCode: "LINEAGE_ORPHAN", take: 1 })).length,
    updatedAt: (updated as { updatedAt?: Date }).updatedAt ?? null,
  });
}
