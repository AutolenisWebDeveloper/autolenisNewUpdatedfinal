// Campaign dispatch — internal Vercel-Cron substrate (migrated off the Inngest
// `campaignFanoutFn` (event autolenis/campaign.execute) + `scheduledCampaignCronFn`).
//
// The `campaign-dispatch` cron scans DUE campaigns (status='scheduled' AND
// scheduled_at <= now — this covers both scheduled campaigns and send-immediately
// campaigns, which the create route now stamps scheduled_at=now) and fans each one
// out to per-recipient sends on the internal comms outbox. No campaign.execute
// event, no second scheduler.
//
// Double-fanout is prevented by an atomic status compare-and-set (scheduled →
// running): a losing/second drain updates 0 rows and exits NOT_RUNNABLE. Per-run
// idempotency is further guaranteed by UNIQUE(campaign_id, contact_id) on
// campaign_recipients and the outbox dedup_key `campaign:{id}:{contact}:{channel}`,
// so even an overlapping re-run never double-sends.

import { logger } from "@/lib/logger";
import { getSupabase, claimJob, updateIdempotencyState, releaseIdempotencyGuard } from "@/lib/jobs/idempotency";
import { enqueueEmail, enqueueSms } from "@/lib/services/comms/comms-outbox.service";
import type { SupabaseClient } from "@supabase/supabase-js";

const DUE_BATCH = 50;
// A campaign claim older than this is reclaimable (a prior drain died mid-fanout).
const STALE_MS = 10 * 60 * 1000;

export type CampaignProcessOutcome =
  | { status: "OK"; campaign_id: string; eligible: number; suppressed: number; email_dispatched: number; sms_dispatched: number }
  | { status: "NOT_RUNNABLE"; campaign_id: string }
  | { status: "NO_SEGMENT"; campaign_id: string };

export interface CampaignDrainSummary {
  status: "OK" | "NO_DUE_CAMPAIGNS";
  due: number;
  processed: number;
  skipped: number;
  failed: number;
}

