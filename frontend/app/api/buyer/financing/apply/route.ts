// POST /api/buyer/financing/apply — RETIRED. Answers 410 Gone and nothing else.
//
// This endpoint used to accept a buyer's Social Security number, income, employer
// and date of birth as JSON and write an encrypted CreditApplication row. Direct
// online lender decisioning was never activated, so the identifier was collected
// for a decision nothing made: the intake existed, the downstream did not.
// Collecting an SSN that no workflow consumes is exposure without purpose, so the
// intake is closed here, at the route.
//
// The handler is deliberately BODYLESS IN BOTH DIRECTIONS:
//   • It never calls request.json(). An SSN that is never parsed cannot be held in
//     a request buffer, attached to a Sentry breadcrumb, or echoed by a validation
//     error. Reading the body and discarding it would still bring the identifier
//     into the process, so the parameter is not even accepted.
//   • It returns no response body — nothing to reflect a submitted value back.
// It also does not authenticate. 410 describes the RESOURCE, not the caller, and
// answering identically for every actor keeps the retirement from depending on a
// session lookup.
//
// PRESERVED — this removes an intake, not a capability:
//   • Every historical credit_applications row. No schema change, no deletion, no
//     backfill. CreditApplication, its ssn_encrypted column, and
//     lib/services/financing/credit-application.service.ts are untouched, so admin
//     financing review (app/api/admin/financing-reviews/**) and
//     financing-orchestrator.service.ts still read existing applications exactly
//     as before.
//   • The buyer's ability to move a deal through financing, which never ran
//     through this route. The live rail is PATCH /api/buyer/deal/financing
//     (financingPath DEALER | EXTERNAL | CASH), called from
//     app/buyer/deal/financing/page.tsx:45; it advances FINANCING_PENDING →
//     FEE_PENDING via advanceDealStatus (route.ts:23) and collects no SSN.
//     app/buyer/financing/page.tsx already links buyers to that page.
//
// ROLLBACK: this is code, not SQL. Reverting the commit restores the previous
// handler verbatim. Nothing was migrated, dropped, or rewritten, so there is no
// data step to undo and no ordering constraint between code and database.
import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return new NextResponse(null, { status: 410 });
}
