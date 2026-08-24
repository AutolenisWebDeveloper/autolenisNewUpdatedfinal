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
import { hasPaidDeposit, hasSelectedOffer } from "@/lib/qstash/state";
import { DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import type { SupabaseClient } from "@supabase/supabase-js";

const SEC = 1000;
const MIN = 60 * SEC;
const DRAIN_BATCH = 100;
const STALE_MS = 10 * MIN; // > drain maxDuration; a stale 'sending' row is reclaimable
const MAX_ATTEMPTS = 4;

export type LifecycleSequence =
  | "deposit_reminder_1" | "deposit_reminder_2" | "deposit_reminder_3"
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
}

interface SequenceConfig {
  entityType: Entity;
  // Re-checked at drain time. Returns true when the buyer has already converted
  // (deposit paid / offer selected) → the touch is canceled, never sent.
  guard?: (entityId: string) => Promise<boolean>;
  render: (ctx: RowContext) => RenderedTouch;
  // The next touch to chain, or null if terminal. delayMs mirrors the QStash delay.
  next: { sequence: LifecycleSequence; delayMs: number } | null;
  // Extra side effects fired AFTER a successful send + status=done (used only by
  // review_request to seed the refinance + referral cross-table touches). Runs
  // best-effort: a failure here must never re-send the (non-deduped) notify.
  postSend?: (ctx: RowContext) => Promise<void>;
}

const DASH = `${NOTIFY_APP_URL}/buyer/dashboard`;

