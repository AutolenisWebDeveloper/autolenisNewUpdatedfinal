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
import { cancelPendingForTransaction } from "@/lib/services/comms/transactional-dispatcher.service";
import { revokeReleaseToken } from "@/lib/services/pickup/release-token.service";
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

/**
 * The statuses that mean the purchase FINISHED, as opposed to ended.
 *
 * `deal.service`'s `TERMINAL` list has three entries; this has two, and the missing one —
 * `CANCELLED` — is the point. A cancellation aimed at a finished purchase must never run the
 * stops; a cancellation aimed at one that already cancelled is the cleanup RETRY the §26 row
 * `CANCELLATION_CLEANUP_INCOMPLETE` instructs an operator to perform.
 *
 * Declared here rather than imported because `deal.service`'s list is private to the seam,
 * and because the two lists answer different questions. If a fourth terminal status is ever
 * added, `advanceDealStatus`'s own guard is still the one that holds.
 */
const FINISHED_DEAL_STATUSES: readonly DealStatus[] = [DealStatus.COMPLETED, DealStatus.REFUNDED];

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
          // LAZY, and for the reason `acquisition-comms.ts` records at the top of its own
          // file: `buyer-signing.service` reaches `contract-shield/extract-text`, which
          // imports `server-only`. A static import here would make this whole module
          // unloadable by the Node test runner and by Playwright — so the §24
          // orchestration could not be exercised by the very journeys that prove it.
          //
          // Inside the stop rather than at the top of `runStops`, so the cost is paid only
          // on a cancellation that actually has envelopes to void.
          const { voidEnvelopeInternal } = await import("@/lib/services/esign/buyer-signing.service");
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
  // §27's cancellation rule, by the REFS the outbox already stores rather than by
  // reconstructed cancel keys. The first version of this stop built `deal:<id>` and
  // friends, which match none of the six real key builders — so it cancelled nothing and
  // reported `ok: true`, and a cancelled buyer would have kept receiving every queued
  // reminder. See `cancelPendingForTransaction` for the full account.
  //
  // A SENT row is never touched.
  stops.push(
    await runStop("SCHEDULED_COMMS", async () =>
      (
        await cancelPendingForTransaction(
          { dealId: refs.dealId, vehicleRequestId: refs.vehicleRequestId, auctionId: refs.auctionId },
          `Transaction cancelled: ${reason}`,
        )
      ).cancelled,
    ),
  );

  return stops;
}

