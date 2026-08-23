// Refinance-outreach durable single-touch drain — internal parity for the QStash
// `/api/jobs/refinance-outreach` job (NON-deal-path QStash retirement; reference
// implementation of the non-deal set).
//
// `enqueueRefinanceOutreach` inserts one durable `refinance_outreach_schedule`
// row (run_at = deal-complete + ~60 days). The `refinance-outreach-drain` cron
// sends each DUE touch — re-checking the SAME guards the QStash route enforced
// (completed-purchase count + the REFINANCE_EMAIL_SENT/CLICKED BuyerActivityEvent
// send-guard) — through the SAME `notifyContact` layer (TCPA + suppression gated),
// then logs REFINANCE_EMAIL_SENT so it never sends twice.
//
// DORMANT: nothing calls `enqueueRefinanceOutreach` yet — the touch is still
// enqueued to QStash from the `review-request` job. The owner-gated atomic cutover
// swaps that `dispatch()` for `enqueueRefinanceOutreach` and retires the QStash
// route, so there is exactly one authority at all times (QStash today, this cron
// after cutover). While the table is empty/absent the drain no-ops (NO_DUE /
// NO_TABLE), so deploying this code before the cutover is safe.
//
// Zero duplicate sends: UNIQUE(dedup_key) makes enqueue once-per-buyer, the claim
// CAS serializes concurrent drains, and the BuyerActivityEvent guard is re-checked
// immediately before the send (identical to the QStash route). Terminal failure is
// COLUMNS-ONLY (status='failed') — nothing to jobs_dead_letter, so no DLQ re-emit
// branch can resurrect a refinance touch.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { notifyContact, renderEmail } from "@/lib/qstash/notify";
import { buildPartnerRedirectUrl } from "@/lib/services/refinance/refinance-lead.service";
import type { SupabaseClient } from "@supabase/supabase-js";

const MIN = 60 * 1000;
const REFINANCE_DELAY_MS = 60 * 24 * 60 * MIN; // ~60 days (matches QStash delaySeconds 5184000)
const DRAIN_BATCH = 100;
const STALE_MS = 10 * MIN; // > drain maxDuration; a stale 'sending' row is reclaimable
const MAX_ATTEMPTS = 4;

// Lazy service-role client (imported at call time, not module load, so importing
// enqueueRefinanceOutreach for typing doesn't pull the `server-only` supabase-service).
async function serviceClient(): Promise<SupabaseClient> {
  const { getServiceSupabase } = await import("@/lib/supabase-service");
  return getServiceSupabase();
}

// A missing table (pre-cutover, migration not yet applied) is the DORMANT state,
// not an error — treat it as such so the cron stays green instead of alerting.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" || // undefined_table (Postgres)
    code === "PGRST205" || // PostgREST: table not found in schema cache
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

export interface EnqueueRefinanceOutreachInput {
  buyerId: string;
  firstName: string | null;
  email: string;
  leadId: string;
  /** Defaults to now + ~60 days (the QStash delay). Override for tests. */
  runAt?: Date;
}

