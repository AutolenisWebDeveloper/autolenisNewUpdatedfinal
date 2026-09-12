// lib/services/sourcing/sourcing-driver.service.ts
//
// Stage 6 → Stage 7 — the thing that ACTS on a §6c outcome.
//
// `rooftop-sourcing.service.ts` decides: it runs one band of the ladder, validates rooftops
// against §6b and returns the §6c outcome. This module is what the decision causes —
// transitions, exceptions, buyer notices, the next band, and the hand-off to launch readiness.
//
// THE SPLIT IS DELIBERATE AND IT IS NOT COSMETIC. The decision is the part worth testing
// exhaustively (five outcomes × band × authorisation × channel), and it is testable without
// mocking the dispatcher or the queue writer only because it does not touch them. Everything
// with a side effect lives here, behind one entry point the reconciler calls.
//
// EVERY COMMUNICATION THROUGH THE DISPATCHER, EVERY EXCEPTION THROUGH THE QUEUE WRITER. The
// Phase 2–4 carry-forward rule, and two build-failing rules enforce it:
// `no-direct-transactional-send.test.ts` fails on a new Resend or Twilio reach, and
// `no-second-exception-writer.test.ts` fails on a second `queueItem` mutator.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { enqueueTransactional, cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_5_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import {
  renderRadiusAuthorizationNeeded,
  renderSourcingCompleted,
  renderSourcingLimitedField,
  renderSourcingNoCoverage,
  renderAuctionLaunched,
} from "@/lib/services/comms/phase5-email-content";
import {
  SOURCING_CASE_STATUS,
  SOURCING_BAND,
  BAND_OUTER_MILES,
  nextBand,
  transitionCase,
  getSourcingCase,
  effectiveRadiusMiles,
  type SourcingBand,
  type SourcingCaseRecord,
} from "./sourcing-case.service";
import { advanceSourcing, type SourcingOutcome } from "./rooftop-sourcing.service";
import { launchFromCase } from "./launch-readiness.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").replace(/\/+$/, "");

/** §Stage 6 "Remind at 24 and 72 hours. Close as abandoned after 14 days." */
export const RADIUS_REMINDER_HOURS = [24, 72] as const;
export const RADIUS_ABANDON_DAYS = 14;

/** One cancel key for every outstanding radius message on a case. */
function radiusCancelKey(caseId: string): string {
  return `radius-authorization:${caseId}`;
}

export interface DriveResult {
  vehicleRequestId: string;
  caseId: string | null;
  outcome: SourcingOutcome | "NOT_PAID" | "NO_CASE" | "NOT_PLACEABLE" | "TERMINAL" | "LAUNCHED" | "HELD";
  readyCount: number;
  callOnlyCount: number;
  poolCeiling: number;
  band: SourcingBand | null;
  blockers: string[];
}

/**
 * Drive one request's sourcing forward by one step.
 *
 * IDEMPOTENT AND SAFE TO TICK. Every write below is either a compare-and-set transition, a
 * keyed exception, or a keyed outbox row, so running this every few minutes against the same
 * case converges rather than accumulating.
 */
