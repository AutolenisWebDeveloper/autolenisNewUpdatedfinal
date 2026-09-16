// lib/services/comms/state-recheck-registry.ts
//
// §27's send-time state recheck, as a registry keyed by template.
//
//   "All transactional email, SMS, and in-app notices dispatch through the durable
//    outbox with: trigger event, recipient, template and required content, A
//    SEND-TIME STATE RECHECK, an idempotency key, delivery status, retry policy,
//    cancellation rule, and a terminal-failure Operations alert."
//
// WHY A RECHECK AT ALL. An outbox row is written when a trigger fires and
// delivered some time later. In between, the thing it is about can change: the
// buyer verifies the email the reminder is chasing, the deposit settles before the
// "$99 unpaid" touch goes out, the request is cancelled before the four-touch draft
// recovery finishes. Without a recheck the outbox faithfully delivers messages that
// have become false. The recheck re-reads live state at dispatch and returns
// `skip` — which writes `status='skipped'` — instead of sending.
//
// WHY REGISTRATION IS MANDATORY. `enqueueTransactional()` refuses a template with
// no registered recheck. A template that genuinely has nothing to re-read
// registers `alwaysSend(reason)` and states why in one line. That is one more
// character than forgetting, and it turns "no recheck" from an invisible default
// into a reviewable declaration.
//
// Run: pnpm test:comms-outbox

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_REQUEST_STATUSES } from "@/lib/services/vehicle-request/open-request.service";

/** What the recheck saw and decided. */
export type StateRecheckDecision = { proceed: true } | { proceed: false; reason: string };

/** The refs carried on the outbox row, as the recheck sees them. */
export interface StateRecheckContext {
  templateKey: string;
  triggerEvent: string;
  vehicleRequestId: string | null;
  dealId: string | null;
  auctionId: string | null;
  recipientKind: string | null;
  recipientId: string | null;
  payload: Record<string, unknown>;
  db: typeof prisma | Prisma.TransactionClient;
}

export type StateRecheckFn = (ctx: StateRecheckContext) => Promise<StateRecheckDecision>;

interface Registration {
  fn: StateRecheckFn;
  /** Why this template needs no live read, when it does not. */
  alwaysSendReason?: string;
}

const REGISTRY = new Map<string, Registration>();

/**
 * A recheck for a template whose trigger cannot become false. The reason is
 * mandatory and is the whole point of the helper: it is what a reviewer reads.
 *
 * The reason is CARRIED on the returned function rather than validated and thrown
 * away, so `registerStateRecheck` records it whether or not the caller remembers
 * to pass a third argument. It was only half-implemented before: six of eight
 * registrations passed one, two did not, and the reason those two gave existed
 * nowhere the registry could show it.
 */
export function alwaysSend(reason: string): StateRecheckFn {
  if (!reason.trim()) throw new Error("alwaysSend() requires a reason");
  const fn: StateRecheckFn = async () => ({ proceed: true });
  (fn as StateRecheckFn & { alwaysSendReason?: string }).alwaysSendReason = reason;
  return fn;
}

/** Register the recheck for one template key. Re-registration replaces. */
export function registerStateRecheck(templateKey: string, fn: StateRecheckFn, alwaysSendReason?: string): void {
  const carried = (fn as StateRecheckFn & { alwaysSendReason?: string }).alwaysSendReason;
  REGISTRY.set(templateKey, { fn, alwaysSendReason: alwaysSendReason ?? carried });
}

/** The declared reason a template needs no live read, when it declared one. */
export function alwaysSendReasonFor(templateKey: string): string | null {
  return REGISTRY.get(templateKey)?.alwaysSendReason ?? null;
}

/** Is this template dispatchable? `enqueueTransactional` refuses when it is not. */
export function hasStateRecheck(templateKey: string): boolean {
  return REGISTRY.has(templateKey);
}

/** Every registered template key, sorted. Used by the completeness tests. */
export function registeredTemplateKeys(): string[] {
  return [...REGISTRY.keys()].sort();
}

/**
 * Run the recheck. An unregistered template FAILS CLOSED — it is skipped rather
 * than sent, because a message whose truth cannot be re-established is a message
 * that may already be false.
 */
export async function runStateRecheck(ctx: StateRecheckContext): Promise<StateRecheckDecision> {
  const reg = REGISTRY.get(ctx.templateKey);
  if (!reg) {
    return {
      proceed: false,
      reason: `no state recheck registered for template "${ctx.templateKey}" — refusing to send a message whose truth cannot be re-established`,
    };
  }
  return reg.fn(ctx);
}

// ---------------------------------------------------------------------------
// Phase 2 templates. Each is registered here, next to the others, so the set a
// reader has to hold in their head is one file rather than N call sites.
// ---------------------------------------------------------------------------

/** The template keys Phase 2 enqueues. §27.1, rows 1-11. */
export const PHASE_2_TEMPLATES = {
  REGISTRATION_SUBMITTED: "registration_submitted",
  VERIFICATION_COMPLETED: "verification_completed",
  ONBOARDING_INCOMPLETE: "onboarding_incomplete",
  GUEST_CAPTURE_CLAIM: "guest_capture_claim",
  /**
   * A visitor submitted a Lane 1 form using an address that belongs to a
   * REGISTERED account, without a session. Rule 16 attaches nothing; this is the
   * link the surface tells them it sent. Distinct from GUEST_CAPTURE_CLAIM, whose
   * recheck skips a buyer who is no longer a guest — which is every recipient of
   * THIS message.
   */
  REGISTERED_CLAIM_PROMPT: "registered_claim_prompt",
  DRAFT_RECOVERY_1: "draft_recovery_1",
  DRAFT_RECOVERY_2: "draft_recovery_2",
  DRAFT_RECOVERY_3: "draft_recovery_3",
  DRAFT_RECOVERY_4: "draft_recovery_4",
  VERIFICATION_REMINDER_1H: "verification_reminder_1h",
  VERIFICATION_REMINDER_24H: "verification_reminder_24h",
  VERIFICATION_REMINDER_72H: "verification_reminder_72h",
  APPLICATION_SUBMITTED_ADMIN: "application_submitted_admin",
  PREQUAL_APPROVED: "prequal_approved",
  PREQUAL_UNDER_REVIEW: "prequal_under_review",
  PREQUAL_PROVIDER_DELAY: "prequal_provider_delay",
  PREQUAL_DECLINED: "prequal_declined",
  PREQUAL_EXPIRING: "prequal_expiring",
  PREQUAL_EXPIRED: "prequal_expired",
} as const;

export type Phase2TemplateKey = (typeof PHASE_2_TEMPLATES)[keyof typeof PHASE_2_TEMPLATES];

/**
 * Phase 3, §5c — the six-touch $99 series. The keys are the SAME strings the
 * `lifecycle_touch_schedule` sequence names used, so an operator comparing an
 * in-flight legacy row with a new outbox row sees one vocabulary.
 */
export const DEPOSIT_REMINDER_TEMPLATES = {
  DEPOSIT_REMINDER_1: "deposit_reminder_1",
  DEPOSIT_REMINDER_2: "deposit_reminder_2",
  DEPOSIT_REMINDER_3: "deposit_reminder_3",
  DEPOSIT_REMINDER_4: "deposit_reminder_4",
  DEPOSIT_REMINDER_5: "deposit_reminder_5",
  DEPOSIT_REMINDER_6: "deposit_reminder_6",
} as const;

export type DepositReminderTemplateKey =
  (typeof DEPOSIT_REMINDER_TEMPLATES)[keyof typeof DEPOSIT_REMINDER_TEMPLATES];

/**
 * A verified buyer no longer needs to be told to verify.
 *
 * `users` carries no email-verification column — verification lives in Supabase
 * Auth. The Prisma-visible fact that stands for it is the `supabaseId` prefix: a
 * buyer captured by a public form gets `guest_<uuid>`
 * (`unified-buyer-intake.service.ts:162-168`), and a real Supabase identity is
 * only written by `ensurePrismaUser` at `/auth/callback`, which is reached by
 * clicking the verification link. So a non-`guest_` supabaseId IS "verified", and
 * this reads the signal the system actually has rather than inventing a column.
 */
