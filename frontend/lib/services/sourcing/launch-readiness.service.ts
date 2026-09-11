// lib/services/sourcing/launch-readiness.service.ts
//
// Stage 7 entry — the launch-readiness checklist, and the only path that creates an auction
// from a sourcing case.
//
// §Stage 7: "Entry — launch readiness. Confirm every item before launch: the $99 is settled
// and undisputed; the prequalification and approved ceiling are attached; vehicle criteria
// are complete; the required dealer count or an approved exception exists; every contact is
// send-safe against suppression and opt-out lists; every rooftop is within the permitted
// distance; and the auction and per-dealer invitation references exist.
//
// Any failure keeps the auction pending and shows the exact missing prerequisite. The auction
// never launches half-ready."
//
// THE TWO-PHASE CREATE IS THE WHOLE MECHANISM, and it is what S7-07 calls BROKEN today.
//
//   1. The `Auction` row is created PENDING, with `vehicleRequestId` AND `depositId` both set
//      (S7-17 — at HEAD the webhook creates an auction with no request id).
//   2. Invitations are written QUEUED against it.
//   3. ONLY THEN, and only if at least one invitation row exists, the auction flips ACTIVE
//      with `startedAt`/`endsAt` in one transaction.
//
// An auction that fails at any step stays PENDING and is not a live auction: no dealer sees
// it, no offer can be submitted, and the blocker is recorded per checkpoint with an owner. The
// legacy path did the opposite — it created and launched inside the money transaction and
// invited afterwards, best-effort, with `.catch(log)` — which is how an auction could go live
// with zero dealers and then be auto-closed as "zero invitations".
//
// THIS REPLACES CLOSE-ON-ZERO (defect 6). §8.2's Phase 5 bullet is explicit: the readiness
// hold is what replaces the reconciler's close-on-zero branch. An auction that cannot reach a
// field never becomes ACTIVE, so there is no live zero-dealer auction left to close.

import { logger } from "@/lib/logger";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { AUCTION_DURATION_HOURS } from "@/lib/constants";
import { settledDepositForRequest } from "@/lib/services/payment/fulfillment-gate";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { issueInvitations, type InvitationTarget } from "@/lib/services/auction/auction-invitation.service";
import {
  SOURCING_CASE_STATUS,
  transitionCase,
  type SourcingCaseRecord,
} from "./sourcing-case.service";
import {
  MIN_AUTO_LAUNCH_FIELD,
  MIN_LIMITED_AUCTION_FIELD,
  MAX_INVITATION_FIELD,
} from "./rooftop-sourcing.service";

type Db = PrismaClient | Prisma.TransactionClient;

/** One §7 entry item. The name is what the buyer-facing and admin-facing surfaces show. */
export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  passed: boolean;
  /** Exactly what is missing. §Stage 7: "shows the exact missing prerequisite." */
  blocker: string | null;
  /** Who has to act. §26 requires every exception to name an owner. */
  owner: "SYSTEM" | "BUYER" | "OPERATIONS" | "COMPLIANCE";
}

export type ReadinessKey =
  | "DEPOSIT_SETTLED"
  | "APPROVAL_ATTACHED"
  | "CRITERIA_COMPLETE"
  | "DEALER_COUNT"
  | "CONTACTS_SEND_SAFE"
  | "ROOFTOPS_IN_DISTANCE"
  | "DUE_DILIGENCE_CHECKPOINTS"
  | "REFERENCES_EXIST";

export interface ReadinessResult {
  ready: boolean;
  items: ReadinessItem[];
  /** The rooftops that would be invited, ranked and capped, when ready. */
  field: InvitationTarget[];
  blockers: string[];
}

/**
 * Evaluate every §7 entry item. PURE with respect to the auction: it creates nothing and
 * sends nothing, so a surface can show the checklist without side effects.
 */
