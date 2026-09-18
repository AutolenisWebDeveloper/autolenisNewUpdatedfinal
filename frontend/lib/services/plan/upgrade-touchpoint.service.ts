// lib/services/plan/upgrade-touchpoint.service.ts
//
// §23.2a — THE IMPRESSION, DISMISSAL AND CONVERSION RECORD for the five upgrade touchpoints.
//
// PHASE 3 DELIBERATELY DID NOT BUILD THIS, and said so: "the impression/dismissal COUNTERS are not
// built: the only touchpoint this phase ships is touchpoint 1, and the four that follow — and
// therefore everything there is to count — belong to later phases. Stated rather than stubbed."
// Phase 6 ships touchpoints 2, 3 and 4, so the counting is now due.
//
// IT IS ALSO NOT OPTIONAL TELEMETRY. `isUpgradePromptSuppressed` takes `declines` and `emailsSent`
// as INPUTS and throws if an email touchpoint arrives without a count — §23.2b's "two emails, then
// silence" and "a buyer who declines twice is not asked again" are ceilings that cannot be reached
// unless something counts. This is that something.
//
// NO NEW TABLE. `buyer_activity_events` already carries per-buyer, typed, timestamped events with
// a JSON payload and a `(buyer_id, created_at)` index, and the plan-upgrade path already writes
// `PLAN_UPGRADED` there. A dedicated table would be a second place to look for the same question.
//
// THE COUNTS ARE DERIVED, NEVER STORED. A stored counter is a number that can drift from the
// events it summarises; deriving means the ceiling is always computed from what actually happened.
//
// Run: pnpm test:buyer-plan

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
// From the LEAF module, never from `upgrade-suppression.service` — that file is in an import
// cycle with `plan-snapshot.service`, and joining it from here put the constants in their temporal
// dead zone at run time while `tsc` stayed perfectly happy.
import { EMAIL_TOUCHPOINTS, UPGRADE_TOUCHPOINTS, type UpgradeTouchpoint } from "./upgrade-touchpoints";

type Db = typeof prisma | Prisma.TransactionClient;

/**
 * What happened at a touchpoint. §23.2a asks for all three, and each answers a different question:
 * impressions say whether the ask was ever made, dismissals feed §23.2b's decline ceiling, and
 * conversions are the numerator the whole measurement exists for.
 */
export const UPGRADE_EVENTS = {
  IMPRESSION: "PREMIUM_PROMPT_SHOWN",
  DISMISSAL: "PREMIUM_PROMPT_DISMISSED",
  CONVERSION: "PREMIUM_PROMPT_CONVERTED",
} as const;

export type UpgradeEventType = (typeof UPGRADE_EVENTS)[keyof typeof UPGRADE_EVENTS];

export interface RecordTouchpointInput {
  buyerId: string;
  vehicleRequestId: string | null;
  touchpoint: UpgradeTouchpoint;
  /** Free-form context — the deal or auction the prompt appeared on, for a funnel query. */
  detail?: Record<string, unknown>;
}

const TITLES: Record<UpgradeEventType, string> = {
  [UPGRADE_EVENTS.IMPRESSION]: "Premium invitation shown",
  [UPGRADE_EVENTS.DISMISSAL]: "Premium invitation dismissed",
  [UPGRADE_EVENTS.CONVERSION]: "Upgraded to Premium from an invitation",
};

