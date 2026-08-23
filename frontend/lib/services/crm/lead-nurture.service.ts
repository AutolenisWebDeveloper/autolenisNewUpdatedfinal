// LP lead-nurture durable multi-touch scheduler — internal Vercel-Cron substrate
// (migrated off the Inngest `formAbandonmentFn` / `exitIntentFn`, which used
// step.sleep for the inter-touch delays).
//
// `scheduleLeadNurture` inserts the FIRST touch (with a future run_at) when a lead
// abandons the LP form / triggers exit-intent. The `lead-nurture-drain` cron sends
// each due touch — re-checking the lead's completion + suppression at send time —
// and schedules the NEXT touch. Each touch is a durable `lead_nurture_schedule`
// row; `run_at` is the delay, so nothing depends on Inngest, setTimeout, or a
// detached promise.
//
// Zero duplicate touches: UNIQUE(idempotency_key, step) makes scheduling a touch
// enqueue-once, the claim CAS serializes concurrent drains, and the touch email's
// outbox dedup_key (`${idempotency_key}-touch{N}` / `-recovery`) collapses any
// residual overlap. A converted lead (lifecycle_stage != 'lead') cancels the rest
// of the sequence.

import { logger } from "@/lib/logger";
import { SuppressionService } from "@/lib/services/suppression.service";
import { TemplateService } from "@/lib/services/template.service";
import { enqueueEmail } from "@/lib/services/comms/comms-outbox.service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplateVariable } from "@/lib/types/crm";

export type NurtureSequence = "form_abandonment" | "exit_intent";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

interface StepConfig {
  step: number;
  templateKey: string;
  keySuffix: string;
  // The URL variable name the template expects (form → resumeUrl, exit → returnUrl).
  urlVar: "resumeUrl" | "returnUrl";
  nextDelayMs: number | null; // delay to the NEXT step, or null if terminal
  markInactive?: boolean; // final form-abandonment touch marks the lead inactive
}

interface SequenceConfig {
  initialDelayMs: number;
  steps: StepConfig[];
}

const SEQUENCES: Record<NurtureSequence, SequenceConfig> = {
  form_abandonment: {
    initialDelayMs: 1 * HOUR,
    steps: [
      { step: 1, templateKey: "abandonment_touch_1", keySuffix: "-touch1", urlVar: "resumeUrl", nextDelayMs: 23 * HOUR },
      { step: 2, templateKey: "abandonment_touch_2", keySuffix: "-touch2", urlVar: "resumeUrl", nextDelayMs: 72 * HOUR },
      { step: 3, templateKey: "abandonment_touch_3", keySuffix: "-touch3", urlVar: "resumeUrl", nextDelayMs: null, markInactive: true },
    ],
  },
  exit_intent: {
    initialDelayMs: 30 * MIN,
    steps: [
      { step: 1, templateKey: "exit_intent_recovery", keySuffix: "-recovery", urlVar: "returnUrl", nextDelayMs: null },
    ],
  },
};

const DRAIN_BATCH = 100;
const STALE_MS = 10 * MIN; // > drain maxDuration; a stale 'sending' touch is reclaimable
const MAX_TOUCH_ATTEMPTS = 4;

// Lazy service-role client (imported at call time, not module load, so importing
// scheduleLeadNurture for typing doesn't pull the `server-only` supabase-service).
async function serviceClient(): Promise<SupabaseClient> {
  const { getServiceSupabase } = await import("@/lib/supabase-service");
  return getServiceSupabase();
}

function buildLpRecoveryUrl(campaign: string | null | undefined): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/lp/${campaign || "default"}?resume=1`;
}
function buildUnsubUrl(email: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}`;
}

// Load + render a recovery template by key. Missing → throw (transient / seed not
// applied → retry). Inactive → null (admin disabled it → skip the email but still
// advance the sequence).
async function renderRecoveryTemplate(
  supabase: SupabaseClient,
  templateKey: string,
  variables: Partial<Record<TemplateVariable | string, string | number | null>>,
): Promise<{ subject: string; html: string; text: string } | null> {
  const template = await TemplateService.getTemplateByKey(supabase, templateKey);
  if (!template) throw new Error(`recovery_template_missing: ${templateKey}`);
  if (template.status !== "active") return null;
  return TemplateService.renderInline(template, variables);
}

export interface ScheduleLeadNurtureInput {
  contactId: string;
  contactEmail: string;
  firstName: string | null;
  campaign: string | null;
  idempotencyKey: string;
}

