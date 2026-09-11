// lib/services/prequal/approval-recheck.ts
//
// STAGE 3's LAST PARAGRAPH, as a callable helper.
//
//   "Approval is rechecked — not merely at the payment gate, but at offer
//    selection and again at contract request. An approval that expires
//    mid-transaction pauses the Deal and asks the buyer to renew rather than
//    silently proceeding on a stale ceiling."
//
// `isPrequalValid` already existed and is the single source of the predicate
// (`prequal.service.ts`). What was missing is the CALLS: it was invoked at deposit
// create-intent and nowhere else, so a buyer whose approval expired between paying
// and selecting could accept an offer above a ceiling that no longer applied —
// and the first anyone would know is at contract review, with a Deal already
// created and a dealership already committed.
//
// This wraps the predicate with the two things a caller at a gate needs: the
// reason, and the exception. §26's "Approval expires mid-transaction — Buyer /
// Operations — Pause; require renewal before advancing" is raised HERE rather than
// at each call site, so every gate produces the same queue row with the same owner
// and the same return point.
//
// IT DOES NOT DECIDE. It returns a verdict; the caller decides whether to refuse.
// A gate that silently proceeded on `ok: false` would be the defect this exists to
// close, and the call sites are what the tests pin.
//
// §11.5 ruling 1 also matters here: `prequal/D3` records that the validity
// predicate is re-derived INLINE at five sites (`financing/route.ts:33` — weaker —
// plus four pages). Those are consolidated onto `isPrequalValid` phase by phase;
// the financing route is Phase 7 (`S3-22b`).
//
// Run: pnpm test:buyer-journey

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { isPrequalValid } from "./prequal.service";
import { raiseException } from "@/lib/services/operations/queue-item.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** Where the recheck ran. Stage 3 names three; §26 gets one exception either way. */
/**
 * Where the recheck is being run.
 *
 * `auction_launch` added in Phase 5 for §10.6 S7-02 — §Stage 7's entry requires "the
 * prequalification and approved ceiling are attached" before an auction may go live, and that
 * gate sits AFTER payment like the two below it: the buyer has paid, so arriving with no
 * usable approval is a stuck buyer rather than an unfinished one, and it raises.
 */
export type ApprovalGate = "payment" | "auction_launch" | "offer_selection" | "contract_request";

export type ApprovalVerdict =
  | { ok: true; approvedAmountCents: number | null; expiresAt: Date }
  | { ok: false; reason: "NO_APPLICATION" | "NOT_APPROVED" | "EXPIRED"; message: string };

const MESSAGES: Record<Exclude<ApprovalVerdict & { ok: false }, never>["reason"], string> = {
  NO_APPLICATION: "Complete your prequalification to continue.",
  NOT_APPROVED: "Your prequalification is not approved yet. We will let you know as soon as it is.",
  EXPIRED: "Your approval has expired. Renew it to continue — it only takes a minute.",
};

export interface RecheckOptions {
  /** Raise the §26 exception on failure. Off for a read-only check (a page render). */
  raiseOnFailure?: boolean;
  /** Refs for the exception, so a human can find the transaction. */
  vehicleRequestId?: string | null;
  dealId?: string | null;
}

/**
 * Is this buyer's approval still good, right now?
 *
 * Reads the LATEST application, because a renewal supersedes an expiry and the
 * question is always about the current state, never about the one that was
 * checked at payment.
 */
export async function recheckApproval(
  buyerId: string,
  gate: ApprovalGate,
  opts: RecheckOptions = {},
  db: Db = prisma
): Promise<ApprovalVerdict> {
  const prequal = await db.preQualification.findFirst({
    where: { buyerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, decision: true, expiresAt: true, maxOtdAmountCents: true },
  });

  if (!prequal) {
    return await fail(db, buyerId, gate, "NO_APPLICATION", opts);
  }
  if (isPrequalValid(prequal)) {
    return { ok: true, approvedAmountCents: prequal.maxOtdAmountCents ?? null, expiresAt: prequal.expiresAt };
  }
  // The two failures are distinguished because they call for different things: a
  // buyer whose approval EXPIRED renews, and one whose application was declined or
  // is still under review cannot.
  const reason = prequal.decision === "APPROVED" ? "EXPIRED" : "NOT_APPROVED";
  return await fail(db, buyerId, gate, reason, opts);
}

async function fail(
  db: Db,
  buyerId: string,
  gate: ApprovalGate,
  reason: "NO_APPLICATION" | "NOT_APPROVED" | "EXPIRED",
  opts: RecheckOptions
): Promise<ApprovalVerdict> {
  const verdict: ApprovalVerdict = { ok: false, reason, message: MESSAGES[reason] };

  // §26's "Approval expires mid-transaction" is the EXPIRED row, and it is raised
  // wherever it is caught. The other two reasons depend on WHERE the gate is:
  //
  //   • at `payment`, a buyer who never applied or is still under review is the
  //     ordinary case — they simply have not finished. Raising there would fill
  //     the queue with rows nobody can act on, which is why it does not.
  //   • at `auction_launch`, `offer_selection` and `contract_request` the buyer has
  //     already PAID. Arriving there with no approval at all is not an ordinary
  //     case, it is a buyer stuck behind a gate with nothing they can do about it —
  //     and before this, the 409 was the only trace: no queue row, no alert, and an
  //     auction that closes unselected while everyone waits.
  //
  //     `auction_launch` is the earliest of the three (Phase 5, §Stage 7 entry) and
  //     it is the one where raising matters most: the auction has not launched yet,
  //     so the buyer's $99 is sitting against a request that cannot proceed and
  //     nothing downstream has happened to reveal it.
  const postPaymentGate =
    gate === "auction_launch" || gate === "offer_selection" || gate === "contract_request";
  const raise = reason === "EXPIRED" || postPaymentGate;
  if (opts.raiseOnFailure && raise) {
    try {
      await raiseException(
        {
          // EXPIRED is §26's own row. The post-payment no-approval case is a
          // manual prequalification condition on the same owner's desk, so it
          // reuses that row rather than inventing a code the register does not
          // carry; `detail` says which of the two it is.
          code: "PREQUAL_APPROVAL_EXPIRED",
          buyerId,
          vehicleRequestId: opts.vehicleRequestId ?? null,
          dealId: opts.dealId ?? null,
          detail:
            reason === "EXPIRED"
              ? `approval expired, caught at the ${gate} gate`
              : `no usable approval (${reason}) at the ${gate} gate — this buyer has already paid and cannot proceed without one`,
        },
        db
      );
    } catch (err) {
      // The gate's refusal stands whether or not the queue row was written; a
      // failed raise must not turn a refusal into an approval.
      logger.error("[approval-recheck] exception raise failed (the gate still refuses):", err);
    }
  }
  return verdict;
}
