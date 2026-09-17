// lib/services/transaction/cancellation.service.ts
//
// §24 — THE ONE CANCELLATION ORCHESTRATION. §33 step 25: "Orchestrate cancellation
// cleanup in one place."
//
// ── WHAT §24 ASKS FOR, AND WHAT THE REPOSITORY HAD ──────────────────────────
//
// §24 lists ten requirements for a cancellation before contract execution: an
// authorized actor; a required reason; the current stage recorded; unsent sourcing
// and outreach stopped; auction activity closed; affected dealerships notified;
// unsigned envelopes voided; pickup cancelled and release tokens revoked; payment
// treatment determined; the buyer notified; and full history preserved.
//
// Its own note is exact about the gap: *"The state seam records cancellation safely
// today, but a generic cancellation does not centrally stop sourcing, cancel
// invitations, void envelopes, revoke tokens, and close scheduled work."*
//
// That was literally true. `cancelDeal` moved `Deal.status` and emitted comms. The
// buyer request-cancel route moved `VehicleRequest.status` and recorded no reason.
// Neither reached any other subsystem — and every capability §24 names ALREADY
// EXISTED as a callable, CAS-safe function that nothing called from a cancellation:
//
//   · `voidEnvelopeInternal`  (buyer-signing.service.ts:626)
//   · `revokeReleaseToken`    (release-token.service.ts:286) — whose own docstring
//     names "Phase 10's cancellation orchestration" as its intended caller
//   · `cancelByKey`           (transactional-dispatcher.service.ts:268)
//   · `transitionCase` → CLOSED (sourcing-case.service.ts:408)
//
// So this module composes rather than reimplements. It owns the ORDER, the
// authorization, the reason, the stage record and the exception — not the mechanics
// of any one stop.
//
// ── THE EXECUTION BOUNDARY IS THE WHOLE POINT ───────────────────────────────
//
// §24's second half: "After the dealership contract is fully executed, AutoLenis
// cannot unilaterally void it. The Deal moves to FROZEN_PENDING_RELEASE while
// AutoLenis coordinates the buyer's and dealership's documented release or other
// resolution. This is a coordination state, not a cancellation."
//
// `cancellationTargetFor` (transition-authority.ts) decides which half applies, from
// the FACT `dealerExecutedContractId` rather than from a status list. Both halves run
// the same stops — a frozen transaction should not keep sending dealer reminders
// either — but a freeze does NOT void the executed contract, does NOT determine
// payment treatment, and DOES open an Operations case, because a coordinated unwind
// has an owner and a deadline and a generic cancellation does not.
//
// ── BEST-EFFORT IS A DECISION, NOT A SHRUG ──────────────────────────────────
//
// The status change is transactional and conditional. The STOPS are not, and cannot
// be: they span an e-sign provider, the outbox, the auction and the pickup, and
// wrapping them in one database transaction would either hold locks across a network
// call or roll back a void that already happened at DocuSign.
//
// So each stop is attempted independently, its outcome recorded, and a FAILED stop
// raises an exception rather than being swallowed. That is the §28.3 #8 requirement —
// "every failure and timeout has an owner and a return path" — and it is the
// difference between this and the `.catch(() => {})` pattern it replaces: nothing here
// fails silently, and the caller is told exactly which stop did not complete so an
// operator can finish it by hand.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { DealStatus } from "@prisma/client";
import {
  advanceDealStatus,
  ContractExecutedError,
} from "@/lib/services/deal/deal.service";
import {
  cancellationTargetFor,
  assertActorMayDrive,
  type TransactionActorRole,
} from "@/lib/services/deal/transition-authority";
import { raiseException } from "@/lib/services/operations/queue-item.service";
import { cancelByKey } from "@/lib/services/comms/transactional-dispatcher.service";
import { revokeReleaseToken } from "@/lib/services/pickup/release-token.service";
import { voidEnvelopeInternal } from "@/lib/services/esign/buyer-signing.service";
import { transitionCase, SOURCING_CASE_STATUS } from "@/lib/services/sourcing/sourcing-case.service";

