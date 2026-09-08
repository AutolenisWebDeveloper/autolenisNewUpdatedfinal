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
