// POST /api/buyer/financing/apply — RETIRED. Answers 303 and points at the external-financing
// screen.
//
// This endpoint used to accept a buyer's Social Security number, income, employer and date of
// birth as JSON and write an encrypted CreditApplication row. Direct online lender decisioning was
// never activated, so the identifier was collected for a decision nothing made: the intake
// existed, the downstream did not. Collecting an SSN that no workflow consumes is exposure without
// purpose, so the intake was closed in Phase 0, at the route.
//
// THE PHASE 0 REFUSAL — NOT THE LATER DELETION — IS THE CONTROL THAT MUST NEVER BE REVERTED.
// §8.2's rollback note says so, and it is why this file still exists rather than being removed:
// deleting the route would make `POST /api/buyer/financing/apply` a 404, and a 404 is what a
// restored handler also stops being. A refusal that is present in the tree, commented, and pinned
// by a build-failing test is a control; an absent file is an absence.
//
// STILL BODYLESS IN BOTH DIRECTIONS, and Phase 7 did not weaken that:
//   • It never calls `request.json()`. An SSN that is never parsed cannot be held in a request
//     buffer, attached to a Sentry breadcrumb, or echoed by a validation error. Reading the body
//     and discarding it would still bring the identifier into the process, so the parameter is not
//     even accepted.
//   • It returns no response body.
//
// WHY 303 AND NOT 307/308 — the one substantive Phase 7 change here, and it is a security choice
// rather than a cosmetic one. §8.2 Phase 7 says "the Phase 0 410 handler becomes a redirect to the
// external-financing screen". A 307 or 308 PRESERVES the method and the body, so a client that
// still POSTs an SSN payload would have that payload RE-SENT by the browser to the redirect
// target — reopening, through the redirect, exactly the exposure Phase 0 closed. 303 See Other
// instructs the client to issue a GET to the target and to drop the body, which is the only
// redirect status that keeps this handler's guarantee intact.
//
// 410 was the correct answer while there was nowhere to send anyone. There is now: §12's three
// paths are real, live and reachable, and telling a buyer where to go is better than telling them
// the door is gone.
//
// PRESERVED — this removes an intake, not a capability:
//   • Every historical `credit_applications` row. No schema change, no deletion, no backfill
//     (§8.2a; production holds zero rows, which makes the retention question easy but does not
//     change the rule).
//   • The buyer's ability to move a deal through financing, which never ran through this route.
//     The live rail is `PATCH /api/buyer/deal/financing`, which since Phase 7 records the buyer's
//     PATH ONLY and advances nothing — §12c's "the buyer can never mark financing completed" is a
//     rule about who the verifier is, not about one status.
//
// ROLLBACK: this is code, not SQL. Reverting the commit restores the previous handler verbatim.
// Nothing was migrated, dropped, or rewritten.
import { NextResponse } from "next/server";

/** Where §12's three real paths live. */
const EXTERNAL_FINANCING_SCREEN = "/buyer/financing";

export async function POST(): Promise<NextResponse> {
  // 303 See Other: the client re-issues as GET and drops the body. See the header for why this
  // may never become 307 or 308.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: EXTERNAL_FINANCING_SCREEN },
  });
}