/** Every stop §24 names, as a stable key so the result can be asserted on. */
export type CancellationStop =
  | "SOURCING_CASE"
  | "AUCTION"
  | "INVITATIONS"
  | "ESIGN_ENVELOPES"
  | "RELEASE_TOKEN"
  | "PICKUP"
  | "SCHEDULED_COMMS"
  | "VEHICLE_REQUEST";

export interface StopOutcome {
  readonly stop: CancellationStop;
  /** What the stop did. `0` is a legitimate outcome — there was nothing to stop. */
  readonly affected: number;
  readonly ok: boolean;
  /** Present only when `ok` is false. Carried to the exception and to the caller. */
  readonly error?: string;
}

export interface CancelTransactionInput {
  /** At least one of these. A deal implies its request; a request may have no deal. */
  readonly dealId?: string;
  readonly vehicleRequestId?: string;
  /** §24: "a required reason". Not defaulted, not derived. */
  readonly reason: string;
  readonly actorId: string;
  readonly actorRole: TransactionActorRole;
}

export interface CancelTransactionResult {
  /**
   * `CANCELLED` before execution; `FROZEN_PENDING_RELEASE` after it; `NOT_MOVED`
   * when a concurrent writer got there first or the transaction was already terminal.
   */
  readonly outcome: "CANCELLED" | "FROZEN_PENDING_RELEASE" | "NOT_MOVED";
  /** §24: "the current stage recorded" — what the transaction was doing when it stopped. */
  readonly stageAtCancellation: string;
  readonly stops: readonly StopOutcome[];
  /** The `queue_items` row opened for a freeze, or for any stop that failed. */
  readonly exceptionCode?: string;
  readonly dealId?: string;
  readonly vehicleRequestId?: string;
}

export class CancellationInputError extends Error {
  code = "CANCELLATION_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "CancellationInputError";
  }
}

/**
 * Run one stop, never letting it throw.
 *
 * A stop that fails must not prevent the others: a DocuSign outage is not a reason to
 * leave the auction running and the dealerships waiting. The failure is CARRIED —
 * every caller of this helper reports it, and `cancelTransaction` raises an exception
 * when any stop comes back not-ok.
 */