export async function driveSourcing(
  vehicleRequestId: string,
  db: PrismaClient = defaultPrisma as PrismaClient,
  now: Date = new Date(),
): Promise<DriveResult> {
  const base: DriveResult = {
    vehicleRequestId,
    caseId: null,
    outcome: "NO_CASE",
    readyCount: 0,
    callOnlyCount: 0,
    poolCeiling: 0,
    band: null,
    blockers: [],
  };

  const sourcingCase = await getSourcingCase(vehicleRequestId, db);
  if (!sourcingCase) return base;
  base.caseId = sourcingCase.id;
  base.band = sourcingCase.band;

  // ── the 14-day abandonment, checked before anything else ──
  //
  // §Stage 6: "Close as abandoned after 14 days, preserving history." Checked first so an
  // abandoned case is not sourced for another band on its way out.
  if (sourcingCase.status === SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED) {
    const closed = await closeIfAbandoned(sourcingCase, db, now);
    if (closed) return { ...base, outcome: "TERMINAL" };
    // Still waiting on the buyer. Nothing to source — the ladder is at its ceiling by
    // definition — so the reminders are the only work.
    await enqueueRadiusReminders(vehicleRequestId, sourcingCase, db, now);
    return { ...base, outcome: "ZERO_COVERAGE_REVIEW" };
  }

  // A case already holding for a human decision is not advanced automatically. §6c's 3–4 and
  // 1–2 rows are Operations decisions, and re-running the ladder under them would churn the
  // queue without changing the answer.
  if (
    sourcingCase.status === SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL ||
    sourcingCase.status === SOURCING_CASE_STATUS.THIN_COVERAGE_REVIEW ||
    sourcingCase.status === SOURCING_CASE_STATUS.ZERO_COVERAGE_REVIEW
  ) {
    return { ...base, outcome: "TERMINAL", readyCount: sourcingCase.coverageCount };
  }

  // A case that has already assembled its field goes straight to readiness.
  if (sourcingCase.status === SOURCING_CASE_STATUS.READY_TO_LAUNCH) {
    return launchAndReport(vehicleRequestId, sourcingCase, base, db, now);
  }

  if (sourcingCase.status !== SOURCING_CASE_STATUS.ACTIVE_SOURCING) {
    return { ...base, outcome: "TERMINAL" };
  }

  // ── run one band ──
  // No clock is injected: nothing in one band's scan is time-dependent. The clock that
  // matters — the one the transitions, reminders and the 14-day close are stamped with — is
  // this function's `now`, threaded through the writers below.
  const step = await advanceSourcing(vehicleRequestId, sourcingCase, { prisma: db });
  const result: DriveResult = {
    ...base,
    outcome: step.outcome,
    readyCount: step.readyCount,
    callOnlyCount: step.callOnlyCount,
    poolCeiling: step.poolCeiling,
    band: step.band,
  };

  switch (step.outcome) {
    case "NOT_PAID":
    case "NO_CASE":
    case "TERMINAL":
      return result;

    case "NOT_PLACEABLE":
      // FAIL CLOSED, AND SAY SO. A buyer we cannot place cannot be sourced for, and the §7.1
      // incident at `buyer-location.service.ts:5-13` is what happens when this proceeds
      // anyway. It is an Operations task because the fix is a location correction, not a
      // wider radius.
      await raiseOnce(
        {
          code: "ZERO_DEALER_COVERAGE",
          vehicleRequestId,
          idempotencyKey: `ZERO_DEALER_COVERAGE:not-placeable:${sourcingCase.id}`,
          detail:
            "The buyer's location could not be placed, so no rooftop can be confirmed in range. " +
            "Sourcing is held rather than run without a radius.",
        },
        db,
      );
      return result;

    case "EXPAND": {
      // §6a: "Each expansion searches only the new band." The transition records the new band
      // and `bandExpandedAt`; the next tick searches the annulus.
      const next = nextBand(step.band);
      if (!next) return { ...result, outcome: "ZERO_COVERAGE_REVIEW" };
      await transitionCase(
        {
          caseId: sourcingCase.id,
          to: SOURCING_CASE_STATUS.ACTIVE_SOURCING,
          reason: `expanding ${step.band} -> ${next} (ready ${step.readyCount})`,
          band: next,
          bandExpandedAt: now,
          coverageCount: step.readyCount,
        },
        db,
      );
      return result;
    }

    case "AUTO_LAUNCH": {
      await transitionCase(
        {
          caseId: sourcingCase.id,
          to: SOURCING_CASE_STATUS.READY_TO_LAUNCH,
          reason: `§6c auto-launch with ${step.readyCount} invitation-ready rooftops`,
          coverageCount: step.readyCount,
        },
        db,
      );
      await enqueueBuyerNotice(
        vehicleRequestId,
        PHASE_5_TEMPLATES.SOURCING_COMPLETED,
        "sourcing.completed",
        (firstName) => renderSourcingCompleted({ firstName, readyCount: step.readyCount, dashboardUrl: `${APP_URL}/buyer/dashboard` }),
        db,
      );
      const fresh = await getSourcingCase(vehicleRequestId, db);
      if (!fresh) return result;
      return launchAndReport(vehicleRequestId, fresh, result, db, now);
    }

    case "LIMITED_PENDING_APPROVAL":
      // §6c: a limited auction needs "a completely searched permitted radius, documented
      // scarcity or urgency, disclosure of the field size to the buyer, and an audited
      // approval". The ladder being exhausted is the first; this transition records the
      // second; the buyer notice is the third; and the admin action is the fourth, which is
      // why the case HOLDS here rather than launching.
      await transitionCase(
        {
          caseId: sourcingCase.id,
          to: SOURCING_CASE_STATUS.LIMITED_PENDING_APPROVAL,
          reason:
            `§6c limited auction: ${step.readyCount} invitation-ready rooftops after the full ` +
            `permitted radius (pool ceiling ${step.poolCeiling}, ${step.callOnlyCount} reachable by phone only)`,
          coverageCount: step.readyCount,
        },
        db,
      );
      await raiseOnce(
        {
          code: "THIN_DEALER_COVERAGE",
          vehicleRequestId,
          idempotencyKey: `THIN_DEALER_COVERAGE:limited:${sourcingCase.id}`,
          detail:
            `${step.readyCount} invitation-ready rooftops. A limited auction needs audited ` +
            `Operations approval; the buyer has been told the field size. ` +
            `${step.callOnlyCount} further rooftop(s) are reachable by phone only.`,
        },
        db,
      );
      await enqueueBuyerNotice(
        vehicleRequestId,
        PHASE_5_TEMPLATES.SOURCING_LIMITED_FIELD,
        "sourcing.limited_field",
        (firstName) =>
          renderSourcingLimitedField({
            firstName,
            readyCount: step.readyCount,
            searchedMiles: searchedMiles(sourcingCase),
            dashboardUrl: `${APP_URL}/buyer/dashboard`,
          }),
        db,
      );
      await raiseCallOnlyTask(vehicleRequestId, sourcingCase, step.callOnlyCount, db);
      return result;

    case "THIN_COVERAGE_REVIEW":
      await transitionCase(
        {
          caseId: sourcingCase.id,
          to: SOURCING_CASE_STATUS.THIN_COVERAGE_REVIEW,
          reason: `§6c 1–2 rooftops after the full permitted radius (pool ceiling ${step.poolCeiling})`,
          coverageCount: step.readyCount,
        },
        db,
      );
      await raiseOnce(
        {
          code: "THIN_DEALER_COVERAGE",
          vehicleRequestId,
          idempotencyKey: `THIN_DEALER_COVERAGE:${sourcingCase.id}`,
          detail:
            `${step.readyCount} invitation-ready rooftop(s) inside ${searchedMiles(sourcingCase)} miles. ` +
            `${step.poolCeiling} rooftop(s) exist in range before validation and ${step.callOnlyCount} are ` +
            `reachable by phone only — so this is a VALIDATION or CONTACT shortfall, not necessarily a thin market.`,
        },
        db,
      );
      await raiseCallOnlyTask(vehicleRequestId, sourcingCase, step.callOnlyCount, db);
      return result;

    case "ZERO_COVERAGE_REVIEW": {
      // §Stage 6's failure clause splits on WHERE the ladder stopped. At the 250-mile ceiling
      // with no buyer authorisation, the answer is to ask the buyer (§26 "No dealer coverage
      // at 250 miles"). Anywhere else — or after an authorisation that still found nothing —
      // it is Operations' zero-coverage review.
      const atCeiling =
        sourcingCase.band === SOURCING_BAND.B250 && sourcingCase.authorizedRadiusMiles === null;
      if (atCeiling) {
        const moved = await transitionCase(
          {
            caseId: sourcingCase.id,
            to: SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED,
            reason: `§Stage 6: 250 miles searched with ${step.readyCount} invitation-ready rooftops`,
            coverageCount: step.readyCount,
            authorizationRequestedAt: now,
          },
          db,
        );
        if (moved.ok) {
          // The request's own status mirrors the case, which is what finally makes
          // `VehicleRequestStatus.RADIUS_AUTHORIZATION_REQUIRED` reachable — it has been in
          // the enum since Phase 1 with nothing writing it.
          await db.vehicleRequest.updateMany({
            where: { id: vehicleRequestId, status: "ACTIVE_SOURCING" },
            data: { status: "RADIUS_AUTHORIZATION_REQUIRED" },
          });
          await raiseOnce(
            {
              code: "NO_DEALER_COVERAGE_AT_MAX_RADIUS",
              vehicleRequestId,
              idempotencyKey: `NO_DEALER_COVERAGE_AT_MAX_RADIUS:${sourcingCase.id}`,
              detail: `${step.readyCount} invitation-ready rooftops at 250 miles; awaiting a buyer maximum.`,
            },
            db,
          );
          await enqueueRadiusAsk(vehicleRequestId, sourcingCase, step.readyCount, "initial", db, now);
          await enqueueRadiusReminders(vehicleRequestId, sourcingCase, db, now);
        }
        return result;
      }

      await transitionCase(
        {
          caseId: sourcingCase.id,
          to: SOURCING_CASE_STATUS.ZERO_COVERAGE_REVIEW,
          reason: `§6c zero coverage after ${searchedMiles(sourcingCase)} miles (pool ceiling ${step.poolCeiling})`,
          coverageCount: 0,
        },
        db,
      );
      await raiseOnce(
        {
          code: "ZERO_DEALER_COVERAGE",
          vehicleRequestId,
          idempotencyKey: `ZERO_DEALER_COVERAGE:${sourcingCase.id}`,
          detail:
            `No invitation-ready rooftop inside ${searchedMiles(sourcingCase)} miles. ` +
            `${step.poolCeiling} rooftop(s) exist in range before validation; ${step.callOnlyCount} are ` +
            `reachable by phone only. Closure and refund are separate decisions (§22.1).`,
        },
        db,
      );
      await enqueueBuyerNotice(
        vehicleRequestId,
        PHASE_5_TEMPLATES.SOURCING_NO_COVERAGE,
        "sourcing.no_coverage",
        (firstName) =>
          renderSourcingNoCoverage({
            firstName,
            searchedMiles: searchedMiles(sourcingCase),
            dashboardUrl: `${APP_URL}/buyer/dashboard`,
          }),
        db,
      );
      await raiseCallOnlyTask(vehicleRequestId, sourcingCase, step.callOnlyCount, db);
      return result;
    }
  }
}

