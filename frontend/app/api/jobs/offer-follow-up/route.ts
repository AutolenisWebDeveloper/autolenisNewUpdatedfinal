import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashRequest } from "@/lib/qstash/verify";
import { dispatch } from "@/lib/qstash/dispatch";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { hasSelectedOffer } from "@/lib/qstash/state";

export const dynamic = "force-dynamic";

// ── SUPERSEDED BY §9's SELECTION REMINDER — REPORTED, NOT DELETED ──────────────────────────────
//
// Parity row S14 names this route as the thing to retire: it sends "review it before it expires"
// copy against NO REAL EXPIRY. `offers.expires_at` shipped in the Phase 1 wave with no writer, so
// until Phase 6 there was nothing for "before it expires" to refer to — the deadline in this copy
// was a figure of speech, and the second touch's "your dealer offer is about to expire" was simply
// not true of anything.
//
// The replacement is `scheduleSelectionReminder` (`lib/services/auction/auction.service.ts`): ONE
// message, through the §27 dispatcher, scheduled 24 hours before the EARLIEST real expiry on the
// auction, cancelled by key the moment the buyer selects, and re-decided at send time.
//
// This route is left in place because retiring it is a capability decision rather than a refactor,
// and because in-flight QStash schedules may still call it — deleting the handler would turn those
// into 404s rather than into the no-ops they become when nothing schedules new ones. Its own
// `hasSelectedOffer` guard already stops it for a buyer who has chosen. What it needs is for the
// SCHEDULING side to stop, which is a Phase 10 consolidation (`I-11`), and an owner decision on
// whether the SMS half of it is wanted on the new rail at all — the dispatcher row is email-only.
//
// Do not add new callers.


interface Payload {
  buyerId: string;
  firstName: string;
  email: string;
  touchNumber: number;
}

export async function POST(request: NextRequest) {
  if (!(await verifyQStashRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { buyerId, firstName, email, touchNumber } = (await request.json()) as Payload;

    if (await hasSelectedOffer(buyerId)) {
      return NextResponse.json({ success: true, stopped: "offer_selected" });
    }

    const dashboardUrl = `${NOTIFY_APP_URL}/buyer/dashboard`;

    if (touchNumber === 1) {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, your dealer offer is waiting. Review it before it expires: autolenis.com/buyer/dashboard`,
        emailSubject: "Your dealer offer is waiting",
        emailHtml: renderEmail({
          heading: "Your dealer offer is waiting",
          bodyHtml: `<p>Hi ${firstName},</p><p>You have a dealer offer waiting for review. Take a look so you don't miss out.</p>`,
          ctaText: "Review your offer",
          ctaUrl: dashboardUrl,
        }),
      });
      await dispatch({
        path: "/api/jobs/offer-follow-up",
        body: { buyerId, firstName, email, touchNumber: 2 },
        delaySeconds: 72000,
      });
    } else {
      await notifyContact({
        entityType: "buyer",
        entityId: buyerId,
        email,
        sms: `${firstName}, last chance to review your dealer offer before it expires: autolenis.com/buyer/dashboard`,
        emailSubject: "Last chance to review your offer",
        emailHtml: renderEmail({
          heading: "Last chance to review your offer",
          bodyHtml: `<p>Hi ${firstName},</p><p>This is your final reminder — your dealer offer is about to expire. Review it now to lock in your decision.</p>`,
          ctaText: "Review before it expires",
          ctaUrl: dashboardUrl,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Job failed:", err);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