async function runStop(
  stop: CancellationStop,
  fn: () => Promise<number>,
): Promise<StopOutcome> {
  try {
    return { stop, affected: await fn(), ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("[cancellation] stop failed", { stop, error });
    return { stop, affected: 0, ok: false, error };
  }
}

/**
 * §24's stops. Shared by both halves — a frozen transaction stops sourcing and
 * outreach exactly like a cancelled one, because the dealership pool should not keep
 * being worked while a release is coordinated.
 *
 * `frozen` controls the two that differ: an executed contract's envelopes are NOT
 * voided (they are the executed contract), and the pickup is held rather than
 * cancelled, because the resolution may be that the deal proceeds.
 */
async function runStops(
  refs: { dealId?: string; vehicleRequestId?: string; auctionId?: string },
  reason: string,
  frozen: boolean,
): Promise<StopOutcome[]> {
  const stops: StopOutcome[] = [];

  // ── Unsent sourcing stopped ────────────────────────────────────────────────
  if (refs.vehicleRequestId) {
    const vrId = refs.vehicleRequestId;
    stops.push(
      await runStop("SOURCING_CASE", async () => {
        const kase = await prisma.sourcingCase.findUnique({
          where: { vehicleRequestId: vrId },
          select: { id: true, status: true },
        });
        if (!kase || kase.status === SOURCING_CASE_STATUS.CLOSED) return 0;
        const res = await transitionCase({
          caseId: kase.id,
          to: SOURCING_CASE_STATUS.CLOSED,
          reason: `Transaction cancelled: ${reason}`,
          closedAt: new Date(),
        });
        return res.ok ? 1 : 0;
      }),
    );
  }

  // ── Auction activity closed, and the dealerships told ──────────────────────
  //
  // CONDITIONAL, unlike every auction status write this phase found (§28.3 #3): the
  // `where` names the statuses it is willing to move from, so a concurrent close or a
  // prior cancel is a no-op rather than an overwrite.
  if (refs.auctionId) {
    const auctionId = refs.auctionId;
    stops.push(
      await runStop("AUCTION", async () => {
        const res = await prisma.auction.updateMany({
          where: { id: auctionId, status: { in: ["PENDING", "ACTIVE"] } },
          data: { status: "CANCELLED", closedAt: new Date() },
        });
        return res.count;
      }),
    );

    // §24: "affected dealerships notified". The invitation status is the record that
    // AutoLenis withdrew it — CANCELLED, added by 20261215000000, rather than EXPIRED,
    // which would tell a dealership it missed a deadline it never missed.
    stops.push(
      await runStop("INVITATIONS", async () => {
        const res = await prisma.auctionInvitation.updateMany({
          where: {
            auctionId,
            status: { in: ["QUEUED", "SENT", "DELIVERED", "OPENED"] },
          },
          data: { status: "CANCELLED" },
        });
        return res.count;
      }),
    );
  }

  if (refs.dealId) {
    const dealId = refs.dealId;

    // ── Unsigned envelopes voided ────────────────────────────────────────────
    //
    // Skipped on a freeze, and that is the §24 boundary again: after execution the
    // envelope IS the executed contract, and voiding it would destroy the evidence the
    // coordinated release is negotiated against.
    if (!frozen) {
      stops.push(
        await runStop("ESIGN_ENVELOPES", async () => {
          let voided = 0;
          for (const signerKind of ["BUYER", "CO_BUYER"] as const) {
            try {
              await voidEnvelopeInternal(dealId, `Transaction cancelled: ${reason}`, signerKind);
              voided += 1;
            } catch (err) {
              // No envelope for this signer is the common case, not a failure. A real
              // provider error surfaces on the next line up, where the loop rethrows.
              const message = err instanceof Error ? err.message : String(err);
              if (!/not found|no envelope|does not exist/i.test(message)) throw err;
            }
          }
          return voided;
        }),
      );
    }

    // ── Release tokens revoked ───────────────────────────────────────────────
    //
    // Revoked on BOTH halves. A live release code on a frozen deal is a vehicle that
    // can leave the lot while the release is still being negotiated, which is the
    // exact outcome §24's freeze exists to prevent.
    stops.push(
      await runStop("RELEASE_TOKEN", async () => ((await revokeReleaseToken(dealId)) ? 1 : 0)),
    );

    // ── Pickup cancelled ─────────────────────────────────────────────────────
    //
    // Not on a freeze: "other resolution" includes the deal proceeding, and cancelling
    // the appointment would make a resumed deal look like it never had one.
    if (!frozen) {
      stops.push(
        await runStop("PICKUP", async () => {
          const res = await prisma.pickup.updateMany({
            where: {
              dealId,
              status: { in: ["NOT_SCHEDULED", "PROPOSED", "DEALER_COUNTERED", "SCHEDULED", "RESCHEDULED"] },
            },
            data: { status: "CANCELLED" },
          });
          return res.count;
        }),
      );
    }
  }

  // ── Scheduled work closed ──────────────────────────────────────────────────
  //
  // §27's cancellation rule, through the dispatcher's own `cancelByKey`: a pending row
  // is cancelled, a SENT row is never touched. A message that has left cannot be
  // unsent, and rewriting its status would make the delivery record lie.
  const cancelKeys = [
    refs.dealId ? `deal:${refs.dealId}` : null,
    refs.vehicleRequestId ? `request:${refs.vehicleRequestId}` : null,
    refs.auctionId ? `auction:${refs.auctionId}` : null,
  ].filter((k): k is string => k !== null);

  stops.push(
    await runStop("SCHEDULED_COMMS", async () => {
      let cancelled = 0;
      for (const key of cancelKeys) {
        cancelled += (await cancelByKey(key, `Transaction cancelled: ${reason}`)).cancelled;
      }
      return cancelled;
    }),
  );

  return stops;
}

/**
 * Cancel one transaction — §24, in one place.
 *
 * Accepts a deal id, a vehicle-request id, or both. A deal resolves its own request
 * and auction, so a caller holding either end reaches the same stops.
 */
export async function cancelTransaction(
  input: CancelTransactionInput,
): Promise<CancelTransactionResult> {
  const reason = input.reason?.trim();
  // §24: "a required reason". Checked here rather than defaulted, because a
  // cancellation whose reason is "cancelled" answers nothing an operator would ask.
  if (!reason) {
    throw new CancellationInputError("§24 requires a reason for every cancellation.");
  }
  if (!input.dealId && !input.vehicleRequestId) {
    throw new CancellationInputError("cancelTransaction needs a dealId or a vehicleRequestId.");
  }

  // ── Resolve the transaction from whichever end the caller holds ────────────
  const deal = input.dealId
    ? await prisma.deal.findUnique({
        where: { id: input.dealId },
        select: {
          id: true,
          status: true,
          buyerId: true,
          auctionId: true,
          dealerExecutedContractId: true,
          vehicleRequestId: true,
        },
      })
    : null;
  if (input.dealId && !deal) throw new CancellationInputError(`Deal ${input.dealId} not found`);

  const vehicleRequestId = deal?.vehicleRequestId ?? input.vehicleRequestId ?? undefined;
  const auctionId = deal?.auctionId ?? undefined;

  // §24: "the current stage recorded". Captured BEFORE anything moves — after the
  // stops have run there is no way to say what the transaction was doing.
  const stageAtCancellation = deal
    ? `Deal ${deal.status}`
    : await vehicleRequestStage(vehicleRequestId);

  // ── Which half of §24 applies ──────────────────────────────────────────────
  const target = deal ? cancellationTargetFor(deal) : DealStatus.CANCELLED;
  const frozen = target === DealStatus.FROZEN_PENDING_RELEASE;

  // §28.3 #1, checked before any stop runs. A stop is destructive; refusing after
  // voiding the envelopes would be the worst of both.
  assertActorMayDrive(input.actorRole, target);

  const stops = await runStops({ dealId: deal?.id, vehicleRequestId, auctionId }, reason, frozen);

  // ── The state change itself ────────────────────────────────────────────────
  let moved = false;
  if (deal) {
    try {
      moved = await advanceDealStatus(deal.id, target, {
        actorId: input.actorId,
        actorRole: input.actorRole,
        reason,
        expectedFrom: deal.status,
        ...(frozen ? { data: { frozenAt: new Date(), frozenReason: reason } } : {}),
      });
    } catch (err) {
      // The one error this cannot mean. `cancellationTargetFor` already routed an
      // executed deal to the freeze, so reaching it here means the contract landed
      // between the read and the write — a race, not a caller mistake. Re-resolving
      // as a freeze is the correct answer, not an error.
      if (err instanceof ContractExecutedError) {
        moved = await advanceDealStatus(deal.id, DealStatus.FROZEN_PENDING_RELEASE, {
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: `${reason} (contract executed during cancellation)`,
          data: { frozenAt: new Date(), frozenReason: reason },
        });
        return finish({
          outcome: moved ? "FROZEN_PENDING_RELEASE" : "NOT_MOVED",
          stageAtCancellation,
          stops,
          dealId: deal.id,
          vehicleRequestId,
          buyerId: deal.buyerId,
          reason,
          frozen: true,
        });
      }
      throw err;
    }
  }

  // ── The vehicle request ────────────────────────────────────────────────────
  //
  // CONDITIONAL and WITH A REASON — both of which the buyer cancel route lacked. A
  // frozen deal does NOT cancel its request: the request is the record of what the
  // buyer asked for, and the transaction has not ended.
  if (vehicleRequestId && !frozen) {
    const vrId = vehicleRequestId;
    stops.push(
      await runStop("VEHICLE_REQUEST", async () => {
        const res = await prisma.vehicleRequest.updateMany({
          where: {
            id: vrId,
            status: { notIn: ["CANCELLED", "EXPIRED", "CLOSED_NO_MATCH", "DEAL_CREATED"] },
          },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
        });
        return res.count;
      }),
    );
    if (!deal) moved = (stops.at(-1)?.affected ?? 0) > 0;
  }

  return finish({
    outcome: moved ? (frozen ? "FROZEN_PENDING_RELEASE" : "CANCELLED") : "NOT_MOVED",
    stageAtCancellation,
    stops,
    dealId: deal?.id,
    vehicleRequestId,
    buyerId: deal?.buyerId,
    reason,
    frozen,
  });
}

async function vehicleRequestStage(vehicleRequestId?: string): Promise<string> {
  if (!vehicleRequestId) return "unknown";
  const vr = await prisma.vehicleRequest.findUnique({
    where: { id: vehicleRequestId },
    select: { status: true },
  });
  return vr ? `VehicleRequest ${vr.status}` : "unknown";
}

/**
 * Raise what the outcome owes Operations, then report.
 *
 * TWO reasons an exception is opened, and they are different facts:
 *
 *   · A FREEZE always opens one. §24's coordination has an owner, a deadline and a
 *     return point, and `queue_items` is where those live — a frozen deal with no
 *     case is a transaction nobody is driving.
 *   · A FAILED STOP opens one whatever the outcome. §28.3 #8: "every failure and
 *     timeout has an owner and a return path." The alternative is the pattern this
 *     phase exists to remove — a swallowed error and a cancellation that reports
 *     success while an envelope is still live.
 */
async function finish(args: {
  outcome: CancelTransactionResult["outcome"];
  stageAtCancellation: string;
  stops: StopOutcome[];
  dealId?: string;
  vehicleRequestId?: string;
  buyerId?: string;
  reason: string;
  frozen: boolean;
}): Promise<CancelTransactionResult> {
  const failed = args.stops.filter((s) => !s.ok);
  let exceptionCode: string | undefined;

  if (args.frozen && args.outcome === "FROZEN_PENDING_RELEASE") {
    exceptionCode = "DEAL_FROZEN_PENDING_RELEASE";
    await raiseException({
      code: exceptionCode,
      dealId: args.dealId,
      vehicleRequestId: args.vehicleRequestId,
      buyerId: args.buyerId,
      detail: `${args.stageAtCancellation} — ${args.reason}`,
      idempotencyKey: `DEAL_FROZEN_PENDING_RELEASE:${args.dealId}`,
    }).catch((err) => {
      // Reported, never swallowed: the freeze itself succeeded and must still be
      // returned, but an unopened case is a real gap and says so at error level.
      logger.error("[cancellation] could not open the freeze case", {
        dealId: args.dealId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  if (failed.length > 0) {
    const code = "CANCELLATION_CLEANUP_INCOMPLETE";
    await raiseException({
      code,
      dealId: args.dealId,
      vehicleRequestId: args.vehicleRequestId,
      buyerId: args.buyerId,
      detail: `Stops that did not complete: ${failed
        .map((s) => `${s.stop} (${s.error ?? "unknown"})`)
        .join("; ")}`,
      idempotencyKey: `CANCELLATION_CLEANUP_INCOMPLETE:${args.dealId ?? args.vehicleRequestId}`,
    }).catch((err) => {
      logger.error("[cancellation] could not open the incomplete-cleanup case", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    exceptionCode ??= code;
  }

  return {
    outcome: args.outcome,
    stageAtCancellation: args.stageAtCancellation,
    stops: args.stops,
    exceptionCode,
    dealId: args.dealId,
    vehicleRequestId: args.vehicleRequestId,
  };
}