/** How far this case has actually searched, for copy and for exception detail. */
function searchedMiles(c: SourcingCaseRecord): number {
  return effectiveRadiusMiles(c.band, c.authorizedRadiusMiles) ?? BAND_OUTER_MILES[c.band] ?? 250;
}

async function launchAndReport(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  base: DriveResult,
  db: PrismaClient,
  now: Date,
): Promise<DriveResult> {
  const launch = await launchFromCase(vehicleRequestId, sourcingCase, db, now);
  if (!launch.launched) {
    return { ...base, outcome: "HELD", blockers: launch.blockers };
  }
  const auction = await db.auction.findUnique({
    where: { id: launch.auctionId! },
    select: { endsAt: true },
  });
  await enqueueBuyerNotice(
    vehicleRequestId,
    PHASE_5_TEMPLATES.AUCTION_LAUNCHED,
    "auction.launched",
    (firstName) =>
      renderAuctionLaunched({
        firstName,
        dealershipsInvited: launch.invitationsIssued,
        closesAt: auction?.endsAt ?? now,
        dashboardUrl: `${APP_URL}/buyer/dashboard`,
      }),
    db,
    launch.auctionId,
  );
  return { ...base, outcome: "LAUNCHED", readyCount: launch.invitationsIssued };
}

/**
 * The CALL_ONLY task — §6c's "source manually", and the reason an email-only rail is honest
 * rather than a silent skip.
 *
 * A rooftop with a usable phone and no send-safe email is not invitation-ready for the
 * automated rail (SMS is out of scope this phase — see `validateRooftop`'s channel note), and
 * it is not nothing either. It becomes an Operations task so the market that exists but cannot
 * be emailed is visible, and so "invitations sent" can never be read as "the market was
 * reached".
 */