// Fan a single campaign out to per-recipient outbox sends. Idempotent: the
// scheduled→running CAS guards against a concurrent second run.
export async function processCampaign(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<CampaignProcessOutcome> {
  // Concurrency LEASE (not a status flip): the campaign stays 'scheduled' through
  // the fanout so a failed/crashed run is re-selected and re-driven. The lease is
  // released on success and left 'failed' (reclaimable) on failure — so a crash
  // mid-fanout never strands the campaign, and the fanout's own idempotency
  // (recipient UNIQUE + outbox dedup) makes the re-drive safe.
  const leaseKey = `campaign-dispatch:${campaignId}`;
  const claimed = await claimJob(supabase, leaseKey, { staleMs: STALE_MS });
  if (!claimed) return { status: "NOT_RUNNABLE", campaign_id: campaignId };

  try {
    const outcome = await fanoutCampaign(supabase, campaignId);
    await releaseIdempotencyGuard(supabase, leaseKey);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateIdempotencyState(supabase, leaseKey, "failed", { error: message });
    throw err;
  }
}

async function fanoutCampaign(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<CampaignProcessOutcome> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
  if (!campaign.segment_id) return { status: "NO_SEGMENT", campaign_id: campaignId };
  // Only a runnable campaign fans out; an already-completed/running one (e.g. a
  // duplicate schedule) is a no-op.
  if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
    return { status: "NOT_RUNNABLE", campaign_id: campaignId };
  }

  const { data: segment } = await supabase
    .from("segments")
    .select("*")
    .eq("id", campaign.segment_id)
    .maybeSingle();
  if (!segment) throw new Error("SEGMENT_NOT_FOUND");

  const { SegmentService } = await import("@/lib/services/segment.service");
  const contacts = await SegmentService.resolveContacts(supabase, segment.conditions);

  const { SuppressionService } = await import("@/lib/services/suppression.service");

  const needsEmail = campaign.type === "email" || campaign.type === "mixed";
  const needsSms = campaign.type === "sms" || campaign.type === "mixed";

  const emailCandidates: string[] = [];
  const phoneCandidates: string[] = [];
  for (const c of contacts) {
    if (c.do_not_contact) continue;
    if (needsEmail && c.email && c.consent_email) emailCandidates.push(c.email);
    if (needsSms && c.phone && c.consent_sms) phoneCandidates.push(c.phone);
  }

  const emailSup = await SuppressionService.filterEmailsSuppressed(supabase, emailCandidates);
  const smsSup = await SuppressionService.filterPhonesSuppressed(supabase, phoneCandidates);
  const allowedEmails = new Set(emailSup.allowed);
  const allowedPhones = new Set(smsSup.allowed);

  type Reachable = (typeof contacts)[number] & { email_ok: boolean; sms_ok: boolean };
  const eligible: Reachable[] = [];
  let suppressed_count = 0;
  for (const c of contacts) {
    if (c.do_not_contact) {
      suppressed_count += 1;
      continue;
    }
    const email_ok = needsEmail && !!c.email && c.consent_email && allowedEmails.has(c.email);
    const sms_ok = needsSms && !!c.phone && c.consent_sms && allowedPhones.has(c.phone);
    if (email_ok || sms_ok) eligible.push({ ...c, email_ok, sms_ok });
    else suppressed_count += 1;
  }

  // Insert recipients (UNIQUE(campaign_id, contact_id) → retried fan-out idempotent).
  const rows = eligible.map((c) => ({ campaign_id: campaignId, contact_id: c.id, status: "pending" as const }));
  for (let i = 0; i < rows.length; i += 500) {
    await supabase
      .from("campaign_recipients")
      .upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  }

  // Pull back recipient ids to stamp on the outbox rows.
  const recipientByContactId: Record<string, string> = {};
  const ids = eligible.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase
      .from("campaign_recipients")
      .select("id, contact_id")
      .eq("campaign_id", campaignId)
      .in("contact_id", ids.slice(i, i + 500));
    for (const row of data ?? []) recipientByContactId[row.contact_id] = row.id;
  }

  // Fan-out onto the comms outbox. Each enqueue is dedup'd on its stable key, so a
  // retried fan-out never double-enqueues; the drain applies consent/DNC/suppression.
  let sent_email = 0;
  let sent_sms = 0;
  for (const c of eligible) {
    const recipient_id = recipientByContactId[c.id];
    if (c.email_ok) {
      sent_email += 1;
      await enqueueEmail({
        contactId: c.id,
        email: c.email!,
        templateId: campaign.template_id,
        templateVariables: {
          firstName: c.first_name ?? "",
          lastName: c.last_name ?? "",
          fullName: [c.first_name, c.last_name].filter(Boolean).join(" "),
        },
        type: "marketing",
        campaignId,
        campaignRecipientId: recipient_id,
        idempotencyKey: `campaign:${campaignId}:${c.id}:email`,
      });
    }
    if (c.sms_ok) {
      sent_sms += 1;
      await enqueueSms({
        contactId: c.id,
        phone: c.phone!,
        body: campaign.sms_body,
        campaignId,
        campaignRecipientId: recipient_id,
        idempotencyKey: `campaign:${campaignId}:${c.id}:sms`,
      });
    }
  }

  await supabase
    .from("campaigns")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      recipient_count: eligible.length,
      sent_count: sent_email + sent_sms,
      suppressed_count,
    })
    .eq("id", campaignId);

  return {
    status: "OK",
    campaign_id: campaignId,
    eligible: eligible.length,
    suppressed: suppressed_count,
    email_dispatched: sent_email,
    sms_dispatched: sent_sms,
  };
}

// Scan + process due campaigns (scheduled and send-immediately alike).
export async function drainDueCampaigns(): Promise<CampaignDrainSummary> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(DUE_BATCH);
  if (error) throw new Error(`campaign_due_query_failed: ${error.message}`);

  const due = data ?? [];
  if (due.length === 0) return { status: "NO_DUE_CAMPAIGNS", due: 0, processed: 0, skipped: 0, failed: 0 };

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of due) {
    try {
      const outcome = await processCampaign(supabase, row.id as string);
      if (outcome.status === "OK") processed += 1;
      else skipped += 1;
    } catch (err) {
      // One campaign's failure must not abort the batch. The campaign stays
      // 'running' (or reverts on next admin action); logged for triage.
      logger.error(`[campaign-dispatch] campaign ${row.id} failed`, err);
      failed += 1;
    }
  }

  return { status: "OK", due: due.length, processed, skipped, failed };
}