// Schedule the FIRST touch of a sequence. Idempotent: UNIQUE(idempotency_key, step)
// → a duplicate trigger (same lead, same day) adds no row.
export async function scheduleLeadNurture(
  sequence: NurtureSequence,
  input: ScheduleLeadNurtureInput,
  opts: { supabase?: SupabaseClient } = {},
): Promise<{ scheduled: boolean }> {
  const supabase = opts.supabase ?? (await serviceClient());
  const cfg = SEQUENCES[sequence];
  const runAt = new Date(Date.now() + cfg.initialDelayMs).toISOString();

  const { data, error } = await supabase
    .from("lead_nurture_schedule")
    .upsert(
      {
        sequence,
        step: cfg.steps[0].step,
        contact_id: input.contactId,
        contact_email: input.contactEmail,
        first_name: input.firstName,
        campaign: input.campaign,
        idempotency_key: input.idempotencyKey,
        run_at: runAt,
        status: "pending",
      },
      { onConflict: "idempotency_key,step", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`lead_nurture_schedule_failed: ${error.message}`);
  return { scheduled: Array.isArray(data) && data.length > 0 };
}

interface TouchRow {
  id: string;
  sequence: NurtureSequence;
  step: number;
  contact_id: string;
  contact_email: string;
  first_name: string | null;
  campaign: string | null;
  idempotency_key: string;
  attempts: number;
}

export interface LeadNurtureDrainSummary {
  status: "OK" | "NO_DUE";
  due: number;
  sent: number;
  canceled: number; // lead converted → sequence stopped
  skipped: number; // lost claim / template inactive
  retried: number;
  failed: number;
}

async function leadCompleted(supabase: SupabaseClient, contactId: string): Promise<boolean> {
  const { data } = await supabase
    .from("contacts")
    .select("lifecycle_stage")
    .eq("id", contactId)
    .single();
  // No row (deleted) → treat as completed (stop the sequence).
  return !data || data.lifecycle_stage !== "lead";
}

// Process one claimed touch: completion-check → send → schedule next / finalize.
async function processTouch(
  supabase: SupabaseClient,
  row: TouchRow,
): Promise<"SENT" | "CANCELED" | "SKIPPED"> {
  const stepCfg = SEQUENCES[row.sequence].steps.find((s) => s.step === row.step);
  if (!stepCfg) {
    // Unknown step (config change) — terminate cleanly.
    await markStatus(supabase, row.id, "canceled");
    return "CANCELED";
  }

  // A converted lead stops the whole sequence.
  if (await leadCompleted(supabase, row.contact_id)) {
    await markStatus(supabase, row.id, "canceled");
    return "CANCELED";
  }

  const suppressed = await SuppressionService.isEmailSuppressed(supabase, row.contact_email);
  const urls = {
    [stepCfg.urlVar]: buildLpRecoveryUrl(row.campaign),
    unsubscribeUrl: buildUnsubUrl(row.contact_email),
  } as Record<string, string>;

  // renderRecoveryTemplate THROWS on a missing template (→ retry); returns null on
  // an inactive one (skip the email but still advance).
  const rendered = suppressed
    ? null
    : await renderRecoveryTemplate(supabase, stepCfg.templateKey, {
        firstName: row.first_name ?? "There",
        ...urls,
      });

  if (rendered) {
    await enqueueEmail({
      contactId: row.contact_id,
      email: row.contact_email,
      type: "marketing",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `${row.idempotency_key}${stepCfg.keySuffix}`,
    });
  }

  // Final form-abandonment touch marks the lead inactive (only if still 'lead').
  if (stepCfg.markInactive) {
    await supabase
      .from("contacts")
      .update({ lifecycle_stage: "inactive" })
      .eq("id", row.contact_id)
      .eq("lifecycle_stage", "lead");
  }

  await markStatus(supabase, row.id, "done");

  // Schedule the next touch (enqueue-once on idempotency_key+step).
  if (stepCfg.nextDelayMs !== null) {
    const nextStep = SEQUENCES[row.sequence].steps.find((s) => s.step === row.step + 1);
    if (nextStep) {
      await supabase.from("lead_nurture_schedule").upsert(
        {
          sequence: row.sequence,
          step: nextStep.step,
          contact_id: row.contact_id,
          contact_email: row.contact_email,
          first_name: row.first_name,
          campaign: row.campaign,
          idempotency_key: row.idempotency_key,
          run_at: new Date(Date.now() + stepCfg.nextDelayMs).toISOString(),
          status: "pending",
        },
        { onConflict: "idempotency_key,step", ignoreDuplicates: true },
      );
    }
  }

  return rendered ? "SENT" : "SKIPPED";
}

async function markStatus(supabase: SupabaseClient, id: string, status: string, extra: Record<string, unknown> = {}) {
  await supabase
    .from("lead_nurture_schedule")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

export async function drainDueLeadNurture(): Promise<LeadNurtureDrainSummary> {
  const supabase = await serviceClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("lead_nurture_schedule")
    .select("id")
    .lte("run_at", now)
    .in("status", ["pending", "sending"])
    .order("run_at", { ascending: true })
    .limit(DRAIN_BATCH);
  if (error) throw new Error(`lead_nurture_due_query_failed: ${error.message}`);

  const due = data ?? [];
  if (due.length === 0) return { status: "NO_DUE", due: 0, sent: 0, canceled: 0, skipped: 0, retried: 0, failed: 0 };

  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  let sent = 0;
  let canceled = 0;
  let skipped = 0;
  let retried = 0;
  let failed = 0;

  for (const { id } of due) {
    // Claim CAS: pending, or a stale 'sending' row (prior drain died).
    let claim = await supabase
      .from("lead_nurture_schedule")
      .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .select("id, sequence, step, contact_id, contact_email, first_name, campaign, idempotency_key, attempts");
    if (claim.error) throw new Error(`lead_nurture_claim_failed: ${claim.error.message}`);
    if (!claim.data || claim.data.length === 0) {
      const reclaim = await supabase
        .from("lead_nurture_schedule")
        .update({ status: "sending", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "sending")
        .lt("claimed_at", staleCutoff)
        .select("id, sequence, step, contact_id, contact_email, first_name, campaign, idempotency_key, attempts");
      if (reclaim.error) throw new Error(`lead_nurture_reclaim_failed: ${reclaim.error.message}`);
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
      else if (outcome === "CANCELED") canceled++;
      else skipped++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= MAX_TOUCH_ATTEMPTS) {
        await markStatus(supabase, row.id, "failed", { attempts: attempt, last_error: message });
        logger.error(`[lead-nurture] touch ${row.id} failed terminally after ${attempt} attempts`, message);
        failed++;
      } else {
        // Back to pending with a small backoff so a flapping template/DB isn't hammered.
        await supabase
          .from("lead_nurture_schedule")
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