async function raiseCallOnlyTask(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  callOnlyCount: number,
  db: PrismaClient,
): Promise<void> {
  if (callOnlyCount <= 0) return;
  await raiseOnce(
    {
      code: "THIN_DEALER_COVERAGE",
      vehicleRequestId,
      idempotencyKey: `THIN_DEALER_COVERAGE:call-only:${sourcingCase.id}`,
      detail:
        `${callOnlyCount} rooftop(s) in range carry a usable phone number and NO send-safe email, so the ` +
        `automated invitation rail cannot reach them. They are invitable by phone. Dealer SMS is not in ` +
        `scope: the shared consent gate refuses it while \`consent_basis\` is unset, and \`dnc_status\` is ` +
        `unpopulated.`,
    },
    db,
  );
}

/** §26 exceptions, raised once per condition per case. A raise failure never changes a decision. */
async function raiseOnce(
  input: Parameters<typeof raiseException>[0],
  db: PrismaClient,
): Promise<void> {
  try {
    await raiseException(input, db);
  } catch (err) {
    logger.warn(`[sourcing-driver] could not raise ${input.code} for ${input.vehicleRequestId}:`, err);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// The radius-authorisation ask, its reminders, and the 14-day close
// ───────────────────────────────────────────────────────────────────────────────

async function buyerContact(
  vehicleRequestId: string,
  db: PrismaClient,
): Promise<{ buyerId: string; email: string; firstName: string | null } | null> {
  const r = await db.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { buyerId: true, buyer: { select: { firstName: true, user: { select: { email: true } } } } },
  });
  const email = r?.buyer?.user?.email;
  if (!r || !email) return null;
  return { buyerId: r.buyerId, email, firstName: r.buyer?.firstName ?? null };
}

