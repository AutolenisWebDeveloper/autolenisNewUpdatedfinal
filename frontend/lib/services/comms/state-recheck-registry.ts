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
