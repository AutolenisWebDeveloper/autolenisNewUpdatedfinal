// lib/services/sourcing/sourcing-case.service.ts
//
// S6-02a / S6-38 / PAY-33 — settlement opens a SOURCING CASE, and no longer creates an
// auction.
//
// §5d's settlement list ends with "open the sourcing case", and §Stage 6's entry is
// "settled, undisputed payment attached to the request; ACTIVE_SOURCING means paid
// sourcing". Before Phase 3 neither existed: the webhook created an `Auction` inside the
// money transaction and launched it, and the string `SourcingCase` appeared nowhere in
// the codebase. The table has been there since the Phase 1 wave with nothing writing it.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not create an Auction, invite a dealer, or
// decide coverage. The ladder, the band expansion and the readiness checklist are Phase
// 5's, and this is the record they will read. Opening the case is the whole job.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { initializeCheckpoints } from "@/lib/services/vehicle-request/vehicle-request-due-diligence.service";
import { withSavepoint } from "@/lib/prisma-savepoint";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * `sourcing_cases.status` is unconstrained TEXT in the schema — no enum, no CHECK; the
 * only CHECK on that table is on `band`. So the vocabulary lives here, and this is the
 * one place that writes it, rather than a string literal spread across call sites.
 *
 * Phase 3 writes exactly one of these. The rest are Phase 5's to add as the ladder and
 * the readiness hold arrive; they are not pre-declared here, because a status nothing
 * can reach is indistinguishable from one that is broken.
 */
export const SOURCING_CASE_STATUS = {
  /** Paid, attached, and waiting for Phase 5 to source it. §Stage 6 entry. */
  ACTIVE_SOURCING: "ACTIVE_SOURCING",
} as const;

export interface OpenSourcingCaseResult {
  caseId: string;
  /** False when the case already existed — a Stripe redelivery, not an error. */
  created: boolean;
}

/**
 * Open the sourcing case for a settled Vehicle Request.
 *
 * IDEMPOTENT BY CONSTRAINT, not by check-then-write. `sourcing_cases.vehicle_request_id`
 * is `@unique`, so a redelivered settlement loses the insert with P2002 and we return
 * the row that won. A `findFirst` first would leave the window between the read and the
 * write open — which, in a webhook that Stripe retries on any 5xx, is a window that gets
 * hit rather than a theoretical one.
 *
 * Takes the transaction client because §5d requires the whole settlement to be atomic:
 * a case opened outside the transaction that recorded the payment could survive a
 * rollback and leave a request "being sourced" for money that never settled.
 */
export async function openSourcingCase(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<OpenSourcingCaseResult> {
  try {
    // SAVEPOINTED, and this is not optional here.
    //
    // The create-then-catch-P2002-then-re-read idiom is correct on the top-level
    // client, where each statement is its own transaction. Handed a TRANSACTION client
    // — which this function requires, because §5d makes the settlement atomic — it is
    // broken: PostgreSQL aborts the whole transaction on a constraint violation and
    // Prisma issues no savepoints of its own, so the re-read below throws 25P02 on an
    // aborted transaction. `lib/prisma-savepoint.ts` records the worse variant measured
    // on PostgreSQL 16: the outer `$transaction` can RESOLVE while Postgres turns the
    // COMMIT into a ROLLBACK, and the caller is handed ids for rows that were never
    // written.
    //
    // The redelivery this recovery exists for is exactly a redelivery INSIDE the money
    // transaction, so the unguarded version failed precisely when it was needed. Five
    // other services already wrap the same idiom this way.
    const created = await withSavepoint(db, () =>
      db.sourcingCase.create({
        data: {
          id: randomUUID(),
          vehicleRequestId,
          status: SOURCING_CASE_STATUS.ACTIVE_SOURCING,
          // `band` defaults to "100" in the schema, which is the first rung of the
          // 100 → 150 → 250 ladder §6a describes. Left to the default rather than
          // restated, so there is one place that decides where sourcing starts.
        },
        select: { id: true },
      }),
    );

    // S6-29a: the due-diligence checkpoints are seeded WITH the case, in the same
    // transaction. Seeding them afterwards would mean a case could exist with nothing
    // to work through if the second write failed.
    await initializeCheckpoints(vehicleRequestId, db);

    return { caseId: created.id, created: true };
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;

    const existing = await db.sourcingCase.findUnique({
      where: { vehicleRequestId },
      select: { id: true },
    });
    if (!existing) throw err; // the unique violation was on something else entirely

    logger.info(
      `[sourcing-case] case ${existing.id} already open for request ${vehicleRequestId} — ` +
        `treating this settlement as a redelivery`,
    );
    // Still ensure the checkpoints exist: a partial earlier run could have created the
    // case and failed before seeding. `initializeCheckpoints` is itself idempotent.
    await initializeCheckpoints(vehicleRequestId, db);
    return { caseId: existing.id, created: false };
  }
}