/** One buyer notice, through the dispatcher, with a channel-qualified key. */
async function enqueueBuyerNotice(
  vehicleRequestId: string,
  templateKey: string,
  triggerEvent: string,
  render: (firstName: string | null) => { subject: string; html: string; text: string },
  db: PrismaClient,
  auctionId: string | null = null,
): Promise<void> {
  const contact = await buyerContact(vehicleRequestId, db);
  if (!contact) {
    logger.warn(`[sourcing-driver] no buyer address for ${vehicleRequestId} — ${templateKey} not enqueued`);
    return;
  }
  const rendered = render(contact.firstName);
  // CHANNEL-QUALIFIED. The dispatcher's derived default key carries no channel and
  // `comms_outbox.dedup_key` is globally unique, so a derived key would silently collide with
  // any future SMS of the same template and return `enqueued:false` — indistinguishable from a
  // legitimate duplicate.
  const key = `${templateKey}:email:${vehicleRequestId}`;
  try {
    await enqueueTransactional(
      {
        triggerEvent,
        templateKey,
        channel: "email",
        recipientKind: "buyer",
        recipientId: contact.buyerId,
        to: contact.email,
        vehicleRequestId,
        auctionId,
        idempotencyKey: key,
        payload: {
          email: contact.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          // A BUYER's transactional mail keeps the HARD tier, deliberately. §27's rule is that
          // someone who unsubscribed from marketing still receives their own deal emails. The
          // `full` tier is the DEALER rail's, for the reason on `EmailOutboxPayload`.
          type: "transactional",
          idempotencyKey: key,
        },
      },
      db,
    );
  } catch (err) {
    logger.warn(`[sourcing-driver] could not enqueue ${templateKey} for ${vehicleRequestId}:`, err);
  }
}

