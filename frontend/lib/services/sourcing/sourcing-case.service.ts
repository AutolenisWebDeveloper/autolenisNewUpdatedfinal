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
 * Phase 3 wrote exactly one of these and said the rest were Phase 5's to add "as the
 * ladder and the readiness hold arrive", on the principle that a status nothing can
 * reach is indistinguishable from one that is broken. Phase 5 adds them WITH their
 * writers: every value below is reached by `transitionCase` from a real branch, and
 * `sourcing-status.test.ts` asserts that each one has one.
 */
export const SOURCING_CASE_STATUS = {
  /** Paid, attached, and being sourced. §Stage 6 entry. Phase 3 opens the case here. */
  ACTIVE_SOURCING: "ACTIVE_SOURCING",

  // ── Phase 5 — the §6c outcomes. One per row of the Stage 6c decision table. ──

  /** 5–8 invitation-ready rooftops. §6c "Launch automatically". */
  READY_TO_LAUNCH: "READY_TO_LAUNCH",
  /**
   * 3–4 invitation-ready rooftops. §6c "Limited auction, only with audited
   * Operations approval" — the case HOLDS here and only an audited admin action
   * moves it to READY_TO_LAUNCH.
   */
  LIMITED_PENDING_APPROVAL: "LIMITED_PENDING_APPROVAL",
  /**
   * 1–2 invitation-ready rooftops. §6c "Continue expansion, source manually, or
   * close after review". Three outcomes, all Operations', so the status names the
   * hold rather than pre-judging which one happens.
   */
  THIN_COVERAGE_REVIEW: "THIN_COVERAGE_REVIEW",
  /** 0 invitation-ready rooftops. §6c "Close as no coverage after Operations review". */
  ZERO_COVERAGE_REVIEW: "ZERO_COVERAGE_REVIEW",
  /**
   * The ladder reached 250 miles without meeting the threshold and the buyer has
   * not authorised more. §Stage 6 "If it fails". Mirrors
   * `VehicleRequestStatus.RADIUS_AUTHORIZATION_REQUIRED`, which this status is what
   * finally makes reachable.
   */
  RADIUS_AUTHORIZATION_REQUIRED: "RADIUS_AUTHORIZATION_REQUIRED",
  /** Readiness passed, the auction exists and invitations are out. Stage 7 reached. */
  LAUNCHED: "LAUNCHED",
  /**
   * Terminal. `closeReason` says which §6c branch or which 14-day timeout ended it.
   * History is preserved — nothing is deleted (§Stage 6 "closing as abandoned after
   * 14 days with history preserved").
   */
  CLOSED: "CLOSED",
} as const;

export type SourcingCaseStatus =
  (typeof SOURCING_CASE_STATUS)[keyof typeof SOURCING_CASE_STATUS];

/**
 * §6a's ladder, as the four values `sourcing_cases_band_check` admits. The CHECK is
 * the authority on the vocabulary — this object must agree with
 * `migration.sql:141` and the state-machine test pins that.
 *
 * The rungs are NOT the 25/50/100/150 of `RADIUS_TIERS` in
 * `lib/services/auction/coverage.service.ts`. That ladder belongs to the legacy A4
 * invite path, which stays live while `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` is off
 * (§13-D52 is the owner's, and no earlier phase may action it). §6a's ladder is
 * 100 → 150 → 250 → buyer-authorised, and band 1 and band 2 share the 100-mile rung:
 * registered rooftops first, then outside rooftops at the same radius.
 */
export const SOURCING_BAND = {
  /** §6a steps 1 and 2 — registered within 100, then outside within 100. */
  B100: "100",
  /** §6a step 3 — the 100–150 annulus. */
  B150: "150",
  /** §6a step 4 — the 150–250 annulus. */
  B250: "250",
  /** §6a step 5 — beyond 250, only within `authorizedRadiusMiles`. */
  AUTHORIZED: "AUTHORIZED",
} as const;

export type SourcingBand = (typeof SOURCING_BAND)[keyof typeof SOURCING_BAND];

/** The outer radius of each band, in miles. `AUTHORIZED` has no fixed outer edge. */
export const BAND_OUTER_MILES: Record<SourcingBand, number | null> = {
  [SOURCING_BAND.B100]: 100,
  [SOURCING_BAND.B150]: 150,
  [SOURCING_BAND.B250]: 250,
  [SOURCING_BAND.AUTHORIZED]: null,
};