const skipIfVerified: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const buyer = await ctx.db.buyer.findUnique({
    where: { id: ctx.recipientId },
    select: { isGuest: true, user: { select: { supabaseId: true } } },
  });
  if (!buyer) return { proceed: false, reason: "buyer no longer exists" };
  const verified = Boolean(buyer.user?.supabaseId) && !buyer.user!.supabaseId.startsWith("guest_") && !buyer.isGuest;
  if (verified) return { proceed: false, reason: "buyer verified before this reminder was due" };
  return { proceed: true };
};

/** A completed onboarding no longer needs an "onboarding incomplete" nudge. */
const skipIfOnboardingComplete: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const buyer = await ctx.db.buyer.findUnique({ where: { id: ctx.recipientId }, select: { onboardingComplete: true } });
  if (buyer?.onboardingComplete) return { proceed: false, reason: "onboarding completed before this reminder was due" };
  return { proceed: true };
};

/**
 * A draft that has been submitted, cancelled, or claimed no longer needs a
 * recovery touch. This is the recheck §6.4's four-touch sequence turns on: without
 * it, a buyer who finishes their request keeps being asked to finish it.
 */
const skipIfRequestNoLongerDraft: StateRecheckFn = async (ctx) => {
  if (!ctx.vehicleRequestId) return { proceed: false, reason: "draft recovery with no vehicle request reference" };
  const vr = await ctx.db.vehicleRequest.findUnique({
    where: { id: ctx.vehicleRequestId },
    select: { status: true, abandonedAt: true },
  });
  if (!vr) return { proceed: false, reason: "vehicle request no longer exists" };
  if (vr.status !== "DRAFT") return { proceed: false, reason: `request advanced to ${vr.status}` };
  if (vr.abandonedAt) return { proceed: false, reason: "request already marked abandoned" };
  return { proceed: true };
};

/** A guest whose request has been claimed no longer needs the claim link. */
const skipIfAlreadyClaimed: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const buyer = await ctx.db.buyer.findUnique({ where: { id: ctx.recipientId }, select: { isGuest: true } });
  if (buyer && !buyer.isGuest) return { proceed: false, reason: "guest already claimed their account" };
  return { proceed: true };
};

/**
 * PAY-21 / PAY-23 — the $99 series must stop the moment the money question is answered
 * OR the request it is about goes away.
 *
 * THREE READS, and the third is the one the rail it replaces never did.
 *
 *   1. THE REQUEST. `lifecycle_touch_schedule` keyed the series to the BUYER and its
 *      guard read only deposits and account flags, so cancelling, closing or expiring
 *      a request left the series chasing money for it. A request that is no longer
 *      open is the clearest possible "stop".
 *   2. THE MONEY, via `depositConversionResolved` — the guard the old rail used,
 *      reused rather than reimplemented so the two cannot answer differently while
 *      legacy rows are still draining. It stops on a PAID deposit, on no PENDING
 *      deposit remaining (which is how REFUNDED, FAILED and DISPUTED all stop), and on
 *      an administratively halted buyer.
 *   3. FAIL CLOSED. No request reference, no request row, or a throw — none of those
 *      is permission to ask someone for money.
 *
 * The dispute/refund HOLD is covered twice over and deliberately: `applyFulfillmentHold`
 * cancels the rows outright by cancel key, and if that cancellation ever failed, the
 * held deposit has left PENDING so this recheck refuses the send anyway. A cancelled
 * row and a refused send are both silence; two independent paths to it is the right
 * number for a message that would otherwise dun a buyer mid-chargeback.
 */
const skipIfDepositResolvedOrRequestClosed: StateRecheckFn = async (ctx) => {
  if (!ctx.vehicleRequestId) {
    return { proceed: false, reason: "deposit reminder with no vehicle request reference" };
  }
  const vr = await ctx.db.vehicleRequest.findUnique({
    where: { id: ctx.vehicleRequestId },
    select: { status: true },
  });
  if (!vr) return { proceed: false, reason: "vehicle request no longer exists" };
  if (!OPEN_REQUEST_STATUSES.includes(vr.status)) {
    return { proceed: false, reason: `request is ${vr.status} — no longer open` };
  }

  if (!ctx.recipientId) return { proceed: false, reason: "deposit reminder with no buyer reference" };
  const { depositConversionResolved } = await import("@/lib/qstash/state");
  if (await depositConversionResolved(ctx.recipientId)) {
    return { proceed: false, reason: "deposit resolved — paid, no longer pending, or buyer halted" };
  }

  return { proceed: true };
};

/** An approval that has been renewed does not need its expiry warning. */
const skipIfPrequalRenewed: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const pq = await ctx.db.preQualification.findFirst({
    where: { buyerId: ctx.recipientId },
    orderBy: { createdAt: "desc" },
    select: { expiresAt: true, decision: true },
  });
  if (!pq) return { proceed: false, reason: "no prequalification on file" };
  const warnedAbout = ctx.payload.prequalExpiresAt;
  if (typeof warnedAbout === "string" && pq.expiresAt && pq.expiresAt.toISOString() !== warnedAbout) {
    return { proceed: false, reason: "approval was renewed after this warning was scheduled" };
  }
  return { proceed: true };
};

registerStateRecheck(PHASE_2_TEMPLATES.REGISTRATION_SUBMITTED, alwaysSend("the verification link is the registration's own artefact; there is no later state that makes it false"), "sent at registration");
registerStateRecheck(PHASE_2_TEMPLATES.VERIFICATION_COMPLETED, alwaysSend("a completed verification cannot un-complete"), "sent on verification");
registerStateRecheck(PHASE_2_TEMPLATES.ONBOARDING_INCOMPLETE, skipIfOnboardingComplete);
registerStateRecheck(PHASE_2_TEMPLATES.GUEST_CAPTURE_CLAIM, skipIfAlreadyClaimed);
registerStateRecheck(
  PHASE_2_TEMPLATES.REGISTERED_CLAIM_PROMPT,
  alwaysSend(
    "the account existing is the REASON for this message, not a reason to withhold it; the visitor has already been told a link was sent"
  ),
  "rule-16 claim link"
);
registerStateRecheck(PHASE_2_TEMPLATES.DRAFT_RECOVERY_1, skipIfRequestNoLongerDraft);
registerStateRecheck(PHASE_2_TEMPLATES.DRAFT_RECOVERY_2, skipIfRequestNoLongerDraft);
registerStateRecheck(PHASE_2_TEMPLATES.DRAFT_RECOVERY_3, skipIfRequestNoLongerDraft);
registerStateRecheck(PHASE_2_TEMPLATES.DRAFT_RECOVERY_4, skipIfRequestNoLongerDraft);
registerStateRecheck(PHASE_2_TEMPLATES.VERIFICATION_REMINDER_1H, skipIfVerified);
registerStateRecheck(PHASE_2_TEMPLATES.VERIFICATION_REMINDER_24H, skipIfVerified);
registerStateRecheck(PHASE_2_TEMPLATES.VERIFICATION_REMINDER_72H, skipIfVerified);
registerStateRecheck(PHASE_2_TEMPLATES.APPLICATION_SUBMITTED_ADMIN, alwaysSend("an administrative receipt records that an application was submitted; a later outcome does not unmake the submission"), "admin receipt");
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_APPROVED, alwaysSend("the decision communication IS the outcome; suppressing it would leave the buyer with no decision"), "decision notice");
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_UNDER_REVIEW, alwaysSend("an honest status notice about a review that has begun"), "status notice");
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_PROVIDER_DELAY, alwaysSend("a delay notice about a delay that occurred"), "status notice");
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_DECLINED, alwaysSend("adverse-action information is required regardless of any later state"), "compliance notice");
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_EXPIRING, skipIfPrequalRenewed);
registerStateRecheck(PHASE_2_TEMPLATES.PREQUAL_EXPIRED, skipIfPrequalRenewed);