async function record(
  event: UpgradeEventType,
  input: RecordTouchpointInput,
  db: Db,
): Promise<void> {
  await db.buyerActivityEvent.create({
    data: {
      buyerId: input.buyerId,
      eventType: event,
      title: TITLES[event],
      metadata: {
        touchpoint: input.touchpoint,
        vehicleRequestId: input.vehicleRequestId,
        ...(input.detail ?? {}),
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * The ask was made. Recorded ONCE PER TOUCHPOINT PER REQUEST, because §23.2a's touchpoint 3 is
 * "the full-screen invitation, ONCE, immediately after offer acceptance" and an impression row is
 * how "once" is enforced — `hasBeenShown` below reads exactly this.
 *
 * Returns whether a row was written. `false` means the touchpoint had already fired, which is the
 * caller's signal not to render.
 */
export async function recordImpression(input: RecordTouchpointInput, db: Db = prisma): Promise<boolean> {
  if (await hasBeenShown(input.buyerId, input.vehicleRequestId, input.touchpoint, db)) return false;
  await record(UPGRADE_EVENTS.IMPRESSION, input, db);
  return true;
}

/** The buyer said no, or closed it. Feeds §23.2b's decline ceiling. */
export async function recordDismissal(input: RecordTouchpointInput, db: Db = prisma): Promise<void> {
  await record(UPGRADE_EVENTS.DISMISSAL, input, db);
}

/**
 * The buyer upgraded from this touchpoint. PAY-77's numerator.
 *
 * Best-effort and non-blocking at the call site: the upgrade itself is recorded by
 * `recordPlanElection`, which stamps the same touchpoint onto `plan_snapshots`. This row is the
 * funnel's view of the same fact, and losing it must never fail an upgrade the buyer has paid for.
 */
export async function recordConversion(input: RecordTouchpointInput, db: Db = prisma): Promise<void> {
  try {
    await record(UPGRADE_EVENTS.CONVERSION, input, db);
  } catch (e) {
    logger.error("[upgrade-touchpoint] conversion event failed (the upgrade stands):", e);
  }
}

/** Has this exact touchpoint already been shown for this request? §23.2a's "once". */
export async function hasBeenShown(
  buyerId: string,
  vehicleRequestId: string | null,
  touchpoint: UpgradeTouchpoint,
  db: Db = prisma,
): Promise<boolean> {
  // The touchpoint and the request id live in the JSON payload, which Prisma cannot filter on
  // portably, so the query narrows on the indexed `(buyer_id, event_type)` and the match happens in
  // memory. The set is small by construction — at most five touchpoints per request.
  const rows = await impressionsFor(buyerId, vehicleRequestId, db);
  return rows.some((r) => r.touchpoint === touchpoint);
}

interface TouchpointRow {
  touchpoint: string | null;
  vehicleRequestId: string | null;
  createdAt: Date;
}

async function eventsOfType(
  type: UpgradeEventType,
  buyerId: string,
  vehicleRequestId: string | null,
  db: Db,
): Promise<TouchpointRow[]> {
  const rows = await db.buyerActivityEvent.findMany({
    where: { buyerId, eventType: type },
    select: { metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    // A ceiling of two is the rule; a bound of 200 is far past any honest history and stops a
    // pathological row count turning a page render into a scan.
    take: 200,
  });
  return rows
    .map((r) => {
      const m = (r.metadata ?? {}) as { touchpoint?: string; vehicleRequestId?: string | null };
      return { touchpoint: m.touchpoint ?? null, vehicleRequestId: m.vehicleRequestId ?? null, createdAt: r.createdAt };
    })
    // SCOPED TO THE REQUEST. §23.4: "a buyer starts a second Vehicle Request → new request, new
    // $99, fresh plan election." Counting across requests would carry a decline from a finished
    // transaction into a new one and silence an ask the buyer never refused.
    .filter((r) => (vehicleRequestId === null ? true : r.vehicleRequestId === vehicleRequestId));
}

async function impressionsFor(buyerId: string, vehicleRequestId: string | null, db: Db): Promise<TouchpointRow[]> {
  return eventsOfType(UPGRADE_EVENTS.IMPRESSION, buyerId, vehicleRequestId, db);
}

/**
 * The two counts `isUpgradePromptSuppressed` requires, derived from the event record.
 *
 * `emailsSent` counts IMPRESSIONS of the email touchpoints rather than outbox rows: an outbox row
 * that was skipped by its send-time recheck was never an ask, and §23.2b's ceiling is on asks.
 */
export async function upgradeAskCounts(
  buyerId: string,
  vehicleRequestId: string | null,
  db: Db = prisma,
): Promise<{ emailsSent: number; declines: number }> {
  const [impressions, dismissals] = await Promise.all([
    impressionsFor(buyerId, vehicleRequestId, db),
    eventsOfType(UPGRADE_EVENTS.DISMISSAL, buyerId, vehicleRequestId, db),
  ]);
  const emailTouchpoints = new Set<string>(EMAIL_TOUCHPOINTS);
  return {
    emailsSent: impressions.filter((r) => r.touchpoint && emailTouchpoints.has(r.touchpoint)).length,
    declines: dismissals.length,
  };
}

/**
 * §23.2a TOUCHPOINT 5 — "Email at dealer reaffirmation or recap. The second and final ask."
 *
 * PHASE 10, the enqueue site `PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL` never had.
 * `renderPremiumFollowUpFinal` and the template's registry entry were both written in Phase 7 —
 * the entry even carries a note explaining that its `alwaysSend` recheck is safe *because
 * suppression is evaluated here, before the row is enqueued*. That note described a caller that
 * did not exist, so the last ask §23.2a promises was never made, and `MAX_UPGRADE_EMAILS = 2`
 * was a ceiling one ask below the floor.
 *
 * ── WHERE THE SUPPRESSION DECISION LIVES, AND WHY IT IS HERE ────────────────
 *
 * §23.2b's rules are a property of the PLAN area: two emails then silence, two declines then
 * silence, and never during a cancellation, a chargeback or an open exception. Putting this in
 * the recap service would put that policy in a service whose job is arithmetic, and the next
 * caller would either duplicate it or forget it. The recap service calls this; it does not
 * decide anything.
 *
 * ── WHY THE IMPRESSION IS RECORDED BEFORE THE ENQUEUE ───────────────────────
 *
 * `upgradeAskCounts` counts IMPRESSIONS of email touchpoints, and that count is what stops a
 * third ask. Recording after a successful enqueue would be the obvious order and is the wrong
 * one: `recordImpression` is also the once-per-touchpoint guard, so a crash between the enqueue
 * and the record would leave a sent email with no impression — and the NEXT recap version would
 * ask again, under a ceiling that could not see the first. Recording first can at worst cost a
 * buyer an ask they were entitled to, which §23.2b names as the safe direction.
 *
 * Returns why nothing was sent, so a caller can log a reason rather than a silence.
 */
export async function sendFinalPremiumAsk(
  input: { buyerId: string; vehicleRequestId: string; dealId: string },
  db: Db = prisma,
): Promise<{ sent: boolean; reason: string }> {
  const { isUpgradePromptSuppressed } = await import("./upgrade-suppression.service");
  const counts = await upgradeAskCounts(input.buyerId, input.vehicleRequestId, db);

  const decision = await isUpgradePromptSuppressed(
    {
      vehicleRequestId: input.vehicleRequestId,
      buyerId: input.buyerId,
      touchpoint: UPGRADE_TOUCHPOINTS.REAFFIRMATION_EMAIL,
      emailsSent: counts.emailsSent,
      declines: counts.declines,
    },
    db,
  );
  if (decision.suppressed) return { sent: false, reason: decision.reason };

  // Once per request. A recap that is superseded and re-published is the same transaction and
  // the same ask; §23.4 gives a SECOND vehicle request its own election, and the touchpoint
  // record is request-scoped, so that one is asked afresh.
  const first = await recordImpression(
    {
      buyerId: input.buyerId,
      vehicleRequestId: input.vehicleRequestId,
      touchpoint: UPGRADE_TOUCHPOINTS.REAFFIRMATION_EMAIL,
      detail: { dealId: input.dealId },
    },
    db,
  );
  if (!first) return { sent: false, reason: "already_asked" };

  const buyer = await db.buyer.findUnique({
    where: { id: input.buyerId },
    select: { firstName: true, user: { select: { email: true } } },
  });
  const email = buyer?.user?.email;
  if (!email) return { sent: false, reason: "no_email" };

  const { quotePremiumBalance } = await import("./upgrade-window.service");
  const quote = await quotePremiumBalance(input.vehicleRequestId, db);
  // A zero or negative balance is not an upsell — there is nothing to buy. Reached when the
  // credit already covers the fee, and quoting "$0 for a concierge" would be nonsense.
  if (quote.dueCents <= 0) return { sent: false, reason: "nothing_due" };

  const { renderPremiumFollowUpFinal } = await import("@/lib/services/comms/phase7-email-content");
  const { enqueueTransactional } = await import("@/lib/services/comms/transactional-dispatcher.service");
  const { PHASE_7_TEMPLATES } = await import("@/lib/services/comms/state-recheck-registry");

  const content = renderPremiumFollowUpFinal({
    firstName: buyer?.firstName ?? "there",
    balanceCents: quote.dueCents,
    dealId: input.dealId,
  });
  const key = `${PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL}:email:${input.vehicleRequestId}`;
  await enqueueTransactional(
    {
      triggerEvent: "plan.premium_final_ask",
      templateKey: PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL,
      channel: "email",
      recipientKind: "buyer",
      recipientId: input.buyerId,
      to: email,
      vehicleRequestId: input.vehicleRequestId,
      dealId: input.dealId,
      idempotencyKey: key,
      payload: { email, subject: content.subject, html: content.html, text: content.text },
    },
    db,
  );
  return { sent: true, reason: "enqueued" };
}