/**
 * The INNER edge of each band — what makes an expansion search "only the new band"
 * (§6a: "Each expansion searches only the new band and reuses valid candidates
 * already found", §10.6 S6-09, status BROKEN today).
 *
 * This is the annulus that stops the cost defect the independent review measured on
 * the legacy gate: `applyRequestCoverageGate` re-resolves contacts at EVERY tier, so
 * one call can pay for 4 × 60 = 240 prospect resolutions — each potentially an MX
 * lookup and a grounded LLM call — and the worst case is precisely the thin-coverage
 * case the gate exists to detect. Searching the annulus only, and reusing the
 * `sourcing_candidates` rows the previous band already validated, makes each
 * expansion cost what the new ring costs.
 */
export const BAND_INNER_MILES: Record<SourcingBand, number> = {
  [SOURCING_BAND.B100]: 0,
  [SOURCING_BAND.B150]: 100,
  [SOURCING_BAND.B250]: 150,
  [SOURCING_BAND.AUTHORIZED]: 250,
};

/** §6a's order. `nextBand(AUTHORIZED)` is null — the ladder ends there. */
export const BAND_ORDER: readonly SourcingBand[] = [
  SOURCING_BAND.B100,
  SOURCING_BAND.B150,
  SOURCING_BAND.B250,
  SOURCING_BAND.AUTHORIZED,
] as const;

export function nextBand(band: SourcingBand): SourcingBand | null {
  const i = BAND_ORDER.indexOf(band);
  return i < 0 || i === BAND_ORDER.length - 1 ? null : BAND_ORDER[i + 1]!;
}

/**
 * The effective outer radius to search, in miles.
 *
 * S6-10: "the buyer-authorized maximum is never exceeded". Expressed as
 * `min(bandOuter, authorized)` so the cap is arithmetic rather than a branch a caller
 * can forget — and so an authorisation SMALLER than the band's own edge still binds.
 * That case is real: a buyer asked for authorisation at 250 and granted 180, so the
 * 250 band must search to 180, not 250.
 *
 * Returns null when the band is AUTHORIZED and no authorisation exists, which the
 * ladder treats as "refuse to search" rather than "search without limit".
 */
export function effectiveRadiusMiles(
  band: SourcingBand,
  authorizedRadiusMiles: number | null,
): number | null {
  const outer = BAND_OUTER_MILES[band];
  if (outer === null) {
    // AUTHORIZED: the buyer's number IS the edge. No authorisation, no search.
    return authorizedRadiusMiles && authorizedRadiusMiles > 250 ? authorizedRadiusMiles : null;
  }
  if (authorizedRadiusMiles === null) return outer;
  return Math.min(outer, authorizedRadiusMiles);
}

/**
 * The legal status transitions. §28.3 requires transition control, and the §6c
 * outcomes are not a free-for-all: a case cannot go from ZERO_COVERAGE_REVIEW
 * straight to LAUNCHED without passing through a decision that produced a field.
 *
 * Deliberately permissive in one direction and strict in the other. A case may move
 * BACK to ACTIVE_SOURCING from any non-terminal hold, because band expansion, a
 * radius authorisation and an Operations "keep looking" all legitimately resume
 * sourcing. It may only reach LAUNCHED from READY_TO_LAUNCH, which is the §6c gate
 * the limited-auction approval has to pass through.
 */