/**
 * Cancel one transaction — §24, in one place.
 *
 * Accepts a deal id, a vehicle-request id, or both, and a caller holding EITHER END reaches
 * the same stops. A deal resolves its own request and auction directly; a request with no
 * deal resolves its live auction below.
 *
 * That second half was a claim before it was code. The second independent review found
 * `auctionId` taken only from `deal?.auctionId`, so `cancelTransaction({ vehicleRequestId })`
 * on a request with a live auction silently skipped the AUCTION and INVITATIONS stops — the
 * auction kept running and its dealerships kept working a request that had ended. No caller
 * was bitten (the buyer route is limited to pre-auction statuses), but the docstring invited
 * one, and this phase's own buyer-cancel change is exactly such a caller.
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
  //
  // A caller with only a vehicle request still gets its DEAL. Without this, a request-side
  // cancellation skipped the deal entirely: no guarded transition, no history row, no
  // execution-boundary check — the deal simply lived on under a CANCELLED request. The
  // buyer cancel route is limited to pre-deal statuses so nothing reaches it today, but the
  // second independent review asked the question the right way round: the guarantee should
  // be in this function, not in one caller's precondition.
  //
  // Only a LIVE deal. A finished or already-cancelled one is not what this cancellation is
  // about, and picking one up would drag the `FINISHED_DEAL_STATUSES` refusal onto a request
  // whose deal ended months ago.
  const dealIdFromRequest =
    !input.dealId && input.vehicleRequestId
      ? (
          await prisma.deal.findFirst({
            where: {
              vehicleRequestId: input.vehicleRequestId,
              status: { notIn: [DealStatus.COMPLETED, DealStatus.CANCELLED, DealStatus.REFUNDED] },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        )?.id
      : undefined;

  const resolvedDealId = input.dealId ?? dealIdFromRequest;
  const deal = resolvedDealId
    ? await prisma.deal.findUnique({
        where: { id: resolvedDealId },
        select: {
          id: true,
          status: true,
          buyerId: true,
          auctionId: true,
          dealerExecutedContractId: true,
          vehicleRequestId: true,
          // The winning dealership, for the §26 rows a dealership must be able to see.
          // `Deal.dealerId` is nullable on the concierge rail, so the accepted offer is the
          // fallback — the same resolution `pickup-reminders.service.ts:407` uses.
          dealerId: true,
          offer: { select: { dealerId: true } },
        },
      })
    : null;
  if (input.dealId && !deal) throw new CancellationInputError(`Deal ${input.dealId} not found`);

  const vehicleRequestId = deal?.vehicleRequestId ?? input.vehicleRequestId ?? undefined;

  // The auction, from whichever end the caller holds. With a deal it is on the deal; without
  // one it has to be looked up, and only a LIVE auction is worth stopping — a CLOSED or
  // already-CANCELLED one has nothing to withdraw and its invitations are already terminal.
  let auctionId = deal?.auctionId ?? undefined;
  if (!auctionId && vehicleRequestId) {
    const live = await prisma.auction.findFirst({
      where: { vehicleRequestId, status: { in: ["PENDING", "ACTIVE", "REOPENED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    auctionId = live?.id ?? undefined;
  }

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

  // ── A FINISHED PURCHASE IS REFUSED BEFORE ANY STOP RUNS ───────────────────
  //
  // Found by the first independent review. `advanceDealStatus` throws `TerminalDealError`
  // on a COMPLETED deal, and it is the LAST thing this function does — so a cancellation
  // aimed at a completed purchase voided its e-sign envelopes, cancelled its dealer
  // invitations and stopped its pickup, and THEN threw. The caller saw a failure; the
  // transaction had already been dismantled.
  //
  // The same argument as `assertActorMayDrive` two lines up, and it belongs in the same
  // place: every refusal this function can make must be made before the first destructive
  // act, because a stop cannot be undone by an exception.
  //
  // ── AND WHY *CANCELLED* IS NOT IN THAT REFUSAL ────────────────────────────
  //
  // The first version of this guard refused all three terminal statuses and returned with
  // `stops: []`. The SECOND independent review found that this silently broke the register's
  // own remediation: `CANCELLATION_CLEANUP_INCOMPLETE`'s `returnPoint` reads "§24 — re-run
  // the failed stop; the orchestration is idempotent", and an operator doing exactly that on
  // a deal that cancelled with a failed stop got a no-op. The live e-sign envelope the row
  // was raised about could then only be cleaned by hand, while the row told them otherwise.
  //
  // The split is principled rather than a compromise. The stops UNDO a transaction:
  //
  //   · COMPLETED / REFUNDED — the purchase finished. Undoing it is never what anybody
  //     meant, and the stops are destructive, so the refusal stands and comes first.
  //   · CANCELLED — the transaction already ended this way. Every stop is conditional and
  //     idempotent by construction (each one's `where` names the statuses it will move
  //     from), so re-running them is exactly the retry the register promises, and the one
  //     that did not finish is the only one with anything left to do.
  //
  // The DEAL still does not move — it is already at the target — so the outcome is
  // honestly `NOT_MOVED`, with `stops` carrying what the retry actually did.
  if (deal && FINISHED_DEAL_STATUSES.includes(deal.status)) {
    return {
      outcome: "NOT_MOVED",
      stageAtCancellation,
      stops: [],
      dealId: deal.id,
      vehicleRequestId,
    };
  }

  // A cleanup retry on an already-cancelled deal: run the stops, report them, and raise on
  // anything that fails again. Nothing is advanced and no request is re-cancelled.
  if (deal && deal.status === DealStatus.CANCELLED) {
    const retryStops = await runStops(
      { dealId: deal.id, vehicleRequestId, auctionId },
      reason,
      /* frozen */ false,
    );
    return finish({
      outcome: "NOT_MOVED",
      stageAtCancellation,
      stops: retryStops,
      dealId: deal.id,
      vehicleRequestId,
      buyerId: deal.buyerId,
      dealerId: deal.dealerId ?? deal.offer?.dealerId ?? null,
      reason,
      frozen: false,
    });
  }

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
          dealerId: deal.dealerId ?? deal.offer?.dealerId ?? null,
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
  //
  // AND, WHEN A DEAL IS PRESENT, ONLY IF THE DEAL ACTUALLY MOVED. Found by the second
  // independent review. `advanceDealStatus` returns FALSE without throwing when its
  // compare-and-swap matches nothing (`deal.service.ts:581`) — a concurrent writer got
  // there first — and the stops above take real time (two DocuSign voids), so that window
  // is seconds wide rather than theoretical. Without this guard the sequence was: admin
  // cancels a deal at CONTRACT_PENDING → a webhook advances it to CONTRACT_REVIEW during
  // the stops → the CAS matches zero rows → and the request was cancelled anyway. The
  // result is a LIVE deal progressing toward signing whose vehicle request says CANCELLED,
  // reported to the caller as `NOT_MOVED`.
  //
  // The stops that already ran cannot be undone — that is what `CANCELLATION_CLEANUP_INCOMPLETE`
  // is for — but the request must not be dragged down with a deal that is still alive.
  const dealMovedOrAbsent = deal ? moved : true;
  if (vehicleRequestId && !frozen && dealMovedOrAbsent) {
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
    dealerId: deal?.dealerId ?? deal?.offer?.dealerId ?? null,
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
  /**
   * The winning dealership, when there is one.
   *
   * WITHOUT THIS THE FREEZE NOTICE NEVER REACHED THEM. Found by the second independent
   * review: `listOpen` ANDs its filters and the dealer deal page queries by `dealerId`, so a
   * row raised with only a deal reference is invisible to the dealership however carefully it
   * is allowlisted in `DEALER_VISIBLE_CODES`. `DEAL_FROZEN_PENDING_RELEASE` carries the one
   * line that says "do not release the vehicle until this is resolved", to the one party
   * holding the vehicle.
   */
  dealerId?: string | null;
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
      dealerId: args.dealerId ?? null,
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
    // KEYED ON WHAT FAILED, NOT JUST ON THE TRANSACTION. Found by the first independent
    // review: a strict once-ever key of `CODE:dealId` meant a SECOND, DIFFERENT failure
    // opened no case at all. A retry that stopped the auction cleanly but could not void an
    // e-sign envelope collided with the resolved first row and returned it — leaving a live
    // envelope with no owner, which is precisely the swallowed-failure pattern this phase
    // exists to remove.
    //
    // `occurrenceKey` folds the failed-stop set into the DERIVED key, so the writer's own
    // semantics apply to the right subject: the same failure re-observed while open returns
    // that row, a different failure opens its own, and a repeat of one already resolved is
    // suffixed as a recurrence. Sorted, so the key does not depend on the order the stops ran.
    await raiseException({
      code,
      dealId: args.dealId,
      vehicleRequestId: args.vehicleRequestId,
      buyerId: args.buyerId,
      dealerId: args.dealerId ?? null,
      detail: `Stops that did not complete: ${failed
        .map((s) => `${s.stop} (${s.error ?? "unknown"})`)
        .join("; ")}`,
      occurrenceKey: failed.map((s) => s.stop).sort().join("+"),
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