// Phase 3 — the six §5c deposit reminders. All six share one recheck: they say the
// same thing at six different times, so they stop for the same reasons.
for (const key of Object.values(DEPOSIT_REMINDER_TEMPLATES)) {
  registerStateRecheck(key, skipIfDepositResolvedOrRequestClosed);
}

// ---------------------------------------------------------------------------
// Phase 4 — the two dealer notices the stale sweep sends.
//
// They were the last direct `sendIdempotent` calls on a scheduled path
// (jobs/I-22). §27 requires every transactional message to dispatch through the
// durable outbox, and the direct rail applies NO suppression — so a dealer who
// bounced or unsubscribed was re-emailed on every sweep, nightly, forever.
// ---------------------------------------------------------------------------

/** Template keys the inventory stale sweep enqueues. */
export const INVENTORY_DEALER_TEMPLATES = {
  STALE_LISTING_REMOVAL: "dealer_stale_listing_removal",
  INVENTORY_SYNC_FAILURE: "dealer_inventory_sync_failure",
} as const;

/**
 * A terminated dealer does not need a listing-hygiene notice.
 *
 * NOT `alwaysSend`. The deactivation itself cannot un-happen, which is the tempting
 * argument for sending regardless — but the RECIPIENT can stop being someone we write to
 * between the sweep enqueueing and the outbox draining, and that is precisely the state
 * §27's recheck exists to re-read.
 */
const skipIfDealerNoLongerActive: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const dealer = await ctx.db.dealer.findUnique({
    where: { id: ctx.recipientId },
    select: { status: true },
  });
  if (!dealer) return { proceed: false, reason: "dealer no longer exists" };
  if (dealer.status !== "ACTIVE") return { proceed: false, reason: `dealer is ${dealer.status}` };
  return { proceed: true };
};

/**
 * The feed recovered between the sweep and the drain — so the failure notice has become
 * false. The canonical shape of a §27 recheck: re-read the fact the message asserts.
 */
const skipIfFeedRecovered: StateRecheckFn = async (ctx) => {
  if (!ctx.recipientId) return { proceed: true };
  const dealer = await ctx.db.dealer.findUnique({
    where: { id: ctx.recipientId },
    select: { status: true },
  });
  if (!dealer) return { proceed: false, reason: "dealer no longer exists" };
  if (dealer.status !== "ACTIVE") return { proceed: false, reason: `dealer is ${dealer.status}` };
  // The same 24-hour window the sweep used to decide the feed had gone dark. Recomputed
  // here rather than carried on the payload, because the point is to read live state.
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const fresh = await ctx.db.inventoryItem.count({
    where: { dealerId: ctx.recipientId, lastSeenAt: { gte: cutoff } },
  });
  if (fresh > 0) return { proceed: false, reason: "the feed delivered fresh listings after this was queued" };
  return { proceed: true };
};

registerStateRecheck(INVENTORY_DEALER_TEMPLATES.STALE_LISTING_REMOVAL, skipIfDealerNoLongerActive);
registerStateRecheck(INVENTORY_DEALER_TEMPLATES.INVENTORY_SYNC_FAILURE, skipIfFeedRecovered);

// ---------------------------------------------------------------------------
// Phase 5 — Stage 6 sourcing and Stage 7 invitations.
//
// §27.1's sourcing/auction rows, plus the two buyer notices §6c and §26 require.
// Nine keys, because the 50%/90% dealer reminders and the 24h/72h radius reminders are
// distinct messages at distinct times and each needs its own dedup key.
//
// EVERY DEALER INVITATION AND REMINDER IS HERE RATHER THAN ON THE DIRECT RESEND RAIL, and
// that is defect 1's fix. The direct rail applies only HARD suppression
// (`resend.service.ts:168` → `isEmailHardSuppressed`, reasons bounced/complained/spam_trap),
// so a dealer who used AutoLenis' own one-click unsubscribe — which writes reason
// 'unsubscribed' and deliberately does not set `do_not_contact`
// (`app/api/public/dealer-unsubscribe/route.ts:15-26`) — stayed fully mailable by every
// invitation and every reminder, on addresses that never opted in, with no List-Unsubscribe
// header anywhere on that rail.
// ---------------------------------------------------------------------------

/** Template keys Phase 5 enqueues. §27.1 sourcing/auction rows; §6c and §26 buyer notices. */
export const PHASE_5_TEMPLATES = {
  /** §27.1 "Radius authorization needed" → Buyer. */
  RADIUS_AUTHORIZATION_NEEDED: "radius_authorization_needed",
  /** §Stage 6 "Remind at 24 and 72 hours". */
  RADIUS_AUTHORIZATION_REMINDER_24H: "radius_authorization_reminder_24h",
  RADIUS_AUTHORIZATION_REMINDER_72H: "radius_authorization_reminder_72h",
  /** §27.1 "Sourcing completed" → Buyer, "Auction preparation status". */
  SOURCING_COMPLETED: "sourcing_completed",
  /** §6c "disclosure of the field size to the buyer" on an audited limited auction. */
  SOURCING_LIMITED_FIELD: "sourcing_limited_field",
  /** §26 "Zero dealer coverage → ... buyer notice". Closure and refund stay separate. */
  SOURCING_NO_COVERAGE: "sourcing_no_coverage",
  /** §27.1 "Auction launched" → Buyer, "48-hour timeline and next step". */
  AUCTION_LAUNCHED: "auction_launched",
  /** §27.1 "Dealer invited" → Dealership. Carries NO buyer identity (§25.1). */
  DEALER_INVITED: "dealer_invited_secure",
  /** §Stage 7 "Nonresponders are reminded at 50% and 90% of the window". */
  DEALER_INVITATION_REMINDER_50: "dealer_invitation_reminder_50",
  DEALER_INVITATION_REMINDER_90: "dealer_invitation_reminder_90",
  /** §27.1 "Dealer invitation bounced" → Operations. */
  DEALER_INVITATION_BOUNCED: "dealer_invitation_bounced",
} as const;

export type Phase5TemplateKey = (typeof PHASE_5_TEMPLATES)[keyof typeof PHASE_5_TEMPLATES];

/**
 * The buyer authorised a wider radius, or the case moved on, between the enqueue and the
 * drain — so asking for authorisation has become false.
 *
 * The canonical §27 recheck shape: re-read the fact the message asserts. Here the fact is
 * "your request is waiting on your permission to search further", and the case status is
 * what makes it true.
 */
const skipIfRadiusAuthorizationResolved: StateRecheckFn = async (ctx) => {
  if (!ctx.vehicleRequestId) return { proceed: true };
  const c = await ctx.db.sourcingCase.findUnique({
    where: { vehicleRequestId: ctx.vehicleRequestId },
    select: { status: true, authorizedRadiusMiles: true },
  });
  if (!c) return { proceed: false, reason: "no sourcing case for this request" };
  if (c.status !== "RADIUS_AUTHORIZATION_REQUIRED") {
    return { proceed: false, reason: `sourcing case is ${c.status}, no longer awaiting authorisation` };
  }
  if (c.authorizedRadiusMiles !== null) {
    return { proceed: false, reason: "the buyer has already recorded a maximum distance" };
  }
  return { proceed: true };
};

/** A closed case has nothing to report progress on. */
const skipIfSourcingCaseClosed: StateRecheckFn = async (ctx) => {
  if (!ctx.vehicleRequestId) return { proceed: true };
  const c = await ctx.db.sourcingCase.findUnique({
    where: { vehicleRequestId: ctx.vehicleRequestId },
    select: { status: true },
  });
  if (!c) return { proceed: false, reason: "no sourcing case for this request" };
  if (c.status === "CLOSED") return { proceed: false, reason: "sourcing case is closed" };
  return { proceed: true };
};

/**
 * Coverage was found between the notice being enqueued and the drain.
 *
 * §26's zero-coverage row says "Review, then close or expand" — expansion is an expected
 * outcome, and a buyer who has just been told there is no coverage while an auction is being
 * prepared for them has been told something false.
 */