// Message bodies ported verbatim from app/api/jobs/<name>/route.ts.
const SEQUENCES: Record<LifecycleSequence, SequenceConfig> = {
  // ── deposit-reminder (3 touches, guard hasPaidDeposit) ────────────────────
  deposit_reminder_1: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `Hey ${firstName} — your AutoLenis auction slot is reserved. Activate it for ${DEPOSIT_AMOUNT_USD}: autolenis.com/buyer/dashboard`,
      emailSubject: "Your dealer auction is ready to launch",
      emailHtml: renderEmail({
        heading: "Your dealer auction is ready to launch",
        bodyHtml: `<p>Hi ${firstName},</p><p>Your auction slot is reserved. Activate it for ${DEPOSIT_AMOUNT_USD} and local dealers will start competing for your vehicle.</p>`,
        ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "deposit_reminder_2", delayMs: 86400 * SEC },
  },
  deposit_reminder_2: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `${firstName}, your AutoLenis auction slot is still on hold. Activate for ${DEPOSIT_AMOUNT_USD} before it's released: autolenis.com/buyer/dashboard`,
      emailSubject: "Your reserved auction slot is still waiting",
      emailHtml: renderEmail({
        heading: "Your reserved auction slot is still waiting",
        bodyHtml: `<p>Hi ${firstName},</p><p>We're still holding your auction slot. Activate for ${DEPOSIT_AMOUNT_USD} to put dealers to work before the hold expires.</p>`,
        ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "deposit_reminder_3", delayMs: 172800 * SEC },
  },
  deposit_reminder_3: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `${firstName}, your AutoLenis auction slot expires soon. Activate for ${DEPOSIT_AMOUNT_USD} now: autolenis.com/buyer/dashboard`,
      emailSubject: "Your auction slot expires soon",
      emailHtml: renderEmail({
        heading: "Your auction slot expires soon",
        bodyHtml: `<p>Hi ${firstName},</p><p>This is your final reminder — your reserved auction slot is about to be released. Activate for ${DEPOSIT_AMOUNT_USD} to keep it.</p>`,
        ctaText: `Activate for ${DEPOSIT_AMOUNT_USD}`,
        ctaUrl: DASH,
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

  // ── form-submitted → check-form-completion (3 touches, guard hasPaidDeposit) ─
  form_submitted: {
    entityType: "buyer",
    render: ({ firstName, email }) => {
      const completeUrl = `${NOTIFY_APP_URL}/thank-you?email=${encodeURIComponent(email)}&complete=true`;
      return {
        sms: `Hey ${firstName}! Thanks for reaching out to AutoLenis. Your vehicle request was received. Complete your vehicle details so dealers can compete: ${completeUrl}`,
        emailSubject: "Welcome to AutoLenis — your request is in",
        emailHtml: renderEmail({
          heading: `Welcome to AutoLenis, ${firstName}`,
          bodyHtml: `<p>Thanks for reaching out — your vehicle request is in.</p><p>Complete your vehicle details here to help dealers submit their best offers:</p><p><a href="${completeUrl}" style="color:#0B5FD1;font-weight:600">${completeUrl}</a></p><p>The next step after that is to activate your private dealer auction so local dealers can start competing for your business.</p>`,
          ctaText: "Complete your vehicle details",
          ctaUrl: completeUrl,
        }),
      };
    },
    next: { sequence: "check_form_completion_1", delayMs: 3600 * SEC },
  },
  check_form_completion_1: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `${firstName}, dealers are waiting for you on AutoLenis. Activate your auction to let them compete: autolenis.com/buyer/dashboard`,
      emailSubject: "Dealers are waiting for you",
      emailHtml: renderEmail({
        heading: "Dealers are waiting for you",
        bodyHtml: `<p>Hi ${firstName},</p><p>Local dealers are ready to compete for your vehicle — but your auction isn't active yet. Finish activating to get them bidding.</p>`,
        ctaText: "Activate my auction",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "check_form_completion_2", delayMs: 82800 * SEC },
  },
  check_form_completion_2: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `${firstName}, your AutoLenis auction room is still empty. Activate now and let dealers compete: autolenis.com/buyer/dashboard`,
      emailSubject: "The auction room is still empty",
      emailHtml: renderEmail({
        heading: "The auction room is still empty",
        bodyHtml: `<p>Hi ${firstName},</p><p>No dealers can bid until you activate your auction. It only takes a minute and puts dealers to work for you.</p>`,
        ctaText: "Activate my auction",
        ctaUrl: DASH,
      }),
    }),
    next: { sequence: "check_form_completion_3", delayMs: 259200 * SEC },
  },
  check_form_completion_3: {
    entityType: "buyer",
    guard: hasPaidDeposit,
    render: ({ firstName }) => ({
      sms: `${firstName}, last chance — we'll close your AutoLenis file soon. Activate to keep dealers competing: autolenis.com/buyer/dashboard`,
      emailSubject: "Last chance — we will close your file",
      emailHtml: renderEmail({
        heading: "Last chance — we will close your file",
        bodyHtml: `<p>Hi ${firstName},</p><p>This is the final reminder. If you don't activate soon we'll close out your request. You can pick back up any time by activating your auction.</p>`,
        ctaText: "Activate before we close it",
        ctaUrl: DASH,
      }),
    }),
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
  const content = cfg.render(ctx);

  // notifyContact fails closed (returns {false,false}) on a gated/suppressed/
  // unconfigured send and only throws on an unexpected error — a gated send is a
  // terminal success, not a retry (parity with the QStash route).
  await notifyContact({
    entityType: cfg.entityType,
    entityId: row.entity_id,
    email: row.email,
    ...(row.phone ? { phone: row.phone } : {}),
    sms: content.sms,
    emailSubject: content.emailSubject,
    emailHtml: content.emailHtml,
  });

  // Mark done BEFORE chaining/postSend so a follow-up failure can never re-send
  // the (non-deduped) notify on retry.
  await markStatus(supabase, row.id, "done");

  // Chain the next touch (enqueue-once on base_key+sequence).
  if (cfg.next) {
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
  }

  // Cross-table coupling (review_request → refinance + referral). Best-effort:
  // the enqueues are enqueue-once, and the row is already 'done', so a failure
  // never re-sends the review notify — it can be recovered by a re-enqueue.
  if (cfg.postSend) {
    await cfg.postSend(ctx).catch((err) => logger.error("[lifecycle-touch] postSend failed:", err));
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