const ALLOWED_TRANSITIONS: Record<SourcingCaseStatus, readonly SourcingCaseStatus[]> = {
  ACTIVE_SOURCING: [
    SOURCING_CASE_STATUS.READY_TO_LAUNCH,
    SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL,
    SOURCING_CASE_STATUS.THIN_COVERAGE_REVIEW,
    SOURCING_CASE_STATUS.ZERO_COVERAGE_REVIEW,
    SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED,
    SOURCING_CASE_STATUS.CLOSED,
  ],
  READY_TO_LAUNCH: [
    SOURCING_CASE_STATUS.LAUNCHED,
    // Readiness can fail after the field is assembled — a contact becomes suppressed,
    // a candidate sells. §7 says the auction holds rather than half-launching, so the
    // case returns to sourcing rather than sitting in a ready state that is not.
    SOURCING_CASE_STATUS.ACTIVE_SOURCING,
    SOURCING_CASE_STATUS.CLOSED,
  ],
  LIMITED_PENDING_APPROVAL: [
    SOURCING_CASE_STATUS.READY_TO_LAUNCH, // the audited approval, §6c
    SOURCING_CASE_STATUS.ACTIVE_SOURCING, // Operations chose to keep expanding
    SOURCING_CASE_STATUS.CLOSED,
  ],
  THIN_COVERAGE_REVIEW: [
    SOURCING_CASE_STATUS.ACTIVE_SOURCING, // "continue expansion" / "source manually"
    SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL, // manual sourcing reached 3–4
    SOURCING_CASE_STATUS.READY_TO_LAUNCH, // manual sourcing reached 5+
    SOURCING_CASE_STATUS.CLOSED, // "close after review"
  ],
  ZERO_COVERAGE_REVIEW: [
    SOURCING_CASE_STATUS.ACTIVE_SOURCING, // "expand"
    SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED,
    SOURCING_CASE_STATUS.CLOSED, // "close"
  ],
  RADIUS_AUTHORIZATION_REQUIRED: [
    SOURCING_CASE_STATUS.ACTIVE_SOURCING, // the buyer authorised; resume at AUTHORIZED
    SOURCING_CASE_STATUS.CLOSED, // 14 days, abandoned
  ],
  // Terminal in this phase. Phase 6 owns what happens to a case once its auction
  // closes, and Phase 10 owns cancellation orchestration.
  LAUNCHED: [SOURCING_CASE_STATUS.CLOSED],
  CLOSED: [],
};

