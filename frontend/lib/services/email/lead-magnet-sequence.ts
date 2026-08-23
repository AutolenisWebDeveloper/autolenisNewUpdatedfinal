// Phase C-Leads — segmented lead-magnet nurture sequence.
//
// After a buyer downloads a free guide, they enter one of three tracks based on
// their stated buying timeline (see lib/leads/lead-magnets.ts):
//   - "ready"        → HOT  (buying within 30 days)   — short, action-forward
//   - "soon"         → WARM (buying in 1-6 months)    — education + momentum
//   - "researching"  → COLD (just researching)        — slow-drip value
//
// Day 0 is the transactional delivery email (resend.service.ts). This module
// owns the follow-up touches. Like lib/services/email/nurture-sequence.ts, every
// step is enqueued via `enqueueEmail` onto the internal comms outbox (Batch 6b —
// the retired `inngest.send('autolenis/email.send')` path) so the dispatcher
// enforces suppression, idempotency, and timeline logging. A scheduler
// (api/cron/lead-magnet-sequence) calls the due step for each lead by age.

import { logger } from "@/lib/logger";
import { enqueueEmail } from "@/lib/services/comms/comms-outbox.service";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";
import type { SequenceTrack } from "@/lib/leads/lead-magnets";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

export interface LeadMagnetStepParams {
  to: string;
  firstName: string;
  contactId: string;
  /** Title of the magnet the buyer originally requested. */
  magnetTitle: string;
}

function auctionUrl(): string {
  return `${APP_URL}/request-a-car`;
}
function calculatorUrl(): string {
  return `${APP_URL}/tools/dealer-fee-calculator`;
}
function guideUrl(): string {
  return `${APP_URL}/buying-guide`;
}
function unsubscribeUrl(email: string): string {
  return `${APP_URL}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// Idempotency keys are scoped per track + step + contact + UTC date. The cron
// only fires a step when the lead's age in days matches the step's `day`, and
// this key guards against the cron running twice in the same day.
function idemKey(track: SequenceTrack, step: number, contactId: string): string {
  return `lead-magnet-${track}-step${step}-${contactId}-${new Date()
    .toISOString()
    .slice(0, 10)}`;
}

async function queueOrSkip(
  track: SequenceTrack,
  step: number,
  params: LeadMagnetStepParams,
  subject: string,
  bodyVars: Record<string, string | number | null>,
): Promise<{ status: "queued" | "suppressed" }> {
  const supabase = getServiceSupabase();
  if (await SuppressionService.isEmailSuppressed(supabase, params.to)) {
    logger.info(`[lead-magnet] ${track} step ${step} suppressed for ${params.to}`);
    return { status: "suppressed" };
  }

  await enqueueEmail({
    contactId: params.contactId,
    email: params.to,
    subject,
    // Literal subject/body path — Phase 3 admin templates can later supply a
    // templateId; until then the drain renders from bodyVars.
    templateVariables: bodyVars,
    type: "marketing",
    idempotencyKey: idemKey(track, step, params.contactId),
  });
  return { status: "queued" };
}

function baseVars(params: LeadMagnetStepParams, email: string) {
  return {
    firstName: params.firstName,
    magnetTitle: params.magnetTitle,
    auctionUrl: auctionUrl(),
    calculatorUrl: calculatorUrl(),
    guideUrl: guideUrl(),
    unsubscribeUrl: unsubscribeUrl(email),
  };
}

// ── Track: READY (HOT — buying within 30 days) ──────────────────────────────

async function readyStep1(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "ready",
    1,
    p,
    `${p.firstName}, here's the one move that saves the most`,
    baseVars(p, p.to),
  );
}
async function readyStep2(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "ready",
    2,
    p,
    "Before you sign: run every fee through this",
    baseVars(p, p.to),
  );
}
async function readyStep3(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "ready",
    3,
    p,
    "Let 8 dealers compete instead of negotiating alone",
    baseVars(p, p.to),
  );
}

// ── Track: SOON (WARM — buying in 1-6 months) ───────────────────────────────

async function soonStep1(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "soon",
    1,
    p,
    "The 3 numbers that decide a good car deal",
    baseVars(p, p.to),
  );
}
async function soonStep2(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "soon",
    2,
    p,
    "Which dealer fees are real — and which are pure markup",
    baseVars(p, p.to),
  );
}
async function soonStep3(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "soon",
    3,
    p,
    `When you're ready, ${p.firstName}, here's the fastest way`,
    baseVars(p, p.to),
  );
}

// ── Track: RESEARCHING (COLD — just researching) ────────────────────────────

async function researchStep1(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "researching",
    1,
    p,
    "No rush — start with how car pricing actually works",
    baseVars(p, p.to),
  );
}
async function researchStep2(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "researching",
    2,
    p,
    "A free tool for when a fee looks suspicious",
    baseVars(p, p.to),
  );
}
async function researchStep3(p: LeadMagnetStepParams) {
  return queueOrSkip(
    "researching",
    3,
    p,
    "Whenever you're ready to buy, we'll be here",
    baseVars(p, p.to),
  );
}

interface SequenceStep {
  /** Days after capture this step is due. */
  day: number;
  step: number;
  send: (p: LeadMagnetStepParams) => Promise<{ status: "queued" | "suppressed" }>;
}

// Step schedules per track. Day 0 is the transactional delivery email.
export const LEAD_MAGNET_TRACKS: Record<SequenceTrack, SequenceStep[]> = {
  ready: [
    { day: 1, step: 1, send: readyStep1 },
    { day: 3, step: 2, send: readyStep2 },
    { day: 6, step: 3, send: readyStep3 },
  ],
  soon: [
    { day: 2, step: 1, send: soonStep1 },
    { day: 5, step: 2, send: soonStep2 },
    { day: 9, step: 3, send: soonStep3 },
  ],
  researching: [
    { day: 3, step: 1, send: researchStep1 },
    { day: 8, step: 2, send: researchStep2 },
    { day: 16, step: 3, send: researchStep3 },
  ],
};

/** Longest schedule day across all tracks — used by the cron's lookback window. */
export const LEAD_MAGNET_MAX_DAY = Math.max(
  ...Object.values(LEAD_MAGNET_TRACKS).flatMap((steps) =>
    steps.map((s) => s.day),
  ),
);

/** Return the step due exactly `ageDays` after capture for a track, if any. */
export function dueStep(
  track: SequenceTrack,
  ageDays: number,
): SequenceStep | undefined {
  return LEAD_MAGNET_TRACKS[track]?.find((s) => s.day === ageDays);
}