const skipIfCoverageFound: StateRecheckFn = async (ctx) => {
  if (!ctx.vehicleRequestId) return { proceed: true };
  const c = await ctx.db.sourcingCase.findUnique({
    where: { vehicleRequestId: ctx.vehicleRequestId },
    select: { status: true, coverageCount: true },
  });
  if (!c) return { proceed: false, reason: "no sourcing case for this request" };
  if (c.coverageCount > 0) {
    return { proceed: false, reason: `coverage has since reached ${c.coverageCount}` };
  }
  if (c.status === "CLOSED") return { proceed: false, reason: "sourcing case is closed" };
  return { proceed: true };
};

/** An auction that is no longer live is not one to announce as live. */
const skipIfAuctionNotActive: StateRecheckFn = async (ctx) => {
  if (!ctx.auctionId) return { proceed: true };
  const a = await ctx.db.auction.findUnique({
    where: { id: ctx.auctionId },
    select: { status: true },
  });
  if (!a) return { proceed: false, reason: "auction no longer exists" };
  if (a.status !== "ACTIVE") return { proceed: false, reason: `auction is ${a.status}` };
  return { proceed: true };
};

/**
 * The invitation itself must still be live, and so must the auction.
 *
 * THE MOST LOAD-BEARING RECHECK IN THIS PHASE. An invitation row can be REPLACED between
 * enqueue and drain — §Stage 7's "An undeliverable contact or rooftop is replaced early in
 * the auction window" — and sending the superseded one would hand a dealership a token that
 * has been rotated away from them. It can also have been DECLINED, or the dealership
 * suspended under §13-D42, or the auction closed early because every dealer responded.
 *
 * Keyed on `payload.invitationId` rather than on `recipientId`, because the recipient is a
 * rooftop contact that may not be a platform user at all — an outside dealership has no
 * `Dealer` row to look up.
 */
const skipIfInvitationNoLongerSendable: StateRecheckFn = async (ctx) => {
  const invitationId = ctx.payload.invitationId;
  if (typeof invitationId !== "string") {
    // Refuse rather than send blind. A dealer-facing invitation with no invitation id cannot
    // be re-checked, and §25.1 makes an unverifiable dealer send the wrong thing to guess at.
    return { proceed: false, reason: "payload carries no invitationId to re-check" };
  }
  const inv = await ctx.db.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: {
      status: true,
      tokenHash: true,
      declinedAt: true,
      offerSubmittedAt: true,
      auction: { select: { status: true, endsAt: true } },
      dealer: { select: { status: true } },
    },
  });
  if (!inv) return { proceed: false, reason: "invitation no longer exists" };
  if (inv.status === "REPLACED") return { proceed: false, reason: "invitation was replaced" };
  if (inv.status === "EXPIRED") return { proceed: false, reason: "invitation expired" };
  if (inv.declinedAt) return { proceed: false, reason: "dealer declined" };
  if (inv.offerSubmittedAt) return { proceed: false, reason: "dealer has already submitted an offer" };
  if (!inv.tokenHash) {
    // §Stage 7 requires a tokenised link. An invitation with no token would send a dealer a
    // message with nowhere to go.
    return { proceed: false, reason: "invitation has no token" };
  }
  if (!inv.auction || inv.auction.status !== "ACTIVE") {
    return { proceed: false, reason: `auction is ${inv.auction?.status ?? "missing"}` };
  }
  if (inv.auction.endsAt && inv.auction.endsAt.getTime() <= Date.now()) {
    return { proceed: false, reason: "the submission deadline has passed" };
  }
  // §13-D42's enforcement point, read at send time as well as at readiness: a dealership
  // suspended from invitations between enqueue and drain is not mailed.
  if (inv.dealer && inv.dealer.status !== "ACTIVE") {
    return { proceed: false, reason: `dealer is ${inv.dealer.status}` };
  }
  return { proceed: true };
};

registerStateRecheck(PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_NEEDED, skipIfRadiusAuthorizationResolved);
registerStateRecheck(PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_REMINDER_24H, skipIfRadiusAuthorizationResolved);
registerStateRecheck(PHASE_5_TEMPLATES.RADIUS_AUTHORIZATION_REMINDER_72H, skipIfRadiusAuthorizationResolved);
registerStateRecheck(PHASE_5_TEMPLATES.SOURCING_COMPLETED, skipIfSourcingCaseClosed);
registerStateRecheck(PHASE_5_TEMPLATES.SOURCING_LIMITED_FIELD, skipIfSourcingCaseClosed);
registerStateRecheck(PHASE_5_TEMPLATES.SOURCING_NO_COVERAGE, skipIfCoverageFound);
registerStateRecheck(PHASE_5_TEMPLATES.AUCTION_LAUNCHED, skipIfAuctionNotActive);
registerStateRecheck(PHASE_5_TEMPLATES.DEALER_INVITED, skipIfInvitationNoLongerSendable);
registerStateRecheck(PHASE_5_TEMPLATES.DEALER_INVITATION_REMINDER_50, skipIfInvitationNoLongerSendable);
registerStateRecheck(PHASE_5_TEMPLATES.DEALER_INVITATION_REMINDER_90, skipIfInvitationNoLongerSendable);
registerStateRecheck(
  PHASE_5_TEMPLATES.DEALER_INVITATION_BOUNCED,
  alwaysSend(
    "a bounce has already happened and the Operations task is to replace the contact; no later state unmakes the bounce"
  ),
  "operations alert"
);

// ---------------------------------------------------------------------------
// Phase 6 templates. §27.1 close rows.
// ---------------------------------------------------------------------------

/** Template keys Phase 6 enqueues. §27.1 rows K27-1326 and K27-1327. */
export const PHASE_6_TEMPLATES = {
  /** §27.1 "Offers ready" → Buyer, "Ranked report and selection instructions". */
  OFFERS_READY: "offers_ready",
  /** §27.1 "Zero offers" → Buyer, "Outcome and recovery path". */
  AUCTION_ZERO_OFFERS: "auction_zero_offers",
  /** §27.1 K27-1330 / §23.2a touchpoint 4 — one hour after acceptance, only if declined. */
  PREMIUM_FOLLOW_UP: "premium_follow_up",
  /** §9 / parity row S14 — "remind the buyer before offers expire". NEW §27.1 row, Phase 6. */
  SELECTION_REMINDER: "selection_reminder",
  /** §9 / parity row S15 — every offer lapsed without a selection. Buyer told either way. */
  OFFERS_EXPIRED_UNSELECTED: "offers_expired_unselected",
} as const;

export type Phase6TemplateKey = (typeof PHASE_6_TEMPLATES)[keyof typeof PHASE_6_TEMPLATES];

/**
 * The qualified-offer predicate, re-read at send time.
 *
 * It is deliberately the SAME three conditions `qualifiedOfferWhere` applies at close — status
 * SUBMITTED, not disqualified, not expired — expressed here against `ctx.db` rather than imported,
 * because `lib/services/offer/offer-validity.ts` is compiled into the request/service tree and this
 * registry is loaded by the outbox DRAIN. Importing it would pull the offer tree into the drain
 * process for one `where` clause. The duplication is three lines and is pinned by a test that reads
 * both and asserts they agree.
 */
