// POST /api/finder — NEUTRALISED. Answers 410 Gone and nothing else.
//
// §5 rule 1: "All Lane 1 forms post to a single intake handler. No page implements
// its own capture logic." This route implemented its own — an anonymous
// conversational finder that wrote `Conversation` and `LeadScore` rows and
// produced no `buyer_opportunities` lead and no `vehicle_requests` row at all, so
// anything it captured was invisible to the transaction.
//
// It has NO UI CALLER. `components/acquisition/VehicleFinder.tsx` is unmounted and
// omits the `X-Zura-Session` header the route's own session handling expects. The
// parity ledger records it as a dead conversational finder and assigns the
// neutralisation to Phase 2 (`intake/D2`); the DELETION of the route file and the
// component is owner-gated and is not done here — CLAUDE.md is explicit that
// anything obsolete or dead is reported for an owner decision, never deleted in
// passing.
//
// So this is a 410, not a `rm`. The capability is not lost, it is redirected: a
// conversational Lane 1 capture belongs on `/api/concierge`, which goes through
// `unified-buyer-intake.service.ts` and produces the lead and the request.
//
// It is BODYLESS in both directions, for the same reason the retired SSN intake
// is: an unauthenticated, un-rate-limited, CSRF-exempt endpoint that parses a body
// is an attack surface even when it does nothing with it. Not parsing is the
// smallest possible surface.
//
// PRESERVED: every historical `conversations` and `lead_scores` row. No schema
// change, no deletion. `lib/services/acquisition/__tests__/no-phone-keyed-buyer-mutation.test.ts`
// still asserts what this route may never do.
//
// ROLLBACK: reverting this commit restores the previous handler verbatim. There is
// no SQL to undo.

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return new NextResponse(null, { status: 410 });
}
