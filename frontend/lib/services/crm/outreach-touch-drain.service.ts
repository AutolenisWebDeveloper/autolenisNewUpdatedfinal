// Non-deal outreach touch drain — internal parity for the QStash notification
// jobs `affiliate-inactive`, `affiliate-reengagement-2`, and `referral-nudge`
// (QStash non-deal retirement). Consolidated + sequence-discriminated (the same
// multi-sequence shape as lib/services/crm/lead-nurture.service.ts), NOT a
// generalized queue — it holds exactly these three fixed marketing touches.
//
// `enqueueOutreachTouch` inserts one durable `outreach_touch_schedule` row
// (run_at = the QStash delay). The `outreach-touch-drain` cron sends each DUE
// touch through the SAME `notifyContact` layer (TCPA/DNC/suppression/STOP gated)
// the QStash routes used, then chains the next touch (affiliate_inactive →
// affiliate_reengagement_2). The message bodies are ported verbatim from the
// QStash routes so cutover is behaviour-neutral.
//
// DORMANT until the owner-gated atomic cutover: nothing calls
// `enqueueOutreachTouch` yet — affiliate_inactive is still dispatched to QStash
// from the `cron/affiliate-inactive` Vercel cron (recent-activity +
// `lastInactiveNudgeAt` guard UNCHANGED on the producer) and referral_nudge from
// the `review-request` job. While the table is empty/absent the drain no-ops
// (NO_DUE / NO_TABLE), so deploying this code before cutover is safe.
//
// Zero duplicate touches: UNIQUE(base_key, sequence) makes each touch
// enqueue-once (closing the QStash "producer fires twice → two sends" gap), the
// claim CAS serializes concurrent drains, and terminal failure is COLUMNS-ONLY
// (status='failed') — nothing to jobs_dead_letter, so no DLQ re-emit branch can
// resurrect a touch. A gated/suppressed send is a terminal success (the buyer's
// consent was respected), exactly as the QStash job treats it.

import { logger } from "@/lib/logger";
import { notifyContact, renderEmail, NOTIFY_APP_URL } from "@/lib/qstash/notify";
import type { SupabaseClient } from "@supabase/supabase-js";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const DRAIN_BATCH = 100;
const STALE_MS = 10 * MIN; // > drain maxDuration; a stale 'sending' row is reclaimable
const MAX_ATTEMPTS = 4;

export type OutreachSequence = "affiliate_inactive" | "affiliate_reengagement_2" | "referral_nudge";

type Entity = "buyer" | "affiliate";

interface RenderedTouch {
  sms: string;
  emailSubject: string;
  emailHtml: string;
}

interface SequenceConfig {
  entityType: Entity;
  render: (firstName: string) => RenderedTouch;
  // The next touch to chain, or null if terminal. delayMs mirrors the QStash delay.
  next: { sequence: OutreachSequence; delayMs: number } | null;
}

// Message bodies ported verbatim from the QStash routes:
//   app/api/jobs/affiliate-inactive/route.ts
//   app/api/jobs/affiliate-reengagement-2/route.ts
//   app/api/jobs/referral-nudge/route.ts
const SEQUENCES: Record<OutreachSequence, SequenceConfig> = {
  affiliate_inactive: {
    entityType: "affiliate",
    render: (firstName) => ({
      sms: `${firstName}, your AutoLenis affiliate account is still active. Start sharing your link to earn again: autolenis.com/affiliate/portal/dashboard`,
      emailSubject: "Your AutoLenis affiliate account is still active",
      emailHtml: renderEmail({
        heading: "Your AutoLenis affiliate account is still active",
        bodyHtml: `<p>Hi ${firstName},</p><p>It's been a while! Your affiliate account is still active and ready to earn. Share your referral link with anyone car shopping and start earning commissions again.</p>`,
        ctaText: "Go to my dashboard",
        ctaUrl: `${NOTIFY_APP_URL}/affiliate/portal/dashboard`,
      }),
    }),
    next: { sequence: "affiliate_reengagement_2", delayMs: 14 * DAY }, // QStash delaySeconds 1209600
  },
  affiliate_reengagement_2: {
    entityType: "affiliate",
    render: (firstName) => ({
      sms: `${firstName}, we've added fresh marketing assets to your AutoLenis affiliate toolkit. Put them to work and start earning again: autolenis.com/affiliate/portal/dashboard`,
      emailSubject: "New marketing assets available for AutoLenis affiliates",
      emailHtml: renderEmail({
        heading: "New marketing assets are ready for you",
        bodyHtml: `<p>Hi ${firstName},</p><p>We've just published a fresh set of banners, social posts, and link templates to your affiliate toolkit — built to convert. They make it easier than ever to share AutoLenis and earn commissions.</p><p>Log in to grab the new assets and your referral link.</p>`,
        ctaText: "View my toolkit",
        ctaUrl: `${NOTIFY_APP_URL}/affiliate/portal/dashboard`,
      }),
    }),
    next: null,
  },
  referral_nudge: {
    entityType: "buyer",
    render: (firstName) => ({
      sms: `Hi ${firstName} — did you know you can earn commissions by referring friends to AutoLenis? Get your referral link: autolenis.com/buyer/referral`,
      emailSubject: "Earn money by referring friends",
      emailHtml: renderEmail({
        heading: "Earn money by referring friends",
        bodyHtml: `<p>Hi ${firstName},</p><p>Loved letting dealers compete for your business? You can earn commissions every time a friend you refer completes a deal on AutoLenis.</p><p>Grab your personal referral link and start sharing.</p>`,
        ctaText: "Get my referral link",
        ctaUrl: `${NOTIFY_APP_URL}/buyer/referral`,
      }),
    }),
    next: null,
  },
};

