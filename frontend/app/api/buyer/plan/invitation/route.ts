// §23.2a touchpoints 3 and 4 — THE POST-ACCEPTANCE PREMIUM INVITATION.
//
// §27.1 K27-1329 ("Premium invitation shown at acceptance") and K27-1330 ("Premium follow-up
// first (1h, only if declined)"). §9: the full-screen invitation is shown ONCE, immediately after
// offer acceptance; the one-hour email follows only if it was declined or dismissed.
//
// THREE PROPERTIES THE OWNER RULED, and each is a design decision rather than a detail:
//
//   IT NEVER BLOCKS. This is a separate request the deal page makes AFTER the selection has
//   committed. `commitOfferSelection` does not know it exists, so no failure here — a Supabase
//   outage on the do-not-contact read, a slow queue query — can delay or fail a Deal the buyer has
//   already made.
//
//   IT NEVER DELAYS THE REAFFIRMATION REQUEST. For the same reason: the reaffirmation seam is
//   enqueued on the selection path, not behind this. Asking someone for $400 must never sit in
//   front of telling a dealership it won.
//
//   THE FULL SUPPRESSION SET APPLIES, INCLUDING ANY OPEN EXCEPTION. That last one is PAY-73, which
//   Phase 3 deferred and the owner ruled into this phase — and it matters most exactly here, since
//   touchpoint 3 fires at the moment an approval-expired or over-budget case is most likely open.
//
// GET decides and, when it says yes, RECORDS THE IMPRESSION — which is also how "once" is
// enforced, so a buyer who refreshes the page does not see it again.
// POST records the outcome: a dismissal, which schedules touchpoint 4.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  isUpgradePromptSuppressed,
  UPGRADE_TOUCHPOINTS,
} from "@/lib/services/plan/upgrade-suppression.service";
import {
  hasBeenShown,
  recordImpression,
  recordDismissal,
  upgradeAskCounts,
} from "@/lib/services/plan/upgrade-touchpoint.service";
import { quotePremiumBalance } from "@/lib/services/plan/upgrade-window.service";
import {
  enqueueTransactional,
  raiseNoDeliverableChannel,
} from "@/lib/services/comms/transactional-dispatcher.service";
import { PHASE_6_TEMPLATES } from "@/lib/services/comms/state-recheck-registry";
import { renderPremiumFollowUp } from "@/lib/services/comms/phase6-email-content";
import { limitGeneral } from "@/lib/security/rate-limit";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").replace(/\/+$/, "");
/** §23.2a: "Email one hour after acceptance". */
const FOLLOW_UP_DELAY_MS = 60 * 60 * 1000;

/**
 * The buyer's own Deal, or null. Ownership is checked on the DEAL, never taken from the body —
 * a dealId from an attacker would otherwise disclose whether someone else's transaction is in an
 * exception state through the suppression reason.
 */