async function enqueueRadiusAsk(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  readyCount: number,
  touch: "initial" | "24h" | "72h",
  db: PrismaClient,
  now: Date,
  runAt?: Date,
): Promise<void> {
  const contact = await buyerContact(vehicleRequestId, db);
  if (!contact) return;
  const templateKey =
    touch === "initial"
      ? PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_NEEDED
      : touch === "24h"
        ? PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_REMINDER_24H
        : PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_REMINDER_72H;
  const rendered = renderRadiusAuthorizationNeeded({
    firstName: contact.firstName,
    searchedMiles: searchedMiles(sourcingCase),
    readyCount,
    authorizeUrl: `${APP_URL}/buyer/requests/${vehicleRequestId}/radius`,
    touch,
  });
  const key = `${templateKey}:email:${vehicleRequestId}`;
  try {
    await enqueueTransactional(
      {
        triggerEvent: `sourcing.radius_authorization.${touch}`,
        templateKey,
        channel: "email",
        recipientKind: "buyer",
        recipientId: contact.buyerId,
        to: contact.email,
        vehicleRequestId,
        idempotencyKey: key,
        runAt,
        // §27's cancellation rule. One key for the ask and both reminders, so recording an
        // authorisation cancels everything still pending in one call — which is what stops a
        // buyer who answered from being chased twice more.
        cancelKey: radiusCancelKey(sourcingCase.id),
        payload: {
          email: contact.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          type: "transactional",
          idempotencyKey: key,
        },
      },
      db,
    );
  } catch (err) {
    logger.warn(`[sourcing-driver] could not enqueue ${templateKey} for ${vehicleRequestId}:`, err);
  }
}

/**
 * §Stage 6 "Remind at 24 and 72 hours."
 *
 * SCHEDULED, NOT SWEPT. Both reminders are enqueued once with `runAt`, so the outbox is the
 * clock. A sweep that re-evaluated "is it 24 hours yet" on every tick is how the three dealer
 * reminder rails came to disagree with each other; the dispatcher already owns scheduling,
 * retry and cancellation, so using it means there is nothing to disagree with.
 */
async function enqueueRadiusReminders(
  vehicleRequestId: string,
  sourcingCase: SourcingCaseRecord,
  db: PrismaClient,
  now: Date,
): Promise<void> {
  const from = sourcingCase.authorizationRequestedAt ?? now;
  for (const hours of RADIUS_REMINDER_HOURS) {
    const runAt = new Date(from.getTime() + hours * 3_600_000);
    if (runAt.getTime() <= now.getTime()) continue; // already past; the ask itself covered it
    await enqueueRadiusAsk(
      vehicleRequestId,
      sourcingCase,
      sourcingCase.coverageCount,
      hours === 24 ? "24h" : "72h",
      db,
      now,
      runAt,
    );
  }
}

/**
 * §Stage 6: "Close as abandoned after 14 days, preserving history."
 *
 * PRESERVING HISTORY IS THE POINT. The case is CLOSED with a reason and a timestamp; no
 * `sourcing_candidates` row, no validation outcome and no enrichment-spend link is deleted.
 * A buyer who comes back is entitled to see what was searched on their behalf, and §22.1 keeps
 * the refund a separate manual decision — so this closes the SOURCING, not the money.
 */
export async function closeIfAbandoned(
  sourcingCase: SourcingCaseRecord,
  db: PrismaClient,
  now: Date,
): Promise<boolean> {
  const from = sourcingCase.authorizationRequestedAt;
  if (!from) return false;
  const deadline = new Date(from.getTime() + RADIUS_ABANDON_DAYS * 86_400_000);
  if (now.getTime() < deadline.getTime()) return false;

  const moved = await transitionCase(
    {
      caseId: sourcingCase.id,
      to: SOURCING_CASE_STATUS.CLOSED,
      reason: `ABANDONED_NO_RADIUS_AUTHORIZATION_${RADIUS_ABANDON_DAYS}D`,
      closedAt: now,
    },
    db,
  );
  if (!moved.ok) return false;

  await cancelByKey(radiusCancelKey(sourcingCase.id), "sourcing case abandoned", db);
  logger.info(
    `[sourcing-driver] case ${sourcingCase.id} closed as abandoned after ${RADIUS_ABANDON_DAYS} days; history preserved`,
  );
  return true;
}

