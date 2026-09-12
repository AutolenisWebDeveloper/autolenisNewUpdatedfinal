// lib/services/acquisition/dealer-opportunity-notification.service.ts
//
// RETIRED IN PHASE 5 — §13-D44, ruled by the owner on 2026-09-11: "RETIRE OUTRIGHT. A second
// fan-out that bypasses the invitation budget one deposit buys is exactly what §7 exists to
// prevent."
//
// WHAT IT DID. It emailed the first 20 ACTIVE dealers that a new buyer opportunity existed,
// with a link to `/dealer/opportunities`. There was no `orderBy`, so the twenty were whichever
// twenty the database returned; no radius, so a dealership 2,000 miles away was told about a
// buyer it could never serve; no invitation, so nothing tracked whether the message landed or
// what came of it; and no place in the §7 field, so it spent dealer attention outside the
// eight-invitation budget §33 step 29 says one deposit buys.
//
// THE ONE GATE IT DID HAVE WAS THE RIGHT ONE, and it is worth recording that it worked:
// `isFulfillmentUnlocked` held the fan-out until a PAID, unheld $99 existed. That is why
// retiring this is not a loss of the pre-payment protection — the protection was never the
// problem.
//
// WHY A STUB RATHER THAN A DELETION. CLAUDE.md: anything that looks obsolete is REPORTED for an
// owner decision, never deleted — and here the owner HAS decided, so the capability is retired
// rather than removed silently. The function keeps its signature and its one call site
// (`app/api/public/request-vehicle/route.ts`), returns `retired: true`, and sends nothing. A
// reader who finds the call site learns why from here instead of finding a dangling import, and
// the existing test suite keeps a subject. Deleting the symbol is a follow-up once §8.4's
// removal pass runs; that is a cleanup, not a behaviour change, and it is not this phase's.
//
// WHAT REPLACES IT. §Stage 7's invitations, and nothing else. A dealership now hears about a
// buyer exactly once, through a tokenised, auction-and-rooftop-bound invitation issued by
// `lib/services/auction/auction-invitation.service.ts` to a rooftop that passed §6b validation
// inside the permitted radius — with per-invitation delivery tracking, reminders at 50% and 90%
// of the window, and a working opt-out.
//
// `/dealer/opportunities` IS UNCHANGED AND STILL REACHABLE. Dealers can still browse
// opportunities; what stops is AutoLenis pushing an untargeted email about them.

import { logger } from "@/lib/logger";

export interface NotifyActiveDealersInput {
  /** Buyer behind the request (null for an unresolved/anonymous lead → never unlocked). */
  buyerId: string | null;
  /** Opportunity/notification id used for the email idempotency key + deep link. */
  opportunityId: string;
  vehicleInterest: string;
  buyerCity?: string | null;
  buyerState?: string | null;
}

export interface NotifyActiveDealersResult {
  notified: number;
  /**
   * `gated` IS GONE, deliberately, and this note is why rather than a silent deletion.
   *
   * It meant "the $99 gate held the fan-out (no PAID deposit)" and became unconditionally false
   * when §13-D44 retired the fan-out — so the public request path saw `gated: false` for an UNPAID
   * buyer, and any log line or response built from it misreported the pre-payment boundary as
   * satisfied. A field whose name asserts a fact it no longer establishes is worse than no field.
   * Found by the independent review. `retired: true` is the honest statement of the same thing:
   * nothing fans out, so nothing is gated.
   */
  /** §13-D44: this fan-out is retired. Always true. */
  retired: true;
}

/**
 * Retired. Sends nothing, notifies nobody, and never throws.
 *
 * Kept callable so the one caller needs no change in this phase and so the retirement is
 * visible at the call site rather than inferred from an absence.
 */
export async function notifyActiveDealersOfOpportunity(
  input: NotifyActiveDealersInput,
): Promise<NotifyActiveDealersResult> {
  logger.info(
    `[dealer-opportunity-notify] retired (§13-D44) — no broadcast for opportunity ` +
      `${input.opportunityId}. Dealers are reached only through §7 auction invitations.`,
  );
  return { notified: 0, retired: true };
}