async function countQualifiedOffers(ctx: StateRecheckContext, auctionId: string): Promise<number> {
  return ctx.db.offer.count({
    where: {
      auctionId,
      status: "SUBMITTED",
      isDisqualified: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

/**
 * "Your offers are ready" must not arrive after the buyer has already chosen, and must not arrive
 * at all if the offers it counts have gone.
 *
 * BOTH READS MATTER. A buyer who selected within the drain window (the outbox runs on its own
 * cadence; an early accept selects inside the same minute the auction closes) would otherwise be
 * invited to choose an offer they have already chosen. And an offer that lapsed or was withdrawn
 * between the close and the drain would make the count in the subject line a lie — §8c's "never
 * presented as qualified" applies to the notice as much as to the report.
 */
const skipIfOffersNoLongerReady: StateRecheckFn = async (ctx) => {
  if (!ctx.auctionId) return { proceed: false, reason: "offers-ready notice with no auction reference" };
  const accepted = await ctx.db.offer.count({ where: { auctionId: ctx.auctionId, status: "ACCEPTED" } });
  if (accepted > 0) return { proceed: false, reason: "buyer already selected an offer" };
  const qualified = await countQualifiedOffers(ctx, ctx.auctionId);
  if (qualified === 0) return { proceed: false, reason: "no qualified offer remains on this auction" };
  return { proceed: true };
};

/**
 * "No dealership submitted a qualified offer" is false the moment one has.
 *
 * That is not hypothetical: §8.2 defect 2 routes staff intake through `submitOffer`, so an offer
 * that arrived by phone during the auction can be entered after the close, and §13-D39's relaunch
 * is started by the same operator who would be reading this queue row. Sending the buyer a
 * "nothing came in" notice after an offer has landed is the worst version of a stale message,
 * because it also contradicts the in-app notice they can see.
 */
const skipIfOffersArrived: StateRecheckFn = async (ctx) => {
  if (!ctx.auctionId) return { proceed: false, reason: "zero-offer notice with no auction reference" };
  // AN ACCEPTED OFFER IS THE STRONGEST POSSIBLE REFUTATION and it does not count as qualified —
  // selection moves the winner to ACCEPTED and the rest to DECLINED, so an auction the buyer has
  // just bought on has a qualified count of ZERO. Without this the recheck would happily deliver
  // "no dealership submitted a qualified offer" to a buyer holding a Deal. Checked first, and
  // deliberately mirroring `skipIfOffersNoLongerReady`.
  const accepted = await ctx.db.offer.count({ where: { auctionId: ctx.auctionId, status: "ACCEPTED" } });
  if (accepted > 0) return { proceed: false, reason: "an offer on this auction was already selected" };
  const qualified = await countQualifiedOffers(ctx, ctx.auctionId);
  if (qualified > 0) return { proceed: false, reason: `${qualified} qualified offer(s) arrived after the close` };
  return { proceed: true };
};

registerStateRecheck(PHASE_6_TEMPLATES.OFFERS_READY, skipIfOffersNoLongerReady);
registerStateRecheck(PHASE_6_TEMPLATES.AUCTION_ZERO_OFFERS, skipIfOffersArrived);

/**
 * §23.2a touchpoint 4 — the one-hour follow-up, re-decided at send time.
 *
 * THE WHOLE SUPPRESSION SET IS RE-EVALUATED HERE, not merely re-read. The row is written at
 * acceptance and drains an hour later, and that hour is exactly when the things §23.2b suppresses
 * on tend to happen: the buyer upgrades from the interstitial's own link, a dispute lands on the
 * $99, Operations opens an exception on the deal, the buyer starts cancelling. Enqueue-time
 * suppression alone would send the ask into every one of those.
 *
 * It ALSO re-checks the precondition that is unique to this touchpoint: §23.2a sends it "only if
 * the invitation was declined or dismissed". A buyer who simply has not opened the interstitial
 * yet has not declined anything, and must not be emailed as though they had.
 */
const skipIfUpgradeNoLongerAskable: StateRecheckFn = async (ctx) => {
  const vehicleRequestId = ctx.vehicleRequestId;
  if (!vehicleRequestId || !ctx.recipientId) {
    return { proceed: false, reason: "premium follow-up with no request or buyer reference" };
  }
  const [{ isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS }, { upgradeAskCounts, recordImpression }] =
    await Promise.all([
      import("@/lib/services/plan/upgrade-suppression.service"),
      import("@/lib/services/plan/upgrade-touchpoint.service"),
    ]);

  const counts = await upgradeAskCounts(ctx.recipientId, vehicleRequestId, ctx.db);
  if (counts.declines === 0) {
    return { proceed: false, reason: "the invitation was never declined or dismissed — §23.2a sends this only if it was" };
  }

  const decision = await isUpgradePromptSuppressed(
    {
      vehicleRequestId,
      buyerId: ctx.recipientId,
      touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE_EMAIL,
      emailsSent: counts.emailsSent,
      declines: counts.declines,
    },
    ctx.db,
  );
  if (decision.suppressed) return { proceed: false, reason: `${decision.reason}: ${decision.detail}` };

  // RECORD THE EMAIL ASK, HERE AND NOWHERE ELSE. `upgradeAskCounts().emailsSent` derives from
  // impressions on `EMAIL_TOUCHPOINTS`, and until now nothing ever recorded one — every writer used
  // an in-app touchpoint — so the count was permanently 0 and §23.2b's "two emails, then silence"
  // ceiling could never bind, however many emails went out.
  //
  // This is the correct moment and the enqueue was not: an outbox row that the recheck later
  // suppresses is an ask that never happened, and counting it would silence a later, legitimate
  // one. `proceed: true` is the decision to actually ask.
  await recordImpression(
    {
      buyerId: ctx.recipientId,
      vehicleRequestId,
      touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE_EMAIL,
      detail: { templateKey: PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP },
    },
    ctx.db,
  );
  return { proceed: true };
};

registerStateRecheck(PHASE_6_TEMPLATES.PREMIUM_FOLLOW_UP, skipIfUpgradeNoLongerAskable);

/**
 * §9 / S14 — the pre-expiry selection reminder, re-decided at send time.
 *
 * Scheduled at close for 24 hours before the earliest expiry, which means it sits in the outbox
 * for two days — the longest gap between enqueue and drain anywhere in this phase, and therefore
 * the one most likely to have become false. THREE things can make it false, and the cancel key
 * only covers the first:
 *
 *   the buyer selected          `cancelByKey` fires on selection, but a cancel that failed (or a
 *                               selection through a path that forgot it) must not produce "your
 *                               offers expire soon — choose one" for a buyer holding a Deal.
 *   the offers went            withdrawn, disqualified on re-evaluation, or already lapsed.
 *                               Reminding someone to choose from nothing is worse than silence.
 *   nothing is left to choose   the same read, stated as the qualified count.
 */
const skipIfSelectionNoLongerNeeded: StateRecheckFn = async (ctx) => {
  if (!ctx.auctionId) return { proceed: false, reason: "selection reminder with no auction reference" };
  const accepted = await ctx.db.offer.count({ where: { auctionId: ctx.auctionId, status: "ACCEPTED" } });
  if (accepted > 0) return { proceed: false, reason: "the buyer has already selected" };
  const qualified = await countQualifiedOffers(ctx, ctx.auctionId);
  if (qualified === 0) return { proceed: false, reason: "no qualified offer remains to choose from" };
  return { proceed: true };
};

/**
 * §9 / S15 — "non-selection → revalidation with dealerships or closure; buyer informed EITHER WAY".
 *
 * The one thing that makes this false is a selection that landed between the sweep and the drain.
 * A lapsed offer does NOT make it false — the message is about the lapse.
 */
const skipIfSelectedAfterExpiry: StateRecheckFn = async (ctx) => {
  if (!ctx.auctionId) return { proceed: false, reason: "expiry notice with no auction reference" };
  const accepted = await ctx.db.offer.count({ where: { auctionId: ctx.auctionId, status: "ACCEPTED" } });
  if (accepted > 0) return { proceed: false, reason: "the buyer selected before the offers lapsed" };
  return { proceed: true };
};

registerStateRecheck(PHASE_6_TEMPLATES.SELECTION_REMINDER, skipIfSelectionNoLongerNeeded);
registerStateRecheck(PHASE_6_TEMPLATES.OFFERS_EXPIRED_UNSELECTED, skipIfSelectedAfterExpiry);

/** §27's cancellation rule. One key for the reminder, cancelled the moment the buyer chooses. */
export function selectionReminderCancelKey(auctionId: string): string {
  return `selection-reminder:${auctionId}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// PHASE 7 — Stages 10 to 12: reaffirmation, recap, financing checkpoints
// ───────────────────────────────────────────────────────────────────────────────

export const PHASE_7_TEMPLATES = {
  /** §27.1 "Buyer selects offer → winning dealership → reaffirmation request". The K27-1328b half. */
  REAFFIRMATION_REQUEST: "reaffirmation_request",
  /** §27.1 "Reaffirmation reminder → winning dealership → 12-hour reminder". */
  REAFFIRMATION_REMINDER: "reaffirmation_reminder",
  /** §27.1 "Dealer confirms → Buyer + AutoLenis → confirmed vehicle, condition report, summary". */
  DEALER_CONFIRMED: "dealer_confirmed",
  /** §27.1 "Material change proposed → Buyer → side-by-side change with accept or reject". */
  MATERIAL_CHANGE_PROPOSED: "material_change_proposed",
  /** §27.1 "Dealer rejects or times out → Buyer + Operations → return-to-offers instructions". */
  RETURNED_TO_OFFERS: "returned_to_offers",
  /** §27.1 "Vehicle hold expiring → Buyer + dealership + Operations → extend or release". */
  VEHICLE_HOLD_EXPIRING: "vehicle_hold_expiring",
  /** §27.1 "Outside dealer verification needed → Dealership + Operations". */
  OUTSIDE_DEALER_VERIFICATION: "outside_dealer_verification",
  /** §27.1 "Recap ready → Buyer + dealership → confirm the final numbers". */
  RECAP_READY: "recap_ready",
  /** §27.1 "Financing path selected → Buyer + AutoLenis → external handoff and status". */
  FINANCING_PATH_SELECTED: "financing_path_selected",
  /** §27.1 "Financing in progress → Buyer → progress or missing-evidence reminder". */
  FINANCING_IN_PROGRESS: "financing_in_progress",
  /** §27.1 "Financing terms locked → Buyer + dealership → terms confirmed; contract next". */
  FINANCING_TERMS_LOCKED: "financing_terms_locked",
  /** §27.1 "Financing failed or expired → Buyer + AutoLenis → alternative-path instruction". */
  FINANCING_FAILED_OR_EXPIRED: "financing_failed_or_expired",
  /** §23.2a touchpoint 5 — the second and final Premium ask, at reaffirmation or recap. */
  PREMIUM_FOLLOW_UP_FINAL: "premium_follow_up_final",
} as const;

export type Phase7TemplateKey = (typeof PHASE_7_TEMPLATES)[keyof typeof PHASE_7_TEMPLATES];

/**
 * §27's cancellation rule for Stage 10. ONE key covers the request and the 12-hour reminder, so a
 * confirmation, a rejection, a timeout or a released hold cancels whatever is still queued with a
 * single call — and a caller cannot cancel the reminder while leaving the request to arrive after
 * the deal has stood down.
 */
export function reaffirmationReminderCancelKey(dealId: string): string {
  return `reaffirmation:${dealId}`;
}

/** §27's cancellation rule for Stage 11. Cancelled when both parties have confirmed the recap. */
export function recapCancelKey(dealId: string): string {
  return `recap:${dealId}`;
}

/**
 * Every Stage 10 message to the dealership is about ONE open window. The window closes four ways —
 * confirmed, rejected, timed out, or the deal stood down — and in all four the message is a lie by
 * the time it drains. The cancel key covers the ordinary path; this is what covers a cancel that
 * failed, or a path that forgot to call it.
 *
 * This is the same shape as `skipIfSelectionNoLongerNeeded`, pointed at the reaffirmation row
 * rather than the offer set.
 */
const skipIfReaffirmationClosed: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "reaffirmation message with no deal reference" };
  const deal = await ctx.db.deal.findUnique({
    where: { id: ctx.dealId },
    select: { status: true },
  });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
    return { proceed: false, reason: "the deal has stood down" };
  }
  const row = await ctx.db.dealerReaffirmation.findFirst({
    where: { dealId: ctx.dealId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!row) return { proceed: false, reason: "no reaffirmation is open for this deal" };
  if (row.status !== "PENDING") {
    return { proceed: false, reason: `the dealership has already answered (${row.status})` };
  }
  return { proceed: true };
};

/**
 * "A change is waiting for your decision" is false once the buyer has decided, and false if the
 * deal stood down while the message sat in the outbox.
 */
const skipIfMaterialChangeDecided: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "material-change notice with no deal reference" };
  const row = await ctx.db.dealerReaffirmation.findFirst({
    where: { dealId: ctx.dealId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (!row) return { proceed: false, reason: "no reaffirmation exists for this deal" };
  if (row.status !== "MATERIAL_CHANGE_PENDING") {
    return { proceed: false, reason: `the change is no longer awaiting a decision (${row.status})` };
  }
  return { proceed: true };
};

/** "Confirm the final numbers" is false once both parties have, and false if the recap was superseded. */
const skipIfRecapConfirmed: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "recap notice with no deal reference" };
  const recap = await ctx.db.dealRecap.findFirst({
    where: { dealId: ctx.dealId },
    orderBy: { version: "desc" },
    select: { buyerConfirmedAt: true, dealerConfirmedAt: true, supersededBy: true },
  });
  if (!recap) return { proceed: false, reason: "no recap exists for this deal" };
  if (recap.supersededBy) return { proceed: false, reason: "a newer recap version has replaced this one" };
  if (recap.buyerConfirmedAt && recap.dealerConfirmedAt) {
    return { proceed: false, reason: "both parties have already confirmed" };
  }
  return { proceed: true };
};

/**
 * The vehicle hold. Two things make the notice false: the contract has been requested (the hold has
 * done its job — §10c's predicate is the CONTRACT REQUEST, not the date) or the hold moved.
 *
 * The moved-hold check reads the payload's own `holdUntil` rather than only the row: a dealership
 * that extends between the sweep and the drain should not have the buyer told the old date is
 * expiring.
 */
const skipIfHoldNoLongerExpiring: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "hold notice with no deal reference" };
  const deal = await ctx.db.deal.findUnique({
    where: { id: ctx.dealId },
    select: { status: true, vehicleHoldUntil: true },
  });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  const PAST_HOLD = ["CONTRACT_PENDING", "CONTRACT_REVIEW", "CONTRACT_APPROVED", "SIGNING_PENDING", "SIGNED", "DEALER_EXECUTED", "FUNDING_PENDING", "PICKUP_READINESS", "PICKUP_SCHEDULED", "HANDOVER_PENDING", "COMPLETED", "CANCELLED", "REFUNDED"];
  if (PAST_HOLD.includes(deal.status)) {
    return { proceed: false, reason: `the hold is no longer the gating fact at ${deal.status}` };
  }
  const notifiedFor = typeof ctx.payload.holdUntil === "string" ? ctx.payload.holdUntil : null;
  if (notifiedFor && deal.vehicleHoldUntil && deal.vehicleHoldUntil.toISOString() !== notifiedFor) {
    return { proceed: false, reason: "the dealership extended the hold after this notice was queued" };
  }
  return { proceed: true };
};

/**
 * The financing checkpoint messages. Each is about a status the deal has SINCE left in one
 * direction only, so the recheck is "is the deal still at the status this message describes".
 */
function skipIfFinancingStatusChanged(expected: string[]): StateRecheckFn {
  return async (ctx) => {
    if (!ctx.dealId) return { proceed: false, reason: "financing notice with no deal reference" };
    const deal = await ctx.db.deal.findUnique({ where: { id: ctx.dealId }, select: { status: true } });
    if (!deal) return { proceed: false, reason: "the deal no longer exists" };
    if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
      return { proceed: false, reason: "the deal has stood down" };
    }
    const financing = await ctx.db.financing.findUnique({
      where: { dealId: ctx.dealId },
      select: { status: true },
    });
    if (!financing) return { proceed: false, reason: "no financing record exists for this deal" };
    if (!expected.includes(financing.status)) {
      return { proceed: false, reason: `financing is now ${financing.status}, not ${expected.join(" or ")}` };
    }
    return { proceed: true };
  };
}

registerStateRecheck(PHASE_7_TEMPLATES.REAFFIRMATION_REQUEST, skipIfReaffirmationClosed);
registerStateRecheck(PHASE_7_TEMPLATES.REAFFIRMATION_REMINDER, skipIfReaffirmationClosed);
registerStateRecheck(PHASE_7_TEMPLATES.MATERIAL_CHANGE_PROPOSED, skipIfMaterialChangeDecided);
registerStateRecheck(PHASE_7_TEMPLATES.RECAP_READY, skipIfRecapConfirmed);
registerStateRecheck(PHASE_7_TEMPLATES.VEHICLE_HOLD_EXPIRING, skipIfHoldNoLongerExpiring);
registerStateRecheck(
  PHASE_7_TEMPLATES.FINANCING_IN_PROGRESS,
  skipIfFinancingStatusChanged(["NOT_STARTED", "IN_PROGRESS"]),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.FINANCING_TERMS_LOCKED,
  skipIfFinancingStatusChanged(["TERMS_LOCKED", "NOT_REQUIRED_CASH"]),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.FINANCING_FAILED_OR_EXPIRED,
  skipIfFinancingStatusChanged(["FAILED", "EXPIRED"]),
);

// THE FOUR THAT CANNOT BECOME FALSE, each with the reason a reviewer reads rather than a shrug.
registerStateRecheck(
  PHASE_7_TEMPLATES.RETURNED_TO_OFFERS,
  alwaysSend(
    "The deal stood down. That is a fact about a moment that has passed, and §Stage 10 requires " +
      "the buyer to be told 'with the reason stated' — a rejection, a timeout, a released hold or " +
      "a failed verification all owe them that. Nothing that happens afterwards makes it false: a " +
      "buyer who then selects another offer still needs to know why the first one ended, and " +
      "suppressing it would leave a deal that silently changed hands with no record of why.",
  ),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.DEALER_CONFIRMED,
  alwaysSend(
    "The dealership confirmed. That is a fact about a moment that has passed — a later rejection, " +
      "timeout or released hold produces its OWN notice (RETURNED_TO_OFFERS), and suppressing this " +
      "one would leave the buyer with a deal that silently changed hands and no record of why.",
  ),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.FINANCING_PATH_SELECTED,
  alwaysSend(
    "The buyer chose a path. The message explains the external handoff and what happens next; it " +
      "stays true whichever way the financing then goes, and the outcomes have their own notices.",
  ),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.OUTSIDE_DEALER_VERIFICATION,
  alwaysSend(
    "A dealership being asked to claim and verify its account needs the instruction whether or not " +
      "the deal survives — the account outlives this transaction, and a half-claimed account is the " +
      "state §10b exists to prevent.",
  ),
);
registerStateRecheck(
  PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL,
  alwaysSend(
    "SEE THE NOTE BELOW — this is NOT an unconditional send. §23.2b's suppression set is evaluated " +
      "by `upgrade-suppression.service` BEFORE the row is enqueued, and §23.2a's own rule is that " +
      "this is the last ask. The registry entry is `alwaysSend` because the suppression decision is " +
      "owned by the plan/upgrade area, not because the message cannot become false.",
  ),
);

// ───────────────────────────────────────────────────────────────────────────────
// PHASE 8 — Stages 13 to 15: contract, Contract Shield, signatures, dealer
// execution, funding clearance, insurance
// ───────────────────────────────────────────────────────────────────────────────

export const PHASE_8_TEMPLATES = {
  /** §27.1 "Contract requested → Winning dealership → Secure upload link and 24-hour deadline". */
  CONTRACT_REQUESTED: "contract_requested",
  /** §27.1 "Contract overdue → Dealership + Operations → Reminder and escalation". */
  CONTRACT_OVERDUE: "contract_overdue",
  /** §27.1 "Contract revision required → Buyer + dealership → Specific mismatches and required correction". */
  CONTRACT_REVISION_REQUIRED: "contract_revision_required",
  /** §27.1 "Contract approved → Buyer + dealership → Signing readiness". */
  CONTRACT_APPROVED: "contract_approved",
  /** §27.1 "Signature required → Buyer + co-buyer → Secure signing link and deadline". */
  SIGNATURE_REQUIRED: "signature_required",
  /** §27.1 "Signature reminder or expiration → Required signer → Remaining time or reissue instruction". */
  SIGNATURE_REMINDER: "signature_reminder",
  /** §27.1 "Buyer signatures completed → Dealership → Dealer execution request". */
  DEALER_EXECUTION_REQUESTED: "dealer_execution_requested",
  /** §27.1 "Fully executed contract stored → Buyer + dealership → Executed-document access notice". */
  EXECUTED_CONTRACT_STORED: "executed_contract_stored",
  /** §27.1 "Financing completed → Buyer + dealership + AutoLenis → Verified checkpoint confirmation". */
  FINANCING_COMPLETED: "financing_completed",
  /** §27.1 "Funding cleared or blocked → Dealership, buyer, Operations → Release result or missing requirement". */
  FUNDING_CLEARED: "funding_cleared",
  /** The blocked half of the same §27.1 row — the specific outstanding condition and who owns it. */
  FUNDING_BLOCKED: "funding_blocked",
  /** §27.1 "Insurance required → Buyer → Requirements and secure submission link". */
  INSURANCE_REQUIRED: "insurance_required",
  /** §27.1 "Insurance uploaded → Buyer + Operations → Receipt and review task". */
  INSURANCE_UPLOADED: "insurance_uploaded",
  /** §27.1 "Insurance verified → Buyer + dealership → Clearance confirmation". */
  INSURANCE_VERIFIED: "insurance_verified",
  /** §27.1 "Insurance rejected or expired → Buyer → Specific correction required". */
  INSURANCE_REJECTED: "insurance_rejected",
  /** §27.1 "Premium election reverted to Standard → Buyer → Reversion notice at funding clearance". */
  PREMIUM_ELECTION_REVERTED: "premium_election_reverted",
} as const;

export type Phase8TemplateKey = (typeof PHASE_8_TEMPLATES)[keyof typeof PHASE_8_TEMPLATES];

/**
 * §27's cancellation rule for Stage 13/14a. ONE key covers the contract request and its overdue
 * reminder, so an upload — from the dealership or from an admin on their behalf — cancels whatever
 * is still queued with a single call. A caller cannot cancel the reminder and leave the request to
 * arrive after the contract is already in review.
 */
export function contractRequestCancelKey(dealId: string): string {
  return `contract-request:${dealId}`;
}

/**
 * §27's cancellation rule for Stage 13/14c. Covers the signature request and every reminder for one
 * signer. Keyed per SIGNER, not per deal: the co-buyer's reminders must keep running after the
 * buyer signs, and a single deal-wide key would cancel them.
 */
export function signatureReminderCancelKey(dealId: string, signerKind: string): string {
  return `signature:${dealId}:${signerKind}`;
}

/** §27's cancellation rule for Stage 15. Cancelled when Operations decides. */
export function insuranceReviewCancelKey(dealId: string): string {
  return `insurance:${dealId}`;
}

/**
 * The contract request and its overdue reminder. Both become false the moment a contract version
 * is actually under review — the predicate is the UPLOAD, not the deal status, because
 * CONTRACT_REVIEW → CONTRACT_PENDING is a legal edge (re-submit) and a status check alone would
 * let a reminder fire for a request the dealership had already answered.
 */
const skipIfContractUploaded: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "contract notice with no deal reference" };
  const deal = await ctx.db.deal.findUnique({ where: { id: ctx.dealId }, select: { status: true } });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
    return { proceed: false, reason: "the deal has stood down" };
  }
  const request = await ctx.db.documentRequest.findFirst({
    where: { dealId: ctx.dealId, documentType: "SALES_CONTRACT" },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  if (request && request.status !== "PENDING") {
    return { proceed: false, reason: `the contract request is ${request.status}, not outstanding` };
  }
  return { proceed: true };
};

/**
 * The signature request and its reminders, for ONE signer. False once that signer's envelope has
 * reached a terminal state — signed, declined, voided or expired. Read per signer because after the
 * §13-D30 cutover a deal carries one envelope per required signer and "the deal is signed" is no
 * longer a single row's status.
 */
const skipIfSignerCompleted: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "signature notice with no deal reference" };
  const deal = await ctx.db.deal.findUnique({ where: { id: ctx.dealId }, select: { status: true } });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
    return { proceed: false, reason: "the deal has stood down" };
  }
  const signerKind = typeof ctx.payload.signerKind === "string" ? ctx.payload.signerKind : "BUYER";
  const envelope = await ctx.db.eSignEnvelope.findFirst({
    where: { dealId: ctx.dealId, signerKind: signerKind as "BUYER" | "CO_BUYER" },
    select: { status: true },
  });
  if (!envelope) return { proceed: false, reason: `no ${signerKind} envelope exists for this deal` };
  if (["COMPLETED", "DECLINED", "VOIDED", "EXPIRED"].includes(envelope.status)) {
    return { proceed: false, reason: `the ${signerKind} envelope is ${envelope.status}` };
  }
  return { proceed: true };
};

/**
 * The insurance review task. False once Operations has decided — which is any state that is not
 * "waiting on us". EXTERNAL_UPLOADED is read as awaiting review rather than migrated, so a
 * pre-§13-D31 row still counts as outstanding (§13-D31).
 */
const skipIfInsuranceDecided: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "insurance notice with no deal reference" };
  const deal = await ctx.db.deal.findUnique({
    where: { id: ctx.dealId },
    select: { status: true, insuranceStatus: true },
  });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
    return { proceed: false, reason: "the deal has stood down" };
  }
  if (!["EXTERNAL_UPLOADED", "UNDER_REVIEW"].includes(deal.insuranceStatus)) {
    return { proceed: false, reason: `insurance is ${deal.insuranceStatus}, so the review is closed` };
  }
  return { proceed: true };
};

/**
 * The insurance REQUEST. False once the buyer has given us anything at all, or once coverage is
 * already verified or bound — asking a buyer who has already uploaded is the kind of message that
 * makes people distrust every other one.
 */
const skipIfInsuranceProvided: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: false, reason: "insurance request with no deal reference" };
  const deal = await ctx.db.deal.findUnique({
    where: { id: ctx.dealId },
    select: { status: true, insuranceStatus: true },
  });
  if (!deal) return { proceed: false, reason: "the deal no longer exists" };
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED") {
    return { proceed: false, reason: "the deal has stood down" };
  }
  const OUTSTANDING = ["NOT_STARTED", "QUOTE_REQUESTED", "QUOTE_RECEIVED", "POLICY_SELECTED", "REJECTED", "EXPIRED", "FAILED"];
  if (!OUTSTANDING.includes(deal.insuranceStatus)) {
    return { proceed: false, reason: `insurance is ${deal.insuranceStatus} — the buyer has already responded` };
  }
  return { proceed: true };
};

registerStateRecheck(PHASE_8_TEMPLATES.CONTRACT_REQUESTED, skipIfContractUploaded);
registerStateRecheck(PHASE_8_TEMPLATES.CONTRACT_OVERDUE, skipIfContractUploaded);
registerStateRecheck(PHASE_8_TEMPLATES.SIGNATURE_REQUIRED, skipIfSignerCompleted);
registerStateRecheck(PHASE_8_TEMPLATES.SIGNATURE_REMINDER, skipIfSignerCompleted);
registerStateRecheck(PHASE_8_TEMPLATES.INSURANCE_REQUIRED, skipIfInsuranceProvided);
registerStateRecheck(PHASE_8_TEMPLATES.INSURANCE_UPLOADED, skipIfInsuranceDecided);

// THE REST ARE alwaysSend, each with the reason a reviewer reads rather than a shrug. Every one
// reports a decision that HAS BEEN TAKEN and recorded. A recheck asks "is this still true?", and
// for a recorded decision the answer is permanently yes: Contract Shield did hold this version,
// the dealership did execute, funding did clear, the election did revert. Suppressing one because
// the deal has since moved on would delete the only notice that it happened.
registerStateRecheck(
  PHASE_8_TEMPLATES.CONTRACT_REVISION_REQUIRED,
  alwaysSend("Contract Shield held a specific version and named the discrepancies. A later corrected upload does not unmake the hold, and both parties are owed the list that produced it."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.CONTRACT_APPROVED,
  alwaysSend("An approval binds to the exact reviewed version and is recorded. A later revision creates a NEW review; it does not retract the fact that this one passed."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.DEALER_EXECUTION_REQUESTED,
  alwaysSend("Every required signature was recorded. The dealership is owed the request even if the deal is later cancelled — it is what tells them to stop waiting or to stand down."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.EXECUTED_CONTRACT_STORED,
  alwaysSend("A legally executed contract exists and both parties are entitled to know where it is. Nothing that happens afterwards makes that untrue."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.FINANCING_COMPLETED,
  alwaysSend("A verified checkpoint was recorded against external evidence. A later financing change sends the deal back through recap and signatures; it does not unrecord this checkpoint."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.FUNDING_CLEARED,
  alwaysSend("Funding clearance is the no-spot-delivery guarantee's own record. It was evidenced when it was written."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.FUNDING_BLOCKED,
  alwaysSend("The outstanding items were the ones outstanding when the block was recorded. Suppressing it because one has since been resolved would leave the owner of the others never told."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.INSURANCE_VERIFIED,
  alwaysSend("Operations decided and recorded a verification. A later expiry is its own notice, not a reason to withhold this one."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.INSURANCE_REJECTED,
  alwaysSend("A rejection names a specific defect the buyer has to correct. It is the only message that tells them what is wrong, so it is never suppressed."),
);
registerStateRecheck(
  PHASE_8_TEMPLATES.PREMIUM_ELECTION_REVERTED,
  alwaysSend("A plan changed and money stopped being due. §23.5 requires the buyer be told, and a reversion cannot become un-reverted."),
);

// ── PHASE 9 — §27.1's pickup, handover and completion rows ──────────────────────────────────
//
// Only the three the handover/completion path actually sends are declared here. The remaining
// §27.1 Phase 9 rows (readiness blocked, proposal/counter, confirmed, 24h/2h approaching,
// rescheduled, handover blocked, obligation follow-up) are declared as their senders land — a
// template constant with no sender is a §27.1 row that LOOKS wired and is not, which is the
// completeness claim Phase 10 has to audit.
export const PHASE_9_TEMPLATES = {
  /** §27.1 "Dealer releases vehicle → Buyer → Possession-confirmation request". */
  VEHICLE_RELEASED: "pickup_vehicle_released",
  /** §27.1 "Buyer confirms possession → Buyer + dealership → Completion confirmation". */
  POSSESSION_CONFIRMED: "pickup_possession_confirmed",
  /** §27.1 "Deal completed → Buyer, dealership, AutoLenis → Executed contract, receipt, support information". */
  DEAL_COMPLETED: "deal_completed",
} as const;

/**
 * The release notice chases a possession confirmation. Once the Deal is COMPLETED the buyer has
 * confirmed, and asking again is asking for something already done — the exact class of stale
 * message §27's recheck exists to stop.
 */
const skipIfPossessionConfirmed: StateRecheckFn = async (ctx) => {
  if (!ctx.dealId) return { proceed: true };
  const deal = await ctx.db.deal.findUnique({
    where: { id: ctx.dealId },
    select: { status: true, possessionConfirmedAt: true },
  });
  if (!deal) return { proceed: false, reason: "deal no longer exists" };
  if (deal.possessionConfirmedAt || deal.status === "COMPLETED") {
    return { proceed: false, reason: "the buyer has already confirmed possession" };
  }
  return { proceed: true };
};

registerStateRecheck(PHASE_9_TEMPLATES.VEHICLE_RELEASED, skipIfPossessionConfirmed);
registerStateRecheck(
  PHASE_9_TEMPLATES.POSSESSION_CONFIRMED,
  alwaysSend("The buyer took possession. §Stage 20 makes completion terminal and corrections append-only, so the fact this reports cannot become untrue."),
);
registerStateRecheck(
  PHASE_9_TEMPLATES.DEAL_COMPLETED,
  alwaysSend("This carries the executed contract, the receipt and the support route. It is the buyer's record of the transaction; a completed deal cannot un-complete."),
);