/**
 * The buyer recorded a maximum additional distance. §6a step 5 and S6-08b.
 *
 * SERVER-SIDE POLICY, NOT A CLIENT PARAMETER (S6-11). The value is written to the case and to
 * the request, and the ladder reads it from there; no caller passes a radius into the search.
 * That is the whole point of §6a's "Radius is a server-side policy on the Vehicle Request,
 * never a client-controlled parameter" — the buyer authorises a CEILING, and the ladder
 * decides what to search.
 */
export async function recordRadiusAuthorization(
  vehicleRequestId: string,
  additionalMiles: number,
  db: PrismaClient = defaultPrisma as PrismaClient,
  now: Date = new Date(),
): Promise<{ ok: boolean; authorizedRadiusMiles?: number; reason?: string }> {
  const sourcingCase = await getSourcingCase(vehicleRequestId, db);
  if (!sourcingCase) return { ok: false, reason: "NO_CASE" };
  if (sourcingCase.status === SOURCING_CASE_STATUS.CLOSED) return { ok: false, reason: "CASE_CLOSED" };

  // The authorisation is "a maximum ADDITIONAL distance" (§Stage 6), measured from the
  // 250-mile ceiling the ladder already reached.
  const requested = 250 + Math.max(0, Math.floor(additionalMiles));

  // A LATER, SMALLER AUTHORISATION NEVER NARROWS AN EARLIER ONE.
  //
  // Not politeness — data integrity. By the time a second authorisation arrives the ladder may
  // already have validated and persisted `sourcing_candidates` rows out at the larger ceiling;
  // shrinking it would leave the case carrying rooftops outside its own permitted radius, which
  // is exactly what readiness item ROOFTOPS_IN_DISTANCE then blocks the launch on. A replay of
  // the same request, or a buyer who answers twice with different numbers, must not be able to
  // produce that state. The ceiling only ever widens. (ASSUMPTION, recorded: §6a specifies the
  // ceiling and "never exceeded", and is silent on narrowing. Narrowing, if it is ever wanted,
  // is an Operations action that can also clear the candidates it invalidates.)
  const authorized = Math.max(requested, sourcingCase.authorizedRadiusMiles ?? 0);

  // ── THE BAND MOVES ONLY WHEN THE LADDER HAS ACTUALLY REACHED THE CEILING ──
  //
  // This was unconditional, and it skipped bands. `BAND_INNER_MILES.AUTHORIZED` is 250, so a
  // case sitting at band 100 that was moved straight to AUTHORIZED searched only the 250→N
  // annulus on its next tick: every rooftop between 100 and 250 miles was never validated. A
  // buyer asking for MORE coverage got LESS — and the path was reachable, because nothing
  // required the case to be at its ceiling (the POST route checks ownership and bounds, and the
  // screen renders for any non-closed case).
  //
  // Recording the ceiling early is safe and is kept: `effectiveRadiusMiles` is
  // `min(bandOuter, authorized)`, so a 300-mile ceiling on band 100 still searches 100 and the
  // ladder walks 150 → 250 → AUTHORIZED normally, honouring the buyer's intent without skipping
  // anything. Only the BAND move is gated.
  const atCeiling =
    sourcingCase.band === SOURCING_BAND.B250 || sourcingCase.band === SOURCING_BAND.AUTHORIZED;

  const moved = await transitionCase(
    {
      caseId: sourcingCase.id,
      to: SOURCING_CASE_STATUS.ACTIVE_SOURCING,
      reason:
        `buyer authorised ${additionalMiles} additional miles (ceiling ${authorized})` +
        (atCeiling ? "" : `; band stays ${sourcingCase.band} — the ladder has not reached 250 yet`),
      ...(atCeiling ? { band: SOURCING_BAND.AUTHORIZED, bandExpandedAt: now } : {}),
      authorizedRadiusMiles: authorized,
    },
    db,
  );
  if (!moved.ok) return { ok: false, reason: moved.reason };

  await db.vehicleRequest.updateMany({
    where: { id: vehicleRequestId, status: "RADIUS_AUTHORIZATION_REQUIRED" },
    data: { status: "ACTIVE_SOURCING", authorizedMaxRadiusMiles: authorized },
  });

  // §27's cancellation rule: the buyer answered, so the outstanding ask and both reminders
  // stop. Without this the 24h and 72h rows would still deliver and chase an answer already
  // given.
  await cancelByKey(radiusCancelKey(sourcingCase.id), "buyer recorded a maximum distance", db);

  logger.info(
    `[sourcing-driver] ${vehicleRequestId}: radius authorised to ${authorized}mi; ` +
      (atCeiling
        ? "resuming at band AUTHORIZED"
        : `band stays ${sourcingCase.band} — the ladder walks up to the ceiling rather than jumping to it`),
  );
  return { ok: true, authorizedRadiusMiles: authorized };
}