export function canTransition(from: SourcingCaseStatus, to: SourcingCaseStatus): boolean {
  if (from === to) return true; // idempotent re-assert, not a transition
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

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

// ───────────────────────────────────────────────────────────────────────────────
// Phase 5 — reading the case, and the one guarded writer that moves it
// ───────────────────────────────────────────────────────────────────────────────

export interface SourcingCaseRecord {
  id: string;
  vehicleRequestId: string;
  status: SourcingCaseStatus;
  band: SourcingBand;
  authorizedRadiusMiles: number | null;
  authorizationRequestedAt: Date | null;
  coverageCount: number;
  limitedAuctionApprovedBy: string | null;
  limitedAuctionApprovedAt: Date | null;
  bandExpandedAt: Date | null;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
}

const CASE_SELECT = {
  id: true,
  vehicleRequestId: true,
  status: true,
  band: true,
  authorizedRadiusMiles: true,
  authorizationRequestedAt: true,
  coverageCount: true,
  limitedAuctionApprovedBy: true,
  limitedAuctionApprovedAt: true,
  bandExpandedAt: true,
  openedAt: true,
  closedAt: true,
  closeReason: true,
} as const;

/**
 * Load the case for a request, or null.
 *
 * A QUERY FAILURE IS NOT AN ABSENT CASE. This throws rather than returning null on a
 * database error, because every caller branches on null as "no case yet, nothing to
 * source" — and the carry-forward rule from Phases 2–4 is that a query failure renders
 * as a failure, never as a confident empty.
 */
export async function getSourcingCase(
  vehicleRequestId: string,
  db: Db = prisma,
): Promise<SourcingCaseRecord | null> {
  const row = await db.sourcingCase.findUnique({
    where: { vehicleRequestId },
    select: CASE_SELECT,
  });
  return row ? (row as SourcingCaseRecord) : null;
}

export async function getSourcingCaseById(
  caseId: string,
  db: Db = prisma,
): Promise<SourcingCaseRecord | null> {
  const row = await db.sourcingCase.findUnique({ where: { id: caseId }, select: CASE_SELECT });
  return row ? (row as SourcingCaseRecord) : null;
}

export interface TransitionInput {
  caseId: string;
  to: SourcingCaseStatus;
  /** Why, for the audit trail and for `closeReason` on a close. */
  reason: string;
  /** Set together with a CLOSED transition. Ignored otherwise. */
  closedAt?: Date;
  /** §6c's ready count, recorded on every outcome transition. */
  coverageCount?: number;
  band?: SourcingBand;
  bandExpandedAt?: Date | null;
  authorizedRadiusMiles?: number | null;
  authorizationRequestedAt?: Date | null;
  limitedAuctionApprovedBy?: string | null;
  limitedAuctionApprovedAt?: Date | null;
}

export type TransitionResult =
  | { ok: true; from: SourcingCaseStatus; to: SourcingCaseStatus; changed: boolean }
  | { ok: false; reason: "CASE_NOT_FOUND" }
  | { ok: false; reason: "ILLEGAL_TRANSITION"; from: SourcingCaseStatus; to: SourcingCaseStatus }
  | { ok: false; reason: "LOST_RACE"; from: SourcingCaseStatus };

/**
 * The ONE writer of `sourcing_cases.status`. §28.3 requires transition control, and a
 * status spread across call sites is how a state machine stops being one.
 *
 * COMPARE-AND-SET, not read-then-write. The `updateMany` carries the observed status in
 * its WHERE clause, so two concurrent writers cannot both believe they moved the case:
 * the loser gets `count === 0` and LOST_RACE. This matters because the case is moved
 * from three directions at once — the reconciler tick that expands bands, a buyer
 * recording a radius authorisation, and an Operations action — and the §6c outcome
 * depends on the coverage count that was read alongside the status.
 *
 * Returns a result rather than throwing on an illegal transition. A caller racing a
 * legitimate concurrent move is not a programming error, and the band-expansion loop
 * specifically needs to re-read and retry rather than fail the tick.
 */
export async function transitionCase(
  input: TransitionInput,
  db: Db = prisma,
): Promise<TransitionResult> {
  const current = await db.sourcingCase.findUnique({
    where: { id: input.caseId },
    select: { status: true },
  });
  if (!current) return { ok: false, reason: "CASE_NOT_FOUND" };

  const from = current.status as SourcingCaseStatus;
  if (!canTransition(from, input.to)) {
    return { ok: false, reason: "ILLEGAL_TRANSITION", from, to: input.to };
  }

  const data: Record<string, unknown> = { status: input.to, updatedAt: new Date() };
  if (input.band !== undefined) data.band = input.band;
  if (input.bandExpandedAt !== undefined) data.bandExpandedAt = input.bandExpandedAt;
  if (input.coverageCount !== undefined) data.coverageCount = input.coverageCount;
  if (input.authorizedRadiusMiles !== undefined) data.authorizedRadiusMiles = input.authorizedRadiusMiles;
  if (input.authorizationRequestedAt !== undefined) {
    data.authorizationRequestedAt = input.authorizationRequestedAt;
  }
  if (input.limitedAuctionApprovedBy !== undefined) {
    data.limitedAuctionApprovedBy = input.limitedAuctionApprovedBy;
  }
  if (input.limitedAuctionApprovedAt !== undefined) {
    data.limitedAuctionApprovedAt = input.limitedAuctionApprovedAt;
  }
  if (input.to === SOURCING_CASE_STATUS.CLOSED) {
    // §Stage 6 "closing as abandoned after 14 days with history preserved" — the close
    // is a status and a reason, never a delete. `closeReason` is the only record of WHICH
    // §6c branch or timeout ended the case, so it is written on every close.
    data.closedAt = input.closedAt ?? new Date();
    data.closeReason = input.reason;
  }

  const updated = await db.sourcingCase.updateMany({
    where: { id: input.caseId, status: from },
    data,
  });
  if (updated.count === 0) {
    // Someone moved it between the read and the write. The caller re-reads; it is not
    // an error, and it is the reason this is a compare-and-set at all.
    logger.info(
      `[sourcing-case] ${input.caseId}: lost the race from ${from} -> ${input.to} (${input.reason})`,
    );
    return { ok: false, reason: "LOST_RACE", from };
  }

  logger.info(
    `[sourcing-case] ${input.caseId}: ${from} -> ${input.to} (${input.reason})` +
      (input.coverageCount !== undefined ? ` coverage=${input.coverageCount}` : "") +
      (input.band !== undefined ? ` band=${input.band}` : ""),
  );
  return { ok: true, from, to: input.to, changed: from !== input.to };
}
