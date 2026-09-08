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
export type ApprovalGate = "payment" | "offer_selection" | "contract_request";

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

  // Only an EXPIRY is §26's "Approval expires mid-transaction". A buyer who never
  // applied, or whose application is under review, is not a mid-transaction expiry
  // and raising one would fill the queue with rows nobody can act on.
  if (opts.raiseOnFailure && reason === "EXPIRED") {
    try {
      await raiseException(
        {
          code: "PREQUAL_APPROVAL_EXPIRED",
          buyerId,
          vehicleRequestId: opts.vehicleRequestId ?? null,
          dealId: opts.dealId ?? null,
          detail: `approval expired, caught at the ${gate} gate`,
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
