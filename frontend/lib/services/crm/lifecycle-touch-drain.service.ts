// Lifecycle communications drain — internal parity for the 12 deferred QStash
// lifecycle-notification jobs (deposit-reminder, auction-active/-midpoint/
// -closing, dealer-invited, offer-received, offer-follow-up, deal-complete,
// form-submitted, check-form-completion, review-request). Consolidated +
// sequence-discriminated (the SAME multi-sequence shape as
// lib/services/crm/outreach-touch-drain.service.ts), NOT a generalized queue — it
// holds exactly the fixed lifecycle touches in SEQUENCES below.
//
// `enqueueLifecycleTouch` inserts one durable `lifecycle_touch_schedule` row
// (run_at = the QStash delay). The `lifecycle-touch-drain` cron sends each DUE
// touch through the SAME `notifyContact` layer (TCPA/DNC/suppression/STOP gated)
// the QStash routes used, then chains the next touch. Message bodies are ported
// verbatim from the QStash routes so cutover is behaviour-neutral.
//
// DORMANT until the owner-gated atomic cutover: nothing calls
// `enqueueLifecycleTouch` yet — every lifecycle touch is still dispatched to
// QStash from its existing producer. While the table is empty/absent the drain
// no-ops (NO_DUE / NO_TABLE), so deploying this code before cutover is safe.
//
// Parity + improvements vs the QStash jobs:
//   • Conversion guards (hasPaidDeposit / hasSelectedOffer) are re-checked at
//     drain time exactly as each QStash job re-reads state on delivery; a
//     converted buyer is 'canceled' (no send, no chain), never chased.
//   • FIX: `auction_closing` gains the `hasSelectedOffer` guard the QStash
//     `auction-closing` job was missing.
//   • CONSOLIDATION: `dealer_invited` does NOT chain a bid reminder — the
//     endsAt-driven idempotent `cron/dealer-invitation-reminder` owns that, so
//     QStash `dealer-bid-reminder` is retired (not ported) at cutover.
//   • COUPLED CUTOVER: `review_request` on send enqueues the day-60 refinance
//     outreach + day-27 referral nudge via the dormant internal enqueue
//     functions (replacing the two QStash dispatch() calls in review-request).
//   • Zero duplicate sends: UNIQUE(base_key, sequence) makes each touch
//     enqueue-once (closing the QStash "producer fires twice → two sends" gap);
//     terminal failure is COLUMNS-ONLY (status='failed') — nothing to
//     jobs_dead_letter, so no DLQ branch can resurrect a touch. A gated/
//     suppressed send is a terminal success (consent respected), as the QStash
//     job treats it.

import { logger } from "@/lib/logger";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import { depositConversionResolved, preCheckoutResolved, hasSelectedOffer } from "@/lib/qstash/state";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import type { SupabaseClient } from "@supabase/supabase-js";

// PRE-CHECKOUT resume link: mint a fresh, single-use, hashed resume token per send
// (raw token lives only in this email; only its SHA-256 hash is persisted) and
// build the opaque resume URL. The link carries NO PII and no capability — it
// deep-links to the auth-gated $99 checkout for the preserved request.
async function preCheckoutResumeUrl(buyerId: string): Promise<{ resumeUrl: string }> {
  const { issueResumeToken } = await import("@/lib/services/buyer/request-resume-token.service");
  const { rawToken } = await issueResumeToken({ buyerId });
  return { resumeUrl: `${NOTIFY_APP_URL}/api/public/request/resume/${rawToken}` };
}

const SEC = 1000;
const MIN = 60 * SEC;
const DRAIN_BATCH = 100;
const STALE_MS = 10 * MIN; // > drain maxDuration; a stale 'sending' row is reclaimable
const MAX_ATTEMPTS = 4;

export type LifecycleSequence =
  | "deposit_reminder_1" | "deposit_reminder_2" | "deposit_reminder_3" | "deposit_reminder_4"
  | "auction_active" | "auction_midpoint" | "auction_closing"
  | "dealer_invited"
  | "offer_received" | "offer_follow_up_1" | "offer_follow_up_2"
  | "deal_complete" | "review_request"
  | "form_submitted" | "check_form_completion_1" | "check_form_completion_2" | "check_form_completion_3";

type Entity = "buyer" | "dealer";

interface RenderedTouch {
  sms: string;
  emailSubject: string;
  emailHtml: string;
}

interface RowContext {
  entityId: string;
  firstName: string;
  email: string;
  /** Populated by a sequence's `prepare` hook (e.g. the pre-checkout resume link). */
  resumeUrl?: string;
}

