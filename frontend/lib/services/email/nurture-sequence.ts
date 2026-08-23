// AutoLenis LP Nurture Sequence — v2 (emotional escalation arc).
//
// Every step in this sequence MUST emit via `inngest.send('autolenis/email.send')`.
// Direct `resend.emails.send()` calls are forbidden here because the Inngest
// worker (lib/inngest/functions.ts:emailSendFn) is what:
//   - checks email_suppression (SuppressionService)
//   - enforces idempotency
//   - records send attempts in contact_timeline_events for the admin
//   - routes failed sends to the dead-letter queue
//
// The cron at /api/cron/nurture-sequence (or any scheduler) calls these
// functions; each function is responsible for guarding suppression and
// queuing one Inngest job.

import { logger } from "@/lib/logger";
import { enqueueEmail } from "@/lib/services/comms/comms-outbox.service";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

interface NurtureParams {
  to: string;
  firstName: string;
  contactId: string;
  vehicleType?: string;
  budget?: string;
  timeline?: string;
}

// Single source of truth for the activation CTA every step links to.
function activateUrl(): string {
  return `${APP_URL}/auth/signup?plan=standard&source=lp`;
}
function unsubscribeUrl(email: string): string {
  return `${APP_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// Idempotency keys are scoped per step + contact + UTC date. Re-running the
// cron on the same day will not produce a duplicate send for the same step.
function idemKey(step: number, contactId: string): string {
  return `lp-nurture-step${step}-${contactId}-${new Date().toISOString().slice(0, 10)}`;
}

async function queueOrSkip(
  step: number,
  params: NurtureParams,
  subject: string,
  templateId: string | null,
  bodyVars: Record<string, string | number | null>,
): Promise<{ status: "queued" | "suppressed" }> {
  const supabase = getServiceSupabase();
  if (await SuppressionService.isEmailSuppressed(supabase, params.to)) {
    logger.info(`[nurture] step ${step} suppressed for ${params.to}`);
    return { status: "suppressed" };
  }

  await enqueueEmail({
    contactId:        params.contactId,
    email:            params.to,
    subject,
    // templateId is null when using the literal subject/html path. Phase 3
    // templates are populated by ops via the admin template manager; once
    // they exist the templateId points at the rendered row.
    templateId:       templateId ?? undefined,
    templateVariables: bodyVars,
    type:             "marketing",
    idempotencyKey:   idemKey(step, params.contactId),
  });
  return { status: "queued" };
}

// ── Step 1 · Day 0 (immediate) — Reassurance + activation ────────────────
export async function sendStep1ConfirmationEmail(params: NurtureParams) {
  return queueOrSkip(1, params, `Your auction is prepared, ${params.firstName}`, null, {
    firstName:      params.firstName,
    vehicleMake:    params.vehicleType ?? "",
    dashboardUrl:   activateUrl(),
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// ── Step 2 · Day 0 + 4h — Identity reframe ───────────────────────────────
export async function sendStep2IdentityEmail(params: NurtureParams) {
  return queueOrSkip(
    2,
    params,
    `${params.firstName}, you are not the person on the showroom floor`,
    null,
    {
      firstName:      params.firstName,
      depositUrl:     activateUrl(),
      unsubscribeUrl: unsubscribeUrl(params.to),
    },
  );
}

// ── Step 3 · Day 1 — Loss aversion ───────────────────────────────────────
export async function sendStep3LossAversionEmail(params: NurtureParams) {
  return queueOrSkip(3, params, "The hidden cost of negotiating alone", null, {
    firstName:      params.firstName,
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// ── Step 4 · Day 3 — Mechanism revelation ────────────────────────────────
export async function sendStep4MechanismEmail(params: NurtureParams) {
  return queueOrSkip(4, params, "How a 48-hour dealer auction actually works", null, {
    firstName:      params.firstName,
    auctionUrl:     activateUrl(),
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// ── Step 5 · Day 5 — Empowerment ─────────────────────────────────────────
export async function sendStep5EmpowermentEmail(params: NurtureParams) {
  return queueOrSkip(5, params, "How to read a dealer offer like an insider", null, {
    firstName:      params.firstName,
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// ── Step 6 · Day 7 — Pattern interrupt ───────────────────────────────────
export async function sendStep6PatternInterruptEmail(params: NurtureParams) {
  return queueOrSkip(
    6,
    params,
    `${params.firstName}, the dealership is still waiting for you`,
    null,
    {
      firstName:      params.firstName,
      depositUrl:     activateUrl(),
      unsubscribeUrl: unsubscribeUrl(params.to),
    },
  );
}

// ── Step 7 · Day 14 — Social proof ───────────────────────────────────────
export async function sendStep7SocialProofEmail(params: NurtureParams) {
  return queueOrSkip(
    7,
    params,
    "What changed for buyers who let dealers compete",
    null,
    {
      firstName:      params.firstName,
      depositUrl:     activateUrl(),
      unsubscribeUrl: unsubscribeUrl(params.to),
    },
  );
}

// ── Step 8 · Day 21 — Direct closure ─────────────────────────────────────
export async function sendStep8ClosureEmail(params: NurtureParams) {
  return queueOrSkip(8, params, `Last touch from AutoLenis, ${params.firstName}`, null, {
    firstName:      params.firstName,
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// ── Step 9 · Day 30 — Sunset ─────────────────────────────────────────────
export async function sendStep9SunsetEmail(params: NurtureParams) {
  return queueOrSkip(9, params, "We will be here when the time is right", null, {
    firstName:      params.firstName,
    depositUrl:     activateUrl(),
    unsubscribeUrl: unsubscribeUrl(params.to),
  });
}

// Convenience map used by a future cron to dispatch by step number.
export const NURTURE_STEPS = {
  1: sendStep1ConfirmationEmail,
  2: sendStep2IdentityEmail,
  3: sendStep3LossAversionEmail,
  4: sendStep4MechanismEmail,
  5: sendStep5EmpowermentEmail,
  6: sendStep6PatternInterruptEmail,
  7: sendStep7SocialProofEmail,
  8: sendStep8ClosureEmail,
  9: sendStep9SunsetEmail,
} as const;

export type NurtureStep = keyof typeof NURTURE_STEPS;