// ───────────────────────────────────────────────────────────────────────────────
// The reconciler entry point
// ───────────────────────────────────────────────────────────────────────────────

export interface SourcingSweepResult {
  casesConsidered: number;
  outcomes: Record<string, number>;
  errors: string[];
}

/**
 * Drive every open sourcing case forward one step.
 *
 * ON THE EXISTING TICK, NOT A NEW CRON. S6-34b says to reuse `coverage-hold-reconcile`'s
 * tick, and it is the right one: it already runs every 15 minutes and already reconciles
 * request-level state, so the sourcing ladder advances on the same clock as the progression
 * and hold reconcilers rather than on a clock of its own that could drift from them.
 *
 * GATED ON THE FLIP, and that is the whole safety property of this phase. With
 * `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` off — the default, and §13-D52 is the owner's —
 * this sweep does NOTHING: the legacy webhook-and-reconciler path remains the only thing
 * that creates auctions and invites dealers. Running both would mean two auctions per
 * deposit, and `Auction.depositId` is `@unique`, so the second would fail noisily on a
 * buyer's paid request.
 *
 * BOUNDED PER RUN. A batch, ordered oldest-first, with the remainder picked up next tick —
 * the same shape every other reconciler here uses. One case failing never skips the rest:
 * each is isolated, because a single unplaceable buyer must not stall sourcing for everyone
 * else in the batch.
 */
export async function sweepSourcingCases(
  db: PrismaClient = defaultPrisma as PrismaClient,
  now: Date = new Date(),
  batchSize = 50,
): Promise<SourcingSweepResult> {
  const result: SourcingSweepResult = { casesConsidered: 0, outcomes: {}, errors: [] };

  const { sourcingCaseReplacesAuctionLaunch } = await import("@/lib/payments/settlement-flags");
  if (!sourcingCaseReplacesAuctionLaunch()) {
    // Not an error and not silent. An operator reading the cron log needs to see that the
    // sweep ran and deliberately did nothing, rather than wondering why no case moved.
    logger.info(
      "[sourcing-driver] SOURCING_CASE_REPLACES_AUCTION_LAUNCH is off — the legacy path still " +
        "creates and invites, so the sourcing ladder stands down (§13-D52 is the owner's)",
    );
    return { ...result, outcomes: { FLAG_OFF: 1 } };
  }

  const open = await db.sourcingCase.findMany({
    where: {
      status: {
        in: [
          SOURCING_CASE_STATUS.ACTIVE_SOURCING,
          SOURCING_CASE_STATUS.READY_TO_LAUNCH,
          SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED,
        ],
      },
    },
    select: { vehicleRequestId: true },
    orderBy: { openedAt: "asc" },
    take: batchSize,
  });
  result.casesConsidered = open.length;

  for (const c of open) {
    try {
      const step = await driveSourcing(c.vehicleRequestId, db, now);
      result.outcomes[step.outcome] = (result.outcomes[step.outcome] ?? 0) + 1;
    } catch (err) {
      result.errors.push(`${c.vehicleRequestId}: ${String(err)}`);
      logger.error(`[sourcing-driver] sweep failed for ${c.vehicleRequestId}:`, err);
    }
  }

  logger.info(
    `[sourcing-driver] sweep: ${result.casesConsidered} case(s), ` +
      `${Object.entries(result.outcomes).map(([k, v]) => `${k}=${v}`).join(" ")}` +
      (result.errors.length ? ` errors=${result.errors.length}` : ""),
  );
  return result;
}