async function ownedDeal(dealId: string, buyerId: string) {
  return prisma.deal.findFirst({
    where: { id: dealId, buyerId },
    select: { id: true, vehicleRequestId: true },
  });
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const dealId = new URL(request.url).searchParams.get("dealId");
  if (!dealId) return errorResponse("VALIDATION_ERROR", "dealId is required", 400);

  const deal = await ownedDeal(dealId, buyer.id);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  if (!deal.vehicleRequestId) {
    // §23.1 elects the plan PER REQUEST, so a Deal with no request has nothing to elect against.
    return successResponse({ show: false, reason: "no_request" });
  }

  // ONCE. Checked before the suppression set so a repeat view costs one indexed read rather than
  // a Supabase round trip and a queue scan.
  if (await hasBeenShown(buyer.id, deal.vehicleRequestId, UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE)) {
    return successResponse({ show: false, reason: "already_shown" });
  }

  const counts = await upgradeAskCounts(buyer.id, deal.vehicleRequestId);
  const decision = await isUpgradePromptSuppressed({
    vehicleRequestId: deal.vehicleRequestId,
    buyerId: buyer.id,
    touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE,
    emailsSent: counts.emailsSent,
    declines: counts.declines,
  });
  if (decision.suppressed) {
    // The REASON is not returned to the client. "An exception is open on your transaction" or "a
    // dispute is on your deposit" is information the buyer should get from the surface that owns
    // it, with its own copy — not leaked through the answer to "may I show an upsell".
    logger.info(`[premium-invitation] suppressed for ${deal.id}: ${decision.reason}`);
    return successResponse({ show: false, reason: "suppressed" });
  }

  const quote = await quotePremiumBalance(deal.vehicleRequestId);

  // Recorded as part of deciding to show it, not by the client afterwards: a client that renders
  // and then fails to report would show the "once" invitation twice.
  const first = await recordImpression({
    buyerId: buyer.id,
    vehicleRequestId: deal.vehicleRequestId,
    touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE,
    detail: { dealId: deal.id },
  });
  if (!first) return successResponse({ show: false, reason: "already_shown" });

  return successResponse({ show: true, balance: quote });
}

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: { dealId?: string; action?: string };
  try {
    body = (await request.json()) as { dealId?: string; action?: string };
  } catch {
    return errorResponse("BAD_REQUEST", "Invalid JSON body", 400);
  }
  if (!body.dealId) return errorResponse("VALIDATION_ERROR", "dealId is required", 400);
  if (body.action !== "dismiss") {
    // Only the dismissal is recorded here. A CONVERSION is recorded by the upgrade route, which is
    // the only place that knows the upgrade actually happened — recording it from a client button
    // press would count intentions as conversions.
    return errorResponse("VALIDATION_ERROR", 'action must be "dismiss"', 400);
  }

  // Abuse guard on the write, the same shape `POST /api/buyer/plan/upgrade` uses and fails OPEN
  // on a store outage for the same reason. `recordDismissal` appends a `buyer_activity_events` row
  // unconditionally — `recordImpression` is idempotent per touchpoint, this is not — so an
  // authenticated buyer looping this endpoint writes unbounded rows. The email is already safe
  // (`enqueueTransactional` dedupes on the request-scoped key); what this bounds is storage and
  // the cost of every later `eventsOfType` read.
  const rl = await limitGeneral(`plan-invitation:${buyer.id}`, { tokens: 10, window: "10 m" });
  if (!rl.ok) return errorResponse("RATE_LIMITED", rl.message, rl.status);

  const deal = await ownedDeal(body.dealId, buyer.id);
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  if (!deal.vehicleRequestId) return successResponse({ recorded: false });

  await recordDismissal({
    buyerId: buyer.id,
    vehicleRequestId: deal.vehicleRequestId,
    touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE,
    detail: { dealId: deal.id },
  });

  // §23.2a touchpoint 4, scheduled — not decided. The send-time recheck re-evaluates the entire
  // suppression set an hour from now, because that hour is exactly when a dispute lands, an
  // exception opens, or the buyer upgrades from this very invitation's own link.
  await scheduleFollowUp(buyer.id, deal.vehicleRequestId, deal.id).catch((e) =>
    // Non-blocking: the dismissal is recorded and the buyer's deal is unaffected. A follow-up that
    // fails to schedule is an ask that does not happen, which §23.2b treats as the safe outcome.
    logger.error("[premium-invitation] follow-up not scheduled:", e),
  );

  return successResponse({ recorded: true });
}

async function scheduleFollowUp(buyerId: string, vehicleRequestId: string, dealId: string): Promise<void> {
  const contact = await prisma.buyer.findUnique({
    where: { id: buyerId },
    select: { firstName: true, user: { select: { email: true } } },
  });
  const email = contact?.user?.email;
  if (!email) {
    // THE ONE JUDGEMENT CALL in applying the 2026-09-14 ruling, made deliberately and flagged in
    // the phase report rather than assumed.
    //
    // Against raising: touchpoint 4 is an UPSELL, not a §27.1-required notice about the buyer's
    // transaction, and §23.2b treats a missing ask as the safe outcome. An Operations queue whose
    // value depends on every row being actionable should not fill with lost upsells.
    //
    // For raising, which is what this does: the code is about the CHANNEL, not the message's
    // commercial importance. The fact discovered here — this buyer can receive no email at all —
    // is the same fact the close path discovers about the same buyer, and §23.2b's "safe outcome"
    // governs whether to ASK, not whether to REPORT. This was also the only one of the five sites
    // with no log line at all: the condition was discovered and discarded in total silence.
    await raiseNoDeliverableChannel({
      templateKey: PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP,
      channel: "email",
      // Request-scoped, matching the outbox key's own scoping below: §23.4 gives a second Vehicle
      // Request its own fresh plan election.
      outboxKey: `${PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP}:email:${vehicleRequestId}`,
      recipientKind: "buyer",
      recipientId: buyerId,
      refs: { vehicleRequestId, dealId, buyerId },
    });
    return;
  }

  const quote = await quotePremiumBalance(vehicleRequestId);
  const rendered = renderPremiumFollowUp({
    firstName: contact?.firstName ?? null,
    balanceDueUsd: `$${(quote.dueCents / 100).toLocaleString()}`,
    upgradeUrl: `${APP_URL}/buyer/plan/premium`,
  });

  // Channel-qualified and REQUEST-scoped: §23.4 gives a second Vehicle Request its own fresh plan
  // election, so a buyer's second transaction must not silently dedupe against their first.
  const key = `${PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP}:email:${vehicleRequestId}`;
  await enqueueTransactional({
    triggerEvent: "plan.premium_invitation_dismissed",
    templateKey: PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP,
    channel: "email",
    recipientKind: "buyer",
    recipientId: buyerId,
    to: email,
    vehicleRequestId,
    dealId,
    idempotencyKey: key,
    runAt: new Date(Date.now() + FOLLOW_UP_DELAY_MS),
    payload: {
      email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      type: "transactional",
      idempotencyKey: key,
    },
  });
}