// Lazy service-role client (imported at call time, not module load, so importing
// enqueueOutreachTouch for typing doesn't pull the `server-only` supabase-service).
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

export interface EnqueueOutreachTouchInput {
  sequence: OutreachSequence;
  entityId: string;
  firstName: string | null;
  email: string;
  /** Stable per-enrollment key; the chain reuses it across sequences. */
  baseKey: string;
  /** Defaults to now (immediate). Override for a delayed touch. */
  runAt?: Date;
}

// Schedule one touch. Idempotent: UNIQUE(base_key, sequence) → a duplicate enqueue
// adds no row. (DORMANT — no production caller until cutover.)
export async function enqueueOutreachTouch(
  input: EnqueueOutreachTouchInput,
  opts: { supabase?: SupabaseClient } = {},
): Promise<{ scheduled: boolean }> {
  if (!SEQUENCES[input.sequence]) throw new Error(`outreach_touch_unknown_sequence: ${input.sequence}`);
  const supabase = opts.supabase ?? (await serviceClient());
  const runAt = (input.runAt ?? new Date()).toISOString();

  const { data, error } = await supabase
    .from("outreach_touch_schedule")
    .upsert(
      {
        base_key: input.baseKey,
        sequence: input.sequence,
        entity_id: input.entityId,
        first_name: input.firstName,
        email: input.email,
        run_at: runAt,
        status: "pending",
      },
      { onConflict: "base_key,sequence", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`outreach_touch_enqueue_failed: ${error.message}`);
  return { scheduled: Array.isArray(data) && data.length > 0 };
}

interface TouchRow {
  id: string;
  base_key: string;
  sequence: OutreachSequence;
  entity_id: string;
  first_name: string | null;
  email: string;
  attempts: number;
}

export interface OutreachDrainSummary {
  status: "OK" | "NO_DUE" | "NO_TABLE";
  due: number;
  sent: number;
  canceled: number; // unknown sequence
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
    .from("outreach_touch_schedule")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

// Process one claimed touch: render → send → chain. Mirrors the QStash route body.
async function processTouch(supabase: SupabaseClient, row: TouchRow): Promise<"SENT" | "CANCELED"> {
  const cfg = SEQUENCES[row.sequence];
  if (!cfg) {
    await markStatus(supabase, row.id, "canceled", { last_error: `unknown_sequence:${row.sequence}` });
    return "CANCELED";
  }

  const content = cfg.render(row.first_name ?? "there");

  // notifyContact fails closed (returns {false,false}) on a gated/suppressed/
  // unconfigured send and only throws on an unexpected error — exactly as the
  // QStash route relied on. A gated send is a terminal success, not a retry.
  await notifyContact({
    entityType: cfg.entityType,
    entityId: row.entity_id,
    email: row.email,
    sms: content.sms,
    emailSubject: content.emailSubject,
    emailHtml: content.emailHtml,
  });

  await markStatus(supabase, row.id, "done");

  // Chain the next touch (enqueue-once on base_key+sequence).
  if (cfg.next) {
    await supabase.from("outreach_touch_schedule").upsert(
      {
        base_key: row.base_key,
        sequence: cfg.next.sequence,
        entity_id: row.entity_id,
        first_name: row.first_name,
        email: row.email,
        run_at: new Date(Date.now() + cfg.next.delayMs).toISOString(),
        status: "pending",
      },
      { onConflict: "base_key,sequence", ignoreDuplicates: true },
    );
  }

  return "SENT";
}

export async function drainDueOutreachTouches(): Promise<OutreachDrainSummary> {
  const supabase = await serviceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("outreach_touch_schedule")
    .select("id")
    .lte("run_at", now)
    .in("status", ["pending", "sending"])
    .order("run_at", { ascending: true })
    .limit(DRAIN_BATCH);

  if (error) {
    if (isMissingTable(error)) return { status: "NO_TABLE", due: 0, sent: 0, canceled: 0, skipped: 0, retried: 0, failed: 0 };
    throw new Error(`outreach_touch_due_query_failed: ${error.message}`);
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
      .from("outreach_touch_schedule")
      .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, base_key, sequence, entity_id, first_name, email, attempts");
    if (claim.error) throw new Error(`outreach_touch_claim_failed: ${claim.error.message}`);
    if (!claim.data || claim.data.length === 0) {
      const reclaim = await supabase
        .from("outreach_touch_schedule")
        .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "sending")
        .lt("claimed_at", staleCutoff)
        .select("id, base_key, sequence, entity_id, first_name, email, attempts");
      if (reclaim.error) throw new Error(`outreach_touch_reclaim_failed: ${reclaim.error.message}`);
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
        logger.error(`[outreach-touch] touch ${row.id} failed terminally after ${attempt} attempts`, message);
        failed++;
      } else {
        await supabase
          .from("outreach_touch_schedule")
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