// Schedule the single refinance touch. Idempotent: UNIQUE(dedup_key) → a second
// enqueue for the same buyer adds no row. (DORMANT — no caller until cutover.)
export async function enqueueRefinanceOutreach(
  input: EnqueueRefinanceOutreachInput,
  opts: { supabase?: SupabaseClient } = {},
): Promise<{ scheduled: boolean }> {
  const supabase = opts.supabase ?? (await serviceClient());
  const runAt = (input.runAt ?? new Date(Date.now() + REFINANCE_DELAY_MS)).toISOString();

  const { data, error } = await supabase
    .from("refinance_outreach_schedule")
    .upsert(
      {
        buyer_id: input.buyerId,
        first_name: input.firstName,
        email: input.email,
        lead_id: input.leadId,
        dedup_key: `refinance-outreach:${input.buyerId}`,
        run_at: runAt,
        status: "pending",
      },
      { onConflict: "dedup_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`refinance_outreach_enqueue_failed: ${error.message}`);
  return { scheduled: Array.isArray(data) && data.length > 0 };
}

interface TouchRow {
  id: string;
  buyer_id: string;
  first_name: string | null;
  email: string;
  lead_id: string;
  attempts: number;
}

export interface RefinanceOutreachDrainSummary {
  status: "OK" | "NO_DUE" | "NO_TABLE";
  due: number;
  sent: number;
  skipped: number; // guard stopped the send (no purchase / already sent) or lost claim
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
    .from("refinance_outreach_schedule")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

// Process one claimed touch: guard → send → log. Mirrors the QStash route body.
async function processTouch(supabase: SupabaseClient, row: TouchRow): Promise<"SENT" | "SKIPPED"> {
  // Compliance guard: refinance outreach is for buyers who completed a purchase.
  const completedDeals = await prisma.deal.count({
    where: { buyerId: row.buyer_id, status: "COMPLETED" },
  });
  if (completedDeals === 0) {
    await markStatus(supabase, row.id, "skipped", { last_error: "no_completed_purchase" });
    return "SKIPPED";
  }

  // Send once — stop if already emailed or the buyer already engaged the link.
  const priorEvent = await prisma.buyerActivityEvent.findFirst({
    where: {
      buyerId: row.buyer_id,
      eventType: { in: ["REFINANCE_LINK_CLICKED", "REFINANCE_EMAIL_SENT"] },
    },
    select: { id: true },
  });
  if (priorEvent) {
    await markStatus(supabase, row.id, "skipped", { last_error: "already_sent_or_clicked" });
    return "SKIPPED";
  }

  const partnerUrl = buildPartnerRedirectUrl(row.lead_id);
  const firstName = row.first_name ?? "there";

  await notifyContact({
    entityType: "buyer",
    entityId: row.buyer_id,
    email: row.email,
    sms: `Hi ${firstName} — did you know you could lower your monthly payment on your recent vehicle purchase? AutoLenis has connected with OpenRoad Lending to help buyers explore refinancing options. Check your options here: autolenis.com/refinance`,
    emailSubject: "Could you lower your car payment?",
    emailHtml: renderEmail({
      heading: "Could you lower your car payment?",
      bodyHtml:
        `<p>Hi ${firstName} — congratulations again on your recent vehicle purchase through AutoLenis.</p>` +
        `<p>Many buyers find they can reduce their monthly payment through refinancing — especially if your credit has improved or rates have changed since your purchase.</p>` +
        `<p>AutoLenis connects you with OpenRoad Lending to explore your refinancing options.</p>` +
        `<p><strong>Important:</strong> AutoLenis is not a lender or broker. We connect you with OpenRoad Lending as a lead provider only.</p>` +
        `<p>This link is personalized for you. If you have any questions contact <a href="mailto:support@autolenis.com">support@autolenis.com</a></p>` +
        `<p>AutoLenis Team</p>`,
      ctaText: "Explore your options",
      ctaUrl: partnerUrl,
    }),
  });

  // Log so we never send twice (the guard above reads this on any re-drive).
  await prisma.buyerActivityEvent.create({
    data: {
      buyerId: row.buyer_id,
      eventType: "REFINANCE_EMAIL_SENT",
      title: "Refinance outreach sent (OpenRoad Lending)",
      metadata: { leadId: row.lead_id, partnerUrl, source: "internal_cron" },
    },
  });

  await markStatus(supabase, row.id, "done");
  return "SENT";
}

export async function drainDueRefinanceOutreach(): Promise<RefinanceOutreachDrainSummary> {
  const supabase = await serviceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("refinance_outreach_schedule")
    .select("id")
    .lte("run_at", now)
    .in("status", ["pending", "sending"])
    .order("run_at", { ascending: true })
    .limit(DRAIN_BATCH);

  if (error) {
    // Pre-cutover the table doesn't exist yet — that's the dormant state, not a
    // failure. Anything else is a real query error → FAILED cron / HTTP 500.
    if (isMissingTable(error)) return { status: "NO_TABLE", due: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };
    throw new Error(`refinance_outreach_due_query_failed: ${error.message}`);
  }

  const due = data ?? [];
  if (due.length === 0) return { status: "NO_DUE", due: 0, sent: 0, skipped: 0, retried: 0, failed: 0 };

  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  let sent = 0;
  let skipped = 0;
  let retried = 0;
  let failed = 0;

  for (const { id } of due) {
    // Claim CAS: pending, or a stale 'sending' row (prior drain died mid-send).
    let claim = await supabase
      .from("refinance_outreach_schedule")
      .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, buyer_id, first_name, email, lead_id, attempts");
    if (claim.error) throw new Error(`refinance_outreach_claim_failed: ${claim.error.message}`);
    if (!claim.data || claim.data.length === 0) {
      const reclaim = await supabase
        .from("refinance_outreach_schedule")
        .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "sending")
        .lt("claimed_at", staleCutoff)
        .select("id, buyer_id, first_name, email, lead_id, attempts");
      if (reclaim.error) throw new Error(`refinance_outreach_reclaim_failed: ${reclaim.error.message}`);
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
      else skipped++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_ATTEMPTS) {
        await markStatus(supabase, row.id, "failed", { attempts: attempt, last_error: message });
        logger.error(`[refinance-outreach] touch ${row.id} failed terminally after ${attempt} attempts`, message);
        failed++;
      } else {
        await supabase
          .from("refinance_outreach_schedule")
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

  return { status: "OK", due: due.length, sent, skipped, retried, failed };
}