export async function evaluateReadiness(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  db: Db = defaultPrisma,
  // Kept in the signature so a test can pin a clock and so `launchFromCase` passes one clock
  // through the whole launch. Every time-dependent item delegates its own comparison:
  // the approval check to `recheckApproval`, the deposit to the deposit predicate.
  _now: Date = new Date(),
): Promise<ReadinessResult> {
  const items: ReadinessItem[] = [];

  // ── 1. "the $99 is settled and undisputed" ──
  //
  // READ FROM THE DEPOSIT, NOT FROM THE STATUS. `ACTIVE_SOURCING` is still written with no
  // payment check by `request-progression.service.ts:123`, driven every 15 minutes by the
  // `coverage-hold-reconcile` cron — so the status cannot stand in for the money. The
  // predicate is the request-scoped one: PAID ∧ not refunded ∧ not on hold ∧ bound to THIS
  // request (S7-01b).
  const deposit = await settledDepositForRequest(vehicleRequestId);
  items.push({
    key: "DEPOSIT_SETTLED",
    label: "The $99 is settled and undisputed",
    passed: deposit !== null,
    blocker: deposit ? null : "No settled, undisputed $99 deposit is bound to this request.",
    owner: "BUYER",
  });

  // ── 2. "the prequalification and approved ceiling are attached" ──
  //
  // THE PHASE 2 HELPER, NOT A FOURTH INLINE PREDICATE. S7-02's required change names it, and
  // `approval-recheck.ts`'s own header records that the validity predicate was already being
  // re-derived inline at five sites, weaker in at least one of them (`prequal/D3`). Calling
  // `recheckApproval` means the auction-launch gate agrees with the payment, selection and
  // contract gates by construction, and it raises §26's "Approval expires mid-transaction"
  // row with the right owner and return point without this service knowing how.
  const buyerId = await requestBuyerId(vehicleRequestId, db);
  const { recheckApproval } = await import("@/lib/services/prequal/approval-recheck");
  const approval = buyerId
    ? await recheckApproval(buyerId, "auction_launch", { raiseOnFailure: true, vehicleRequestId }, db)
    : ({ ok: false, reason: "NO_APPLICATION", message: "No buyer on this request." } as const);
  items.push({
    key: "APPROVAL_ATTACHED",
    label: "Prequalification and approved ceiling attached",
    // §Stage 7 requires the CEILING as well as the approval, and a valid approval with a null
    // ceiling would pass the helper's predicate while leaving offer validation nothing to
    // enforce against.
    passed: approval.ok && approval.approvedAmountCents !== null,
    blocker: approval.ok
      ? approval.approvedAmountCents === null
        ? "The prequalification is valid but carries no approved ceiling."
        : null
      : approval.reason === "EXPIRED"
        ? "The prequalification has expired and needs renewal."
        : approval.reason === "NO_APPLICATION"
          ? "No prequalification is on file for this buyer."
          : "The prequalification is not approved.",
    owner: approval.ok || approval.reason === "EXPIRED" ? "BUYER" : "COMPLIANCE",
  });

  // ── 3. "vehicle criteria are complete" ──
  const req = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { makePreference: true, modelPreference: true, yearMin: true, yearMax: true, buyerId: true },
  });
  const criteriaOk = !!req && !!req.makePreference && (req.yearMin !== null || req.yearMax !== null);
  items.push({
    key: "CRITERIA_COMPLETE",
    label: "Vehicle criteria complete",
    passed: criteriaOk,
    blocker: criteriaOk
      ? null
      : !req
        ? "The vehicle request no longer exists."
        : !req.makePreference
          ? "No make recorded on the request."
          : "No year range recorded on the request.",
    owner: "BUYER",
  });

  // ── 4. "the required dealer count or an approved exception exists" ──
  //
  // §6c's outcome, not a re-count. The case status IS the decision, and a limited auction is
  // the "approved exception" — which is why a LIMITED_PENDING_APPROVAL case fails this item
  // and a limited case that has been approved passes it.
  const fieldCount = sourcingCase.coverageCount;
  const limitedApproved = sourcingCase.limitedAuctionApprovedAt !== null;
  const countOk =
    sourcingCase.status === SOURCING_CASE_STATUS.READY_TO_LAUNCH &&
    (fieldCount >= MIN_AUTO_LAUNCH_FIELD ||
      (limitedApproved && fieldCount >= MIN_LIMITED_AUCTION_FIELD));
  items.push({
    key: "DEALER_COUNT",
    label: "Required dealer count, or an audited limited-auction approval",
    passed: countOk,
    blocker: countOk
      ? null
      : sourcingCase.status === SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL
        ? `${fieldCount} invitation-ready rooftops — a limited auction needs audited Operations approval before it can launch.`
        : fieldCount < MIN_LIMITED_AUCTION_FIELD
          ? `${fieldCount} invitation-ready rooftops; the minimum field is ${MIN_LIMITED_AUCTION_FIELD} with approval, ${MIN_AUTO_LAUNCH_FIELD} without.`
          : `Sourcing case is ${sourcingCase.status}, not ready to launch.`,
    owner: "OPERATIONS",
  });

  // ── 5 and 6. "every contact is send-safe" and "every rooftop is within the permitted
  // distance", re-checked at LAUNCH rather than trusted from validation time ──
  //
  // Time has passed since §6b ran. A contact can be suppressed between sourcing and launch —
  // including by the dealership's own one-click unsubscribe — and the buyer can have narrowed
  // their authorised radius. §7 lists both as entry items precisely because they are not the
  // same question as §6b's.
  const field = await buildFieldFromCase(sourcingCase, db);
  const sendSafety = await recheckSendSafety(field);
  items.push({
    key: "CONTACTS_SEND_SAFE",
    label: "Every contact send-safe against suppression and opt-out",
    passed: sendSafety.unsafe.length === 0 && field.length > 0,
    blocker:
      field.length === 0
        ? "No invitation-ready rooftop carries a contact."
        : sendSafety.unsafe.length > 0
          ? `${sendSafety.unsafe.length} contact(s) are suppressed or opted out: ${sendSafety.unsafe.join(", ")}`
          : null,
    owner: "OPERATIONS",
  });

  const permitted = sourcingCase.authorizedRadiusMiles ?? Number(sourcingCase.band === "AUTHORIZED" ? 0 : sourcingCase.band);
  const outOfRange = field.filter(
    (t) => t.distanceMiles !== null && permitted > 0 && t.distanceMiles > permitted,
  );
  items.push({
    key: "ROOFTOPS_IN_DISTANCE",
    label: "Every rooftop within the permitted distance",
    passed: outOfRange.length === 0,
    blocker:
      outOfRange.length > 0
        ? `${outOfRange.length} rooftop(s) sit beyond the permitted ${permitted} miles.`
        : null,
    owner: "SYSTEM",
  });

  // ── 7. the named, ordered readiness checkpoints (S6-29b) ──
  //
  // §6c "Recorded": "`vehicle_request_due_diligence_checkpoints` carries the named, ordered
  // readiness checkpoints with completion owner and timestamp [BUILT]". Phase 3 seeds them
  // with the case; this is the read that makes them mean something.
  const checkpoints = await db.vehicleRequestDueDiligenceCheckpoint.findMany({
    where: { requestId: vehicleRequestId },
    select: { name: true, completed: true, order: true },
    orderBy: { order: "asc" },
  });
  const incomplete = checkpoints.filter((c) => !c.completed);
  items.push({
    key: "DUE_DILIGENCE_CHECKPOINTS",
    label: "Due-diligence checkpoints complete",
    passed: checkpoints.length > 0 && incomplete.length === 0,
    blocker:
      checkpoints.length === 0
        ? "No due-diligence checkpoints were seeded for this request."
        : incomplete.length > 0
          ? `${incomplete.length} checkpoint(s) outstanding: ${incomplete.map((c) => c.name).join("; ")}`
          : null,
    owner: "OPERATIONS",
  });

  // ── 8. "the auction and per-dealer invitation references exist" ──
  //
  // Evaluated as "CAN exist", because this runs BEFORE the auction is created. The references
  // are created by `launchFromCase` in the order S7-07 requires, and this item is what
  // refuses to start that sequence with nothing to invite.
  const referencesOk = field.length > 0 && field.length <= MAX_INVITATION_FIELD;
  items.push({
    key: "REFERENCES_EXIST",
    label: "Auction and per-rooftop invitation references can be created",
    passed: referencesOk,
    blocker: referencesOk
      ? null
      : field.length === 0
        ? "There is no rooftop to invite, so no invitation reference can exist."
        : `The field holds ${field.length} rooftops; the cap is ${MAX_INVITATION_FIELD}.`,
    owner: "SYSTEM",
  });

  const blockers = items.filter((i) => !i.passed).map((i) => i.blocker ?? i.label);
  return { ready: blockers.length === 0, items, field, blockers };
}