interface SequenceConfig {
  entityType: Entity;
  // Re-checked at drain time. Returns true when the buyer has already converted
  // (deposit paid / offer selected) → the touch is canceled, never sent.
  guard?: (entityId: string) => Promise<boolean>;
  // Optional async pre-render step run AFTER the guard passes and BEFORE render.
  // Its result is merged into the render context (e.g. pre-checkout mints a fresh
  // resume token and returns { resumeUrl }). A throw here fails the touch like a
  // send failure (bounded retry) — a converted/ineligible buyer never reaches it
  // because the guard already canceled the touch.
  prepare?: (entityId: string) => Promise<Partial<RowContext>>;
  render: (ctx: RowContext) => RenderedTouch;
  // The next touch to chain, or null if terminal. delayMs mirrors the QStash delay.
  next: { sequence: LifecycleSequence; delayMs: number } | null;
  // When true, notifyContact is called WITHOUT email/phone so the target resolves
  // from the linked contact — exact parity with the QStash `check-form-completion`
  // job, which passed only entityId. (The other jobs pass email explicitly, so
  // they must NOT set this.) Prevents the internal path from reaching a buyer with
  // no linked contact that the QStash job would have skipped.
  deliverToContactOnly?: boolean;
  // Extra side effects fired AFTER a successful send + status=done (used only by
  // review_request to seed the refinance + referral cross-table touches). Runs
  // best-effort: a failure here must never re-send the (non-deduped) notify.
  postSend?: (ctx: { entityId: string; firstName: string | null; email: string }) => Promise<void>;
}

const DASH = `${NOTIFY_APP_URL}/buyer/dashboard`;
// The $99 conversion CTA returns the buyer DIRECTLY to the existing checkout for
// their preserved competitive request (Section 2/9), not the dashboard.
const DEPOSIT_CHECKOUT = `${NOTIFY_APP_URL}/buyer/deposit`;