async function requestBuyerId(vehicleRequestId: string, db: Db): Promise<string | null> {
  const r = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { buyerId: true },
  });
  return r?.buyerId ?? null;
}

/**
 * The invitation field, read from the `sourcing_candidates` rows §6b validated.
 *
 * Ranked and capped the same way §6c decided, by reading the recorded validation rather than
 * re-deciding it — so the field that launches is the field the case recorded, and an operator
 * reviewing a limited auction sees the same eight rooftops the launch will use.
 */
async function buildFieldFromCase(
  sourcingCase: SourcingCaseRecord,
  db: Db,
): Promise<InvitationTarget[]> {
  const rows = await db.sourcingCandidate.findMany({
    where: { sourcingCaseId: sourcingCase.id, excludedReason: null, rooftopId: { not: null } },
    select: {
      rooftopId: true,
      distanceMiles: true,
      servedCandidateIds: true,
      validation: true,
      rooftop: {
        select: {
          displayName: true,
          dealers: {
            where: { isSystemPlaceholder: false },
            select: { id: true, dealershipName: true, user: { select: { email: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const targets: InvitationTarget[] = [];
  for (const r of rows) {
    const v = (r.validation ?? {}) as { contactEmail?: string | null; contactName?: string | null; invitationReady?: boolean };
    if (v.invitationReady !== true) continue;
    const email = v.contactEmail;
    if (!email) continue;
    const dealer = r.rooftop?.dealers?.[0] ?? null;
    targets.push({
      rooftopId: r.rooftopId!,
      dealerId: dealer?.id ?? null,
      dealershipName: dealer?.dealershipName ?? r.rooftop?.displayName ?? "Dealership",
      contactName: v.contactName ?? null,
      email,
      phone: null,
      distanceMiles: r.distanceMiles,
      candidateIds: r.servedCandidateIds ?? [],
      invitationScore: null,
    });
  }

  // Deterministic, and the same key `rankRooftops` uses: nearer first, then rooftop id. The
  // score is not re-read here because `sourcing_candidates` does not store it; `issueInvitations`
  // re-sorts on the same total key, so the cap cuts identically either way.
  targets.sort((a, b) => {
    const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const dbb = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (da !== dbb) return da - dbb;
    return a.rooftopId < b.rooftopId ? -1 : a.rooftopId > b.rooftopId ? 1 : 0;
  });
  return targets.slice(0, MAX_INVITATION_FIELD);
}

/**
 * S7-05 — re-check suppression and opt-out for every contact, at launch.
 *
 * USES THE FULL STORE, not the hard tier, for the same reason the send path now does: a
 * dealership that unsubscribed has opted out, and §7 says "send-safe against suppression AND
 * OPT-OUT lists". Checking the hard tier here and the full tier at send would reproduce
 * defect 1 one layer up — readiness would pass a contact the dispatcher then refuses, and the
 * auction would launch with a field smaller than it believed.
 *
 * FAILS CLOSED. `isEmailSuppressed` returns true on a lookup error by design, so an outage
 * holds the auction rather than launching it on contacts we could not verify.
 */
async function recheckSendSafety(
  field: InvitationTarget[],
): Promise<{ unsafe: string[] }> {
  if (field.length === 0) return { unsafe: [] };
  const { getServiceSupabase } = await import("@/lib/supabase-service");
  const { SuppressionService } = await import("@/lib/services/suppression.service");
  const supabase = getServiceSupabase();
  const unsafe: string[] = [];
  for (const t of field) {
    try {
      if (await SuppressionService.isEmailSuppressed(supabase, t.email)) unsafe.push(t.dealershipName);
    } catch (err) {
      logger.warn(`[readiness] suppression lookup failed for ${t.dealershipName}:`, err);
      unsafe.push(t.dealershipName);
    }
  }
  return { unsafe };
}

// ───────────────────────────────────────────────────────────────────────────────
// The launch itself — PENDING, invite, then ACTIVE
// ───────────────────────────────────────────────────────────────────────────────

export interface LaunchResult {
  launched: boolean;
  auctionId: string | null;
  invitationsIssued: number;
  blockers: string[];
}

/**
 * Create the auction and launch it, or hold and record why.
 *
 * S7-07, S7-08, S7-17, S7-22 together. The ordering is the requirement: "Create
 * `auction_invitations` (QUEUED) while PENDING; flip ACTIVE + `endsAt` in one txn only when
 * >=1 invitation row exists."
 */
export async function launchFromCase(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  db: PrismaClient = defaultPrisma as PrismaClient,
  now: Date = new Date(),
): Promise<LaunchResult> {
  const readiness = await evaluateReadiness(vehicleRequestId, sourcingCase, db, now);
  if (!readiness.ready) {
    await holdWithBlockers(vehicleRequestId, sourcingCase, readiness, db);
    return { launched: false, auctionId: null, invitationsIssued: 0, blockers: readiness.blockers };
  }

  const deposit = await settledDepositForRequest(vehicleRequestId);
  if (!deposit) {
    // Re-checked because readiness ran before this point and the gate is the money.
    return { launched: false, auctionId: null, invitationsIssued: 0, blockers: ["Deposit no longer settled."] };
  }

  const request = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { buyerId: true },
  });
  if (!request) {
    return { launched: false, auctionId: null, invitationsIssued: 0, blockers: ["Request no longer exists."] };
  }

  // ── step 1: the auction, PENDING, with BOTH references (S7-17) ──
  //
  // `Auction.depositId` is `@unique`, so a redelivered launch cannot create a second auction
  // for the same deposit — the constraint is the idempotency, not a check.
  let auctionId: string;
  const existing = await db.auction.findFirst({
    where: { depositId: deposit.id },
    select: { id: true, status: true },
  });
  if (existing) {
    if (existing.status === "ACTIVE" || existing.status === "CLOSED") {
      logger.info(`[readiness] auction ${existing.id} already ${existing.status} for deposit ${deposit.id}`);
      return { launched: false, auctionId: existing.id, invitationsIssued: 0, blockers: [] };
    }
    auctionId = existing.id;
  } else {
    const created = await db.auction.create({
      data: {
        buyerId: request.buyerId,
        depositId: deposit.id,
        vehicleRequestId,
        sourcingCaseId: sourcingCase.id,
        status: "PENDING",
      },
      select: { id: true },
    });
    auctionId = created.id;
  }

  // ── step 1b: materialise the candidates Phase 4 built and left unwired ──
  //
  // `promoteShortlistToCandidates` has had no production caller since Phase 4 wrote it, for a
  // stated reason: `auction_vehicles.auction_id` is NOT NULL, so candidate rows cannot exist
  // before an auction does, and Phase 4's own note hands the wiring to "Phase 5, at the point
  // the auction exists". This is that point.
  try {
    const { promoteShortlistToCandidates } = await import("@/lib/services/shortlist/candidate.service");
    const promotion = await promoteShortlistToCandidates(request.buyerId, { auctionId, vehicleRequestId }, now);
    logger.info(
      `[readiness] candidates materialised for auction ${auctionId}: ` +
        `${promotion.created.length} created, ${promotion.existing} existing, ${promotion.skipped.length} skipped`,
    );
  } catch (err) {
    // A candidate row is not a precondition of inviting a dealership — the invitation carries
    // the criteria and the served candidate ids either way — so this is logged rather than
    // fatal. Phase 6 binds offers to candidates and will surface a missing one.
    logger.warn(`[readiness] candidate promotion failed for auction ${auctionId}:`, err);
  }

  // ── step 2: invitations, QUEUED, against a PENDING auction ──
  const issued = await issueInvitations(auctionId, readiness.field, db, now);

  // ── step 3: ACTIVE, in one transaction, ONLY with a real invitation row ──
  //
  // The count is re-read inside the transaction rather than taken from `issued`, because an
  // invitation can have been written by a concurrent run and because a write that reported
  // success is still not a row until it is read back. §Stage 7's "The auction never launches
  // half-ready" is this line.
  const endsAt = new Date(now.getTime() + AUCTION_DURATION_HOURS * 3_600_000);
  const activated = await db.$transaction(async (tx) => {
    const live = await tx.auctionInvitation.count({
      where: { auctionId, status: { notIn: ["REPLACED", "EXPIRED", "BOUNCED"] } },
    });
    if (live === 0) return { ok: false as const, live };
    const flipped = await tx.auction.updateMany({
      where: { id: auctionId, status: "PENDING" },
      data: { status: "ACTIVE", startedAt: now, endsAt },
    });
    return { ok: flipped.count === 1, live };
  });

  if (!activated.ok) {
    const blocker =
      activated.live === 0
        ? "No invitation row exists, so the auction stays PENDING rather than launching with nobody invited."
        : "The auction was no longer PENDING when the activation ran.";
    await holdWithBlockers(vehicleRequestId, sourcingCase, { ...readiness, blockers: [blocker] }, db);
    return { launched: false, auctionId, invitationsIssued: issued.issued, blockers: [blocker] };
  }

  await transitionCase(
    {
      caseId: sourcingCase.id,
      to: SOURCING_CASE_STATUS.LAUNCHED,
      reason: `launched auction ${auctionId} with ${issued.issued} invitation(s)`,
      coverageCount: issued.issued,
    },
    db,
  );

  logger.info(`[readiness] auction ${auctionId} ACTIVE with ${issued.issued} invitation(s), closes ${endsAt.toISOString()}`);
  return { launched: true, auctionId, invitationsIssued: issued.issued, blockers: [] };
}

/**
 * S7-22 / §Stage 7 "A launch that cannot reach readiness holds and surfaces the blocker with
 * an owner."
 *
 * ONE exception per (request, blocker set) rather than one per attempt. The readiness check
 * runs on every reconciler tick, and a new queue item every tick would bury the queue it is
 * meant to populate — so the idempotency key carries the blocker keys, and a DIFFERENT
 * blocker legitimately raises a new row because it needs a different action.
 */
async function holdWithBlockers(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  readiness: ReadinessResult,
  db: Db,
): Promise<void> {
  const failedKeys = readiness.items.filter((i) => !i.passed).map((i) => i.key).sort();
  const owner = readiness.items.find((i) => !i.passed)?.owner ?? "OPERATIONS";
  logger.info(
    `[readiness] ${vehicleRequestId} holding: ${readiness.blockers.join(" | ")}`,
  );
  try {
    await raiseException(
      {
        code: "LAUNCH_READINESS_BLOCKED",
        vehicleRequestId,
        idempotencyKey: `LAUNCH_READINESS_BLOCKED:${sourcingCase.id}:${failedKeys.join("+")}`,
        detail: readiness.blockers.join(" | "),
        ownerRole: owner === "BUYER" ? "BUYER" : owner === "COMPLIANCE" ? "COMPLIANCE" : "OPERATIONS",
      },
      db,
    );
  } catch (err) {
    // The hold itself is the safety property — the auction does not launch either way — so a
    // queue write failure is logged and does not turn a held launch into a launched one.
    logger.warn(`[readiness] could not raise the readiness hold for ${vehicleRequestId}:`, err);
  }
}