// Message bodies ported verbatim from app/api/jobs/<name>/route.ts, EXCEPT the
// deposit-reminder set below, which the $99-conversion program deliberately
// re-cadences (+1h/+6h/+24h/+72h, 4 touches) and re-copies (truthful,
// conversion-focused, CTA → the $99 checkout). See deposit_reminder_1 header.
const SEQUENCES: Record<LifecycleSequence, SequenceConfig> = {
  // ── $99 deposit conversion (4 touches: +1h/+6h/+24h/+72h) ─────────────────
  // Producer enrolls deposit_reminder_1 at run_at = now + 1h (the intentional
  // first-touch grace: never chase a buyer who may still be completing checkout).
  // Each touch's guard (depositConversionResolved) re-reads live state at send
  // time and cancels the whole chain the instant the buyer no longer owes the $99
  // (paid, or the pending intent is gone). Every message is truthful: the request
  // is saved, the $99 is the next step, and dealer/auction fulfillment begins
  // only AFTER payment — no fabricated dealer interest, bidding, offers, savings,
  // urgency, or scarcity. CTA → the $99 checkout for the preserved request.
  deposit_reminder_1: {
    entityType: "buyer",
    guard: depositConversionResolved,
    render: ({ firstName }) => ({
      sms: `Hi ${firstName} — your AutoLenis vehicle request is saved. Complete your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit to start: autolenis.com/buyer/deposit`,
      emailSubject: "Your vehicle request is saved — one step left",
      emailHtml: renderEmail({
        heading: "Your vehicle request is saved",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your vehicle request is saved. The next step is your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong>. Once it's paid, local dealers begin competing for your vehicle in a private auction.</p>`,
        ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
        ctaUrl: DEPOSIT_CHECKOUT,
      }),
    }),
    next: { sequence: "deposit_reminder_2", delayMs: 5 * 60 * MIN }, // +5h → +6h from enrollment
  },
  deposit_reminder_2: {
    entityType: "buyer",
    guard: depositConversionResolved,
    render: ({ firstName }) => ({
      sms: `${firstName}, your saved AutoLenis request is ready. The ${DEPOSIT_AMOUNT_USD} Auction Access Deposit is the next step to let dealers compete: autolenis.com/buyer/deposit`,
      emailSubject: "One step to activate your dealer auction",
      emailHtml: renderEmail({
        heading: "Your request is ready to activate",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your vehicle request is still saved. Completing your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong> is all that's left — dealer bidding begins right after payment.</p>`,
        ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
        ctaUrl: DEPOSIT_CHECKOUT,
      }),
    }),
    next: { sequence: "deposit_reminder_3", delayMs: 18 * 60 * MIN }, // +18h → +24h from enrollment
  },
  deposit_reminder_3: {
    entityType: "buyer",
    guard: depositConversionResolved,
    render: ({ firstName }) => ({
      sms: `${firstName}, your AutoLenis request is still saved. Complete the ${DEPOSIT_AMOUNT_USD} Auction Access Deposit to activate your dealer auction: autolenis.com/buyer/deposit`,
      emailSubject: "Your vehicle request is still waiting",
      emailHtml: renderEmail({
        heading: "Your vehicle request is still waiting",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your request is saved and ready. When you complete your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong>, dealers start competing for your vehicle — you keep everything you've entered, no need to start over.</p>`,
        ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
        ctaUrl: DEPOSIT_CHECKOUT,
      }),
    }),
    next: { sequence: "deposit_reminder_4", delayMs: 48 * 60 * MIN }, // +48h → +72h from enrollment
  },
  deposit_reminder_4: {
    entityType: "buyer",
    guard: depositConversionResolved,
    render: ({ firstName }) => ({
      sms: `${firstName}, this is our last reminder — your AutoLenis request is saved. Complete the ${DEPOSIT_AMOUNT_USD} Auction Access Deposit whenever you're ready: autolenis.com/buyer/deposit`,
      emailSubject: "Last reminder: your saved vehicle request",
      emailHtml: renderEmail({
        heading: "Last reminder about your saved request",
        bodyHtml: `<p>Hi ${firstName},</p><p>This is the last reminder we'll send. Your vehicle request is still saved, and your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong> is the only step left to let dealers compete. You can complete it any time.</p>`,
        ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
        ctaUrl: DEPOSIT_CHECKOUT,
      }),
    }),
    next: null,
  },

  // ── auction lifecycle (active → midpoint → closing) ───────────────────────
  auction_active: {
    entityType: "buyer",
    render: ({ firstName }) => ({
      sms: `Your auction is LIVE ${firstName}! Dealers are competing for your vehicle. Check offers: autolenis.com/buyer/dashboard`,
      emailSubject: "Your dealer auction is live",
      emailHtml: renderEmail({
        heading: "Your dealer auction is live",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your private auction is now live and dealers are competing for your vehicle. Offers will appear on your dashboard as they come in.</p>`,
        ctaText: "View live offers",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "auction_midpoint", delayMs: 43200 * SEC },
  },
  auction_midpoint: {
    entityType: "buyer",
    guard: hasSelectedOffer,
    render: ({ firstName }) => ({
      sms: `${firstName}, your AutoLenis auction is halfway done and dealers are still bidding. See the latest offers: autolenis.com/buyer/dashboard`,
      emailSubject: "Your auction is halfway done",
      emailHtml: renderEmail({
        heading: "Your auction is halfway done",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your auction is at its midpoint and dealers are still competing. Check in to see how the offers are shaping up.</p>`,
        ctaText: "See current offers",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "auction_closing", delayMs: 43200 * SEC },
  },
  auction_closing: {
    entityType: "buyer",
    // FIX: the QStash `auction-closing` job had NO guard and sent even after the
    // buyer selected an offer. Parity-correct: skip a converted buyer.
    guard: hasSelectedOffer,
    render: ({ firstName }) => ({
      sms: `${firstName} — your auction closes soon. Compare your dealer offers now: autolenis.com/buyer/dashboard`,
      emailSubject: "Your auction results are ready",
      emailHtml: renderEmail({
        heading: "Your auction results are ready",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your auction is wrapping up. Review and compare your dealer offers now so you can pick the best one before it closes.</p>`,
        ctaText: "Compare dealer offers",
        ctaUrl: DASH,
      }),
    }),
    next: null,
  },

  // ── dealer-invited (single touch; bid reminder owned by the existing cron) ─
  dealer_invited: {
    entityType: "dealer",
    render: ({ firstName }) => ({
      sms: `New auction invitation ${firstName}! A buyer needs a vehicle matching your inventory. Submit your offer: autolenis.com/dealer/auctions`,
      emailSubject: "New buyer auction invitation",
      emailHtml: renderEmail({
        heading: "New buyer auction invitation",
        bodyHtml: `<p>Hi ${firstName},</p><p>A buyer needs a vehicle matching your inventory and you've been invited to compete. Submit your best offer before the auction closes.</p>`,
        ctaText: "Submit your offer",
        ctaUrl: `${NOTIFY_APP_URL}/dealer/auctions`,
      }),
    }),
    next: null,
  },

  // ── offer-received → offer-follow-up (2 touches, guard hasSelectedOffer) ───
  offer_received: {
    entityType: "buyer",
    render: ({ firstName }) => ({
      sms: `${firstName} — a dealer just submitted an offer for your vehicle! Compare now: autolenis.com/buyer/dashboard`,
      emailSubject: "A dealer submitted an offer for you",
      emailHtml: renderEmail({
        heading: "A dealer submitted an offer for you",
        bodyHtml: `<p>Hi ${firstName},</p><p>Great news — a dealer just submitted an offer for your vehicle. Review the details and see how it stacks up.</p>`,
        ctaText: "Compare the offer",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "offer_follow_up_1", delayMs: 14400 * SEC },
  },
  offer_follow_up_1: {
    entityType: "buyer",
    guard: hasSelectedOffer,
    render: ({ firstName }) => ({
      sms: `${firstName}, your dealer offer is waiting. Review it before it expires: autolenis.com/buyer/dashboard`,
      emailSubject: "Your dealer offer is waiting",
      emailHtml: renderEmail({
        heading: "Your dealer offer is waiting",
        bodyHtml: `<p>Hi ${firstName},</p><p>You have a dealer offer waiting for review. Take a look so you don't miss out.</p>`,
        ctaText: "Review your offer",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "offer_follow_up_2", delayMs: 72000 * SEC },
  },
  offer_follow_up_2: {
    entityType: "buyer",
    guard: hasSelectedOffer,
    render: ({ firstName }) => ({
      sms: `${firstName}, last chance to review your dealer offer before it expires: autolenis.com/buyer/dashboard`,
      emailSubject: "Last chance to review your offer",
      emailHtml: renderEmail({
        heading: "Last chance to review your offer",
        bodyHtml: `<p>Hi ${firstName},</p><p>This is your final reminder — your dealer offer is about to expire. Review it now to lock in your decision.</p>`,
        ctaText: "Review before it expires",
        ctaUrl: DASH,
      }),
    }),
    next: null,
  },

  // ── deal-complete → review-request (coupled to refinance + referral) ───────
  deal_complete: {
    entityType: "buyer",
    render: ({ firstName }) => ({
      sms: `Congratulations ${firstName}! Your AutoLenis deal is complete. Know someone car shopping? Share AutoLenis: autolenis.com`,
      emailSubject: "Congratulations — your deal is complete",
      emailHtml: renderEmail({
        heading: "Congratulations — your deal is complete!",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your AutoLenis deal is complete — enjoy your new vehicle!</p><p>Know someone else who's car shopping? Share your referral link and help them let dealers compete too.</p>`,
        ctaText: "Share your referral link",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/referral`,
      }),
    }),
    next: { sequence: "review_request", delayMs: 259200 * SEC },
  },
  review_request: {
    entityType: "buyer",
    render: ({ firstName }) => ({
      sms: `${firstName}, how was your AutoLenis experience? We'd love your feedback: autolenis.com/feedback`,
      emailSubject: "How was your AutoLenis experience?",
      emailHtml: renderEmail({
        heading: "How was your AutoLenis experience?",
        bodyHtml: `<p>Hi ${firstName},</p><p>Now that your deal is done, we'd love to hear how it went. Your feedback helps us make dealers compete even harder for the next buyer.</p>`,
        ctaText: "Leave a review",
        ctaUrl: `${NOTIFY_APP_URL}/feedback`,
      }),
    }),
    next: null,
    // Coupled cutover: replaces the two QStash dispatch() calls in review-request.
    postSend: async ({ entityId, firstName, email }) => {
      const now = Date.now();
      const [{ enqueueRefinanceOutreach }, { enqueueOutreachTouch }] = await Promise.all([
        import("@/lib/services/refinance/refinance-outreach-drain.service"),
        import("@/lib/services/crm/outreach-touch-drain.service"),
      ]);
      // Day 60 — refinance outreach (best-effort: mirrors the QStash `.catch()`).
      await enqueueRefinanceOutreach({
        buyerId: entityId,
        firstName: firstName || null,
        email,
        leadId: entityId,
        runAt: new Date(now + 5184000 * SEC),
      }).catch((err) => logger.error("[lifecycle-touch] refinance enqueue failed:", err));
      // Day 27 — referral nudge.
      await enqueueOutreachTouch({
        sequence: "referral_nudge",
        entityId,
        firstName: firstName || null,
        email,
        baseKey: `referral-nudge:${entityId}`,
        runAt: new Date(now + 2332800 * SEC),
      }).catch((err) => logger.error("[lifecycle-touch] referral enqueue failed:", err));
    },
  },

  // ── $99 PRE-CHECKOUT conversion (form_submitted → check_form_completion) ───
  // Stage 1 of the same $99 funnel, for a saved request whose lead has NOT yet
  // reached checkout (no PENDING/PAID deposit). Every touch:
  //   • re-reads live state (guard preCheckoutResolved) and STOPS the chain the
  //     moment a Deposit exists (hand off to post-checkout deposit_reminder) or the
  //     request is cancelled/expired — the two stages never run together;
  //   • mints a fresh single-use SECURE resume link (prepare) — no PII in the URL,
  //     returns the lead to their preserved request → auth/claim → the $99 checkout,
  //     no vehicle re-entry;
  //   • is TRUTHFUL: the request is saved and paying the $99 activates AutoLenis
  //     fulfillment + dealer competition. No claim that dealers are already
  //     waiting/competing/bidding, no offers/savings, no false scarcity.
  form_submitted: {
    entityType: "buyer",
    guard: preCheckoutResolved,
    prepare: preCheckoutResumeUrl,
    render: ({ firstName, resumeUrl }) => {
      const cta = resumeUrl ?? DEPOSIT_CHECKOUT;
      return {
        sms: `Hi ${firstName} — your AutoLenis vehicle request is saved. Complete your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit to activate dealer competition: ${cta}`,
        emailSubject: "Your vehicle request is saved — one step left",
        emailHtml: renderEmail({
          heading: `Your vehicle request is saved, ${firstName}`,
          bodyHtml: `<p>Thanks for reaching out — your vehicle request is saved.</p><p>The next step is your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong>. Paying it activates AutoLenis and starts a private auction where local dealers compete for your vehicle. You can pick up right where you left off — nothing to re-enter.</p>`,
          ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
          ctaUrl: cta,
        }),
      };
    },
    next: { sequence: "check_form_completion_1", delayMs: 3600 * SEC }, // +1h
  },
  check_form_completion_1: {
    entityType: "buyer",
    guard: preCheckoutResolved,
    prepare: preCheckoutResumeUrl,
    deliverToContactOnly: true,
    render: ({ firstName, resumeUrl }) => {
      const cta = resumeUrl ?? DEPOSIT_CHECKOUT;
      return {
        sms: `${firstName}, your AutoLenis vehicle request is saved and ready. Complete your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit to activate dealer competition: ${cta}`,
        emailSubject: "One step to activate your dealer auction",
        emailHtml: renderEmail({
          heading: "Your request is ready to activate",
          bodyHtml: `<p>Hi ${firstName},</p><p>Your vehicle request is saved. Completing your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong> is all that's left — it activates AutoLenis and starts the dealer competition for your vehicle.</p>`,
          ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
          ctaUrl: cta,
        }),
      };
    },
    next: { sequence: "check_form_completion_2", delayMs: 82800 * SEC }, // +23h → ~+24h
  },
  check_form_completion_2: {
    entityType: "buyer",
    guard: preCheckoutResolved,
    prepare: preCheckoutResumeUrl,
    deliverToContactOnly: true,
    render: ({ firstName, resumeUrl }) => {
      const cta = resumeUrl ?? DEPOSIT_CHECKOUT;
      return {
        sms: `${firstName}, your saved AutoLenis request is still waiting. Complete your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit to put dealers to work: ${cta}`,
        emailSubject: "Your vehicle request is still waiting",
        emailHtml: renderEmail({
          heading: "Your vehicle request is still waiting",
          bodyHtml: `<p>Hi ${firstName},</p><p>Your request is saved and ready. When you complete your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong>, AutoLenis activates and dealers begin competing for your vehicle — you keep everything you entered, no need to start over.</p>`,
          ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
          ctaUrl: cta,
        }),
      };
    },
    next: { sequence: "check_form_completion_3", delayMs: 259200 * SEC }, // +72h
  },
  check_form_completion_3: {
    entityType: "buyer",
    guard: preCheckoutResolved,
    prepare: preCheckoutResumeUrl,
    deliverToContactOnly: true,
    render: ({ firstName, resumeUrl }) => {
      const cta = resumeUrl ?? DEPOSIT_CHECKOUT;
      return {
        sms: `${firstName}, this is our last reminder — your AutoLenis request is saved. Complete your ${DEPOSIT_AMOUNT_USD} Auction Access Deposit whenever you're ready: ${cta}`,
        emailSubject: "Last reminder: your saved vehicle request",
        emailHtml: renderEmail({
          heading: "Last reminder about your saved request",
          bodyHtml: `<p>Hi ${firstName},</p><p>This is the last reminder we'll send. Your vehicle request is still saved, and your <strong>${DEPOSIT_AMOUNT_USD} Auction Access Deposit</strong> is the only step left to activate AutoLenis and let dealers compete for your vehicle. You can complete it any time.</p>`,
          ctaText: `Complete your ${DEPOSIT_AMOUNT_USD} deposit`,
          ctaUrl: cta,
        }),
      };
    },
    next: null,
  },
};

// Lazy service-role client (imported at call time, not module load, so importing
// enqueueLifecycleTouch for typing doesn't pull the `server-only` supabase-service).
async function serviceClient(): Promise<SupabaseClient> {
  const { getServiceSupabase } = await import("@/lib/supabase-service");
  return getServiceSupabase();
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

export interface EnqueueLifecycleTouchInput {
  sequence: LifecycleSequence;
  entityId: string;
  firstName: string | null;
  email: string;
  phone?: string | null;
  /** Stable per-enrollment key; the chain reuses it across the sequence's touches. */
  baseKey: string;
  /** Defaults to now (immediate). Override for a delayed touch. */
  runAt?: Date;
}

// Schedule one lifecycle touch. Idempotent: UNIQUE(base_key, sequence) → a
// duplicate enqueue adds no row. (DORMANT — no production caller until cutover.)
export async function enqueueLifecycleTouch(
  input: EnqueueLifecycleTouchInput,
  opts: { supabase?: SupabaseClient } = {},
): Promise<{ scheduled: boolean }> {
  if (!SEQUENCES[input.sequence]) throw new Error(`lifecycle_touch_unknown_sequence: ${input.sequence}`);
  const supabase = opts.supabase ?? (await serviceClient());
  const runAt = (input.runAt ?? new Date()).toISOString();

  const { data, error } = await supabase
    .from("lifecycle_touch_schedule")
    .upsert(
      {
        base_key: input.baseKey,
        sequence: input.sequence,
        entity_id: input.entityId,
        first_name: input.firstName,
        email: input.email,
        phone: input.phone ?? null,
        run_at: runAt,
        status: "pending",
      },
      { onConflict: "base_key,sequence", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`lifecycle_touch_enqueue_failed: ${error.message}`);
  return { scheduled: Array.isArray(data) && data.length > 0 };
}

// Stable base_key for a buyer's $99 deposit-conversion enrollment. One chain per
// buyer (the competitive deposit is per-buyer, built from the shortlist), so this
// key both dedupes enrollment (UNIQUE(base_key, sequence)) and addresses the chain
// for cancellation.
export function depositReminderBaseKey(buyerId: string): string {
  return `deposit-reminder:${buyerId}`;
}

const DEPOSIT_REMINDER_SEQUENCES: LifecycleSequence[] = [
  "deposit_reminder_1", "deposit_reminder_2", "deposit_reminder_3", "deposit_reminder_4",
];

// Proactively cancel a buyer's remaining $99 deposit-conversion touches (Section
// 4/6). Called on authoritative payment (webhook), and available for cancellation
// on request-cancel/expire. Idempotent: only pending/sending rows are moved to
// 'canceled'; already-done/canceled/failed rows are untouched, and a converted
// buyer whose row races past this is still caught by the send-time guard
// (depositConversionResolved) — the guard, not this cancel, is authoritative.
// DORMANT-safe: a missing table is swallowed (the internal path is not yet cut over).
export async function cancelDepositReminderTouches(
  buyerId: string,
  opts: { supabase?: SupabaseClient; reason?: string } = {},
): Promise<{ canceled: number; status: "OK" | "NO_TABLE" }> {
  const supabase = opts.supabase ?? (await serviceClient());
  const { data, error } = await supabase
    .from("lifecycle_touch_schedule")
    .update({
      status: "canceled",
      last_error: opts.reason ?? "deposit_converted",
      updated_at: new Date().toISOString(),
    })
    .eq("base_key", depositReminderBaseKey(buyerId))
    .in("sequence", DEPOSIT_REMINDER_SEQUENCES)
    .in("status", ["pending", "sending"])
    .select("id");
  if (error) {
    if (isMissingTable(error)) return { canceled: 0, status: "NO_TABLE" };
    throw new Error(`lifecycle_touch_cancel_failed: ${error.message}`);
  }
  return { canceled: Array.isArray(data) ? data.length : 0, status: "OK" };
}

// Stable base_key for a buyer's $99 PRE-CHECKOUT conversion enrollment. Distinct
// from the post-checkout deposit-reminder chain so the handoff can cancel one
// without touching the other.
export function preCheckoutBaseKey(buyerId: string): string {
  return `precheckout:${buyerId}`;
}

const PRE_CHECKOUT_SEQUENCES: LifecycleSequence[] = [
  "form_submitted", "check_form_completion_1", "check_form_completion_2", "check_form_completion_3",
];

// Proactively cancel a buyer's remaining PRE-CHECKOUT touches. Called at the
// handoff moment — when checkout creates the competitive PENDING deposit
// (create-intent) — so the pre-checkout stage stops the instant the post-checkout
// deposit_reminder takes over. Belt-and-suspenders with the send-time guard
// (preCheckoutResolved), which is authoritative on its own. Idempotent;
// DORMANT-safe (missing table swallowed).
export async function cancelPreCheckoutTouches(
  buyerId: string,
  opts: { supabase?: SupabaseClient; reason?: string } = {},
): Promise<{ canceled: number; status: "OK" | "NO_TABLE" }> {
  const supabase = opts.supabase ?? (await serviceClient());
  const { data, error } = await supabase
    .from("lifecycle_touch_schedule")
    .update({
      status: "canceled",
      last_error: opts.reason ?? "checkout_started",
      updated_at: new Date().toISOString(),
    })
    .eq("base_key", preCheckoutBaseKey(buyerId))
    .in("sequence", PRE_CHECKOUT_SEQUENCES)
    .in("status", ["pending", "sending"])
    .select("id");
  if (error) {
    if (isMissingTable(error)) return { canceled: 0, status: "NO_TABLE" };
    throw new Error(`lifecycle_touch_cancel_failed: ${error.message}`);
  }
  return { canceled: Array.isArray(data) ? data.length : 0, status: "OK" };
}

interface TouchRow {
  id: string;
  base_key: string;
  sequence: LifecycleSequence;
  entity_id: string;
  first_name: string | null;
  email: string;
  phone: string | null;
  attempts: number;
}

export interface LifecycleDrainSummary {
  status: "OK" | "NO_DUE" | "NO_TABLE";
  due: number;
  sent: number;
  canceled: number; // converted (guard hit) or unknown sequence
  skipped: number; // lost claim
  retried: number;
  failed: number;
}

async function markStatus(
  supabase: SupabaseClient,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  await supabase
    .from("lifecycle_touch_schedule")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

// Process one claimed touch: guard → render → send → chain → postSend. Mirrors
// the QStash route body (including its early-exit-on-conversion behaviour).
async function processTouch(supabase: SupabaseClient, row: TouchRow): Promise<"SENT" | "CANCELED"> {
  const cfg = SEQUENCES[row.sequence];
  if (!cfg) {
    await markStatus(supabase, row.id, "canceled", { last_error: `unknown_sequence:${row.sequence}` });
    return "CANCELED";
  }

  // Conversion guard — re-read live state, exactly as the QStash job did on each
  // delivery. Converted → cancel the touch (no send, no chain), never chase.
  if (cfg.guard && (await cfg.guard(row.entity_id))) {
    await markStatus(supabase, row.id, "canceled", { last_error: "converted" });
    return "CANCELED";
  }

  const ctx: RowContext = {
    entityId: row.entity_id,
    firstName: row.first_name ?? "there",
    email: row.email,
  };

  // Optional async pre-render step (runs only AFTER the guard passed, so a
  // converted/ineligible buyer never mints a resume token). A throw propagates to
  // the drain loop as a bounded retry — safe, since nothing has been sent yet.
  if (cfg.prepare) {
    Object.assign(ctx, await cfg.prepare(row.entity_id));
  }

  const content = cfg.render(ctx);

  // notifyContact fails closed (returns {false,false}) on a gated/suppressed/
  // unconfigured send and only throws on an unexpected error — a gated send is a
  // terminal success, not a retry (parity with the QStash route). For
  // deliverToContactOnly sequences (check-form-completion), email/phone are
  // omitted so the target resolves from the linked contact — exact parity with
  // the QStash job, which passed only entityId (so a buyer with no linked
  // contact is reached by neither path).
  await notifyContact({
    entityType: cfg.entityType,
    entityId: row.entity_id,
    ...(cfg.deliverToContactOnly
      ? {}
      : { email: row.email, ...(row.phone ? { phone: row.phone } : {}) }),
    sms: content.sms,
    emailSubject: content.emailSubject,
    emailHtml: content.emailHtml,
  });

  // Mark done BEFORE chaining/postSend so a follow-up failure can never re-send
  // the (non-deduped) notify on retry.
  await markStatus(supabase, row.id, "done");

  // Chain the next touch (enqueue-once on base_key+sequence). Best-effort: the
  // row is already 'done', so a chain-write failure must NOT propagate to the
  // drain loop (which would reset the row to pending and re-send the notify) — a
  // dropped chain step is recoverable by a re-enqueue, a double send is not.
  if (cfg.next) {
    try {
      await supabase.from("lifecycle_touch_schedule").upsert(
        {
          base_key: row.base_key,
          sequence: cfg.next.sequence,
          entity_id: row.entity_id,
          first_name: row.first_name,
          email: row.email,
          phone: row.phone,
          run_at: new Date(Date.now() + cfg.next.delayMs).toISOString(),
          status: "pending",
        },
        { onConflict: "base_key,sequence", ignoreDuplicates: true },
      );
    } catch (err) {
      logger.error("[lifecycle-touch] chain enqueue failed:", err);
    }
  }

  // Cross-table coupling (review_request → refinance + referral). Best-effort:
  // the enqueues are enqueue-once, and the row is already 'done', so a failure
  // never re-sends the review notify — it can be recovered by a re-enqueue.
  // Uses the RAW first_name (nullable) so a missing name is not persisted
  // downstream as the literal "there".
  if (cfg.postSend) {
    await cfg
      .postSend({ entityId: row.entity_id, firstName: row.first_name, email: row.email })
      .catch((err) => logger.error("[lifecycle-touch] postSend failed:", err));
  }

  return "SENT";
}

export async function drainDueLifecycleTouches(): Promise<LifecycleDrainSummary> {
  const supabase = await serviceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("lifecycle_touch_schedule")
    .select("id")
    .lte("run_at", now)
    .in("status", ["pending", "sending"])
    .order("run_at", { ascending: true })
    .limit(DRAIN_BATCH);

  if (error) {
    if (isMissingTable(error)) return { status: "NO_TABLE", due: 0, sent: 0, canceled: 0, skipped: 0, retried: 0, failed: 0 };
    throw new Error(`lifecycle_touch_due_query_failed: ${error.message}`);
  }

  const due = data ?? [];
  if (due.length === 0) return { status: "NO_DUE", due: 0, sent: 0, canceled: 0, skipped: 0, retried: 0, failed: 0 };

  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  let sent = 0;
  let canceled = 0;
  let skipped = 0;
  let retried = 0;
  let failed = 0;

  for (const { id } of due) {
    let claim = await supabase
      .from("lifecycle_touch_schedule")
      .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, base_key, sequence, entity_id, first_name, email, phone, attempts");
    if (claim.error) throw new Error(`lifecycle_touch_claim_failed: ${claim.error.message}`);
    if (!claim.data || claim.data.length === 0) {
      const reclaim = await supabase
        .from("lifecycle_touch_schedule")
        .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "sending")
        .lt("claimed_at", staleCutoff)
        .select("id, base_key, sequence, entity_id, first_name, email, phone, attempts");
      if (reclaim.error) throw new Error(`lifecycle_touch_reclaim_failed: ${reclaim.error.message}`);
      claim = reclaim;
    }
    const row = (claim.data?.[0] as TouchRow | undefined) ?? null;
    if (!row) {
      skipped++;
      continue;
    }

    const attempt = row.attempts + 1;
    try {
      const outcome = await processTouch(supabase, row);
      if (outcome === "SENT") sent++;
      else canceled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_ATTEMPTS) {
        await markStatus(supabase, row.id, "failed", { attempts: attempt, last_error: message });
        logger.error(`[lifecycle-touch] touch ${row.id} failed terminally after ${attempt} attempts`, message);
        failed++;
      } else {
        await supabase
          .from("lifecycle_touch_schedule")
          .update({
            status: "pending",
            attempts: attempt,
            last_error: message,
            run_at: new Date(Date.now() + attempt * MIN).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        retried++;
      }
    }
  }

  return { status: "OK", due: due.length, sent, canceled, skipped, retried, failed };
}
