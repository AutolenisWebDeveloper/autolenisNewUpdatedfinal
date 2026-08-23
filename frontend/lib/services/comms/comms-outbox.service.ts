// Internal comms-dispatch queue — the retirement substrate for the Inngest
// `emailSendFn` / `smsSendFn` workers.
//
// PRODUCERS call enqueueEmail / enqueueSms, which INSERT a comms_outbox row with
// ON CONFLICT (dedup_key) DO NOTHING. The unique dedup_key is the HARD dedup: a
// retried/duplicate emit is a no-op, so a logical message is enqueued at most once.
//
// The `comms-outbox-drain` cron calls drainCommsOutbox, which claims each due row
// with a status compare-and-set (exactly one drain delivers it) and runs
// deliverEmail / deliverSms — faithful reproductions of the retired workers'
// consent / DNC / suppression / TCPA gates, provider send, and provider-result
// recording (EmailSendLog for transactional, contact_timeline_events for contact
// sends, campaign_recipients stamp). Terminal FAILED is COLUMNS-ONLY (no
// jobs_dead_letter), so the Inngest DLQ drainer can never re-emit a comms job.
//
// SAFETY: adapters fail closed. A provider/render error THROWS so the drain
// retries (bounded) and never records a fabricated success. No real send happens
// unless a gate passes. This module is DORMANT until producers are cut over to it.

import { logger } from "@/lib/logger";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";
import { TemplateService } from "@/lib/services/template.service";
import {
  recordTransactionalEmailSend,
  transactionalEmailAlreadySent,
} from "@/lib/services/email/email-send-log";
import { sendEmailViaResend, sendSmsViaTwilio } from "@/lib/services/comms/comms-providers";
import { normalizePhone } from "@/lib/utils/phone";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplateVariable } from "@/lib/types/crm";

export type EmailOutboxPayload = {
  contactId?: string;
  email: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateVariables?: Partial<Record<TemplateVariable | string, string | number | null>>;
  campaignId?: string;
  campaignRecipientId?: string;
  type?: "transactional" | "marketing";
  idempotencyKey?: string;
};

export type SmsOutboxPayload = {
  contactId?: string;
  phone: string;
  body: string;
  campaignId?: string;
  campaignRecipientId?: string;
  idempotencyKey?: string;
};

// Delivery outcomes — SUCCESS is the only one that sent a message; the rest are
// terminal-non-send (a gate blocked it or it was a duplicate). A retryable error
// is signalled by a THROW, never an outcome.
export type DeliveryOutcome =
  | "SUCCESS"
  | "SUPPRESSED"
  | "GATED"
  | "CONSENT_GATED"
  | "TCPA_GATED"
  | "INVALID_PHONE"
  | "DUPLICATE";

const TERMINAL_STATUS: Record<DeliveryOutcome, "sent" | "suppressed" | "skipped"> = {
  SUCCESS: "sent",
  SUPPRESSED: "suppressed",
  GATED: "skipped",
  CONSENT_GATED: "skipped",
  TCPA_GATED: "skipped",
  INVALID_PHONE: "skipped",
  DUPLICATE: "skipped",
};

const MAX_COMMS_ATTEMPTS = 4; // parity with the retired workers' retries:3
const STALE_MS = 10 * 60 * 1000; // > drain maxDuration; a stale 'sending' row is reclaimable
const DEFAULT_BATCH = 100;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// ENQUEUE — the single dedup point (ON CONFLICT (dedup_key) DO NOTHING)
// ---------------------------------------------------------------------------
export async function enqueueEmail(
  payload: EmailOutboxPayload,
  opts: { runAt?: Date; supabase?: SupabaseClient } = {},
): Promise<{ enqueued: boolean; dedupKey: string }> {
  const dedupKey =
    payload.idempotencyKey || `${payload.contactId ?? payload.email}:email_send:${today()}`;
  return insertOutbox("email", dedupKey, payload, opts);
}

export async function enqueueSms(
  payload: SmsOutboxPayload,
  opts: { runAt?: Date; supabase?: SupabaseClient } = {},
): Promise<{ enqueued: boolean; dedupKey: string }> {
  const normalized = normalizePhone(payload.phone);
  const dedupKey =
    payload.idempotencyKey ||
    `${payload.contactId ?? normalized ?? payload.phone}:sms_send:${today()}`;
  return insertOutbox("sms", dedupKey, payload, opts);
}

async function insertOutbox(
  channel: "email" | "sms",
  dedupKey: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; supabase?: SupabaseClient },
): Promise<{ enqueued: boolean; dedupKey: string }> {
  const supabase = opts.supabase ?? getServiceSupabase();
  // ignoreDuplicates → INSERT ... ON CONFLICT (dedup_key) DO NOTHING. A duplicate
  // emit adds no row and does NOT resurrect a completed one — enqueue-once.
  const { data, error } = await supabase
    .from("comms_outbox")
    .upsert(
      {
        channel,
        dedup_key: dedupKey,
        payload,
        status: "pending",
        run_at: (opts.runAt ?? new Date()).toISOString(),
      },
      { onConflict: "dedup_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`comms_enqueue_failed: ${error.message}`);
  return { enqueued: Array.isArray(data) && data.length > 0, dedupKey };
}

// ---------------------------------------------------------------------------
// DELIVERY — faithful reproduction of the retired workers' gates + send
// ---------------------------------------------------------------------------
async function loadContact(
  supabase: SupabaseClient,
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("contacts").select("*").eq("id", contactId).maybeSingle();
  return data ?? null;
}

export async function deliverEmail(
  supabase: SupabaseClient,
  payload: EmailOutboxPayload,
): Promise<{ outcome: DeliveryOutcome; providerId?: string }> {
  // Transactional lifecycle emails: stable key, no contactId — dedup on the
  // EmailSendLog SENT-precheck (retriable after a transient failure), and bypass
  // the marketing/soft suppression tier (a buyer who unsubbed from MARKETING must
  // still get their own deal emails) while still honoring HARD suppression.
  const isTransactional =
    payload.type === "transactional" && !!payload.idempotencyKey && !payload.contactId;

  if (isTransactional && (await transactionalEmailAlreadySent(payload.idempotencyKey!))) {
    return { outcome: "DUPLICATE" };
  }

  const contact = payload.contactId ? await loadContact(supabase, payload.contactId) : null;
  if (payload.contactId && (!contact || contact.do_not_contact)) {
    return { outcome: "GATED" };
  }

  const suppressed =
    payload.type === "transactional"
      ? await SuppressionService.isEmailHardSuppressed(supabase, payload.email)
      : await SuppressionService.isEmailSuppressed(supabase, payload.email);
  if (suppressed) return { outcome: "SUPPRESSED" };

  if (payload.type === "marketing" && contact && !contact.consent_email) {
    return { outcome: "CONSENT_GATED" };
  }

  // Resolve content: templateId → render; else the direct subject/html payload.
  let rendered: { subject: string; html: string; text: string };
  if (payload.templateId) {
    const baseVars: Record<string, string> = {
      firstName: (contact?.first_name as string) ?? "",
      lastName: (contact?.last_name as string) ?? "",
      fullName: [contact?.first_name, contact?.last_name].filter(Boolean).join(" "),
      supportEmail: process.env.SUPPORT_EMAIL ?? "",
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/buyer/dashboard`,
      unsubscribeUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/unsubscribe`,
    };
    const vars = { ...baseVars, ...(payload.templateVariables ?? {}) };
    rendered = await TemplateService.renderTemplate(supabase, payload.templateId, vars);
  } else {
    if (!payload.subject || !payload.html) throw new Error("EMAIL_PAYLOAD_INCOMPLETE");
    rendered = { subject: payload.subject, html: payload.html, text: payload.text ?? "" };
  }

  let providerId: string | undefined;
  try {
    const out = await sendEmailViaResend({
      to: payload.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    providerId = out.id ?? undefined;
  } catch (err) {
    // Parity: record the failed attempt on EmailSendLog as FAILED (retriable via
    // the SENT-precheck) for transactional sends, then rethrow so the drain retries.
    if (isTransactional) {
      try {
        await recordTransactionalEmailSend({
          idempotencyKey: payload.idempotencyKey!,
          recipient: payload.email,
          templateId: payload.templateId ?? "transactional",
          status: "FAILED",
          resendId: null,
        });
      } catch (logErr) {
        logger.error("[comms-outbox] EmailSendLog FAILED write failed", logErr);
      }
    }
    throw err;
  }

  if (payload.campaignRecipientId) {
    await supabase
      .from("campaign_recipients")
      .update({ status: "sent", sent_at: new Date().toISOString(), resend_id: providerId ?? null })
      .eq("id", payload.campaignRecipientId);
  }

  if (payload.contactId) {
    await supabase.from("contact_timeline_events").insert({
      contact_id: payload.contactId,
      event_type: "email_sent",
      event_data: {
        resend_id: providerId,
        subject: rendered.subject,
        template_id: payload.templateId ?? null,
        campaign_id: payload.campaignId ?? null,
      },
    });
  }

  if (isTransactional) {
    await recordTransactionalEmailSend({
      idempotencyKey: payload.idempotencyKey!,
      recipient: payload.email,
      templateId: payload.templateId ?? "transactional",
      resendId: providerId ?? null,
    });
  }

  return { outcome: "SUCCESS", providerId };
}

export async function deliverSms(
  supabase: SupabaseClient,
  payload: SmsOutboxPayload,
): Promise<{ outcome: DeliveryOutcome; providerId?: string }> {
  const standardized = normalizePhone(payload.phone);
  if (!standardized) return { outcome: "INVALID_PHONE" };

  const contact = payload.contactId ? await loadContact(supabase, payload.contactId) : null;
  // TCPA hard gate — every SMS path requires an addressable contact with explicit
  // consent and no do-not-contact flag.
  if (!contact || !contact.consent_sms || contact.do_not_contact) {
    return { outcome: "TCPA_GATED" };
  }

  if (await SuppressionService.isSmsSuppressed(supabase, standardized)) {
    return { outcome: "SUPPRESSED" };
  }

  const result = await sendSmsViaTwilio({ to: standardized, body: payload.body });

  if (payload.contactId) {
    await supabase.from("contact_timeline_events").insert({
      contact_id: payload.contactId,
      event_type: "sms_sent",
      event_data: { twilio_sid: result.sid },
    });
  }

  return { outcome: "SUCCESS", providerId: result.sid };
}

// ---------------------------------------------------------------------------
// DRAIN — claim (CAS) + deliver + terminal/retry, per row
// ---------------------------------------------------------------------------
export interface CommsDrainSummary {
  status: "OK" | "NO_PENDING";
  claimed: number;
  sent: number;
  gated: number; // suppressed / consent / TCPA / invalid / duplicate (terminal, non-send)
  retried: number;
  failed: number;
  skipped: number; // candidate rows not claimed (lost race) or errored before claim
}

interface OutboxRow {
  id: string;
  channel: "email" | "sms";
  attempts: number;
  payload: Record<string, unknown>;
}

export async function processOutboxRow(
  supabase: SupabaseClient,
  rowId: string,
): Promise<"SENT" | "GATED" | "RETRY" | "FAILED" | "SKIPPED"> {
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  const claimPatch = {
    status: "sending",
    claimed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Claim CAS — two targeted updates (avoids a PostgREST .or() with an embedded
  // timestamp). Each UPDATE re-checks its predicate on the locked row, so a racing
  // drain updates 0 rows. (1) the common path: a still-pending row.
  let { data: claimedRows, error: claimErr } = await supabase
    .from("comms_outbox")
    .update(claimPatch)
    .eq("id", rowId)
    .eq("status", "pending")
    .select("id, channel, attempts, payload");
  if (claimErr) throw new Error(`comms_claim_failed: ${claimErr.message}`);

  // (2) crash recovery: a 'sending' row whose claim went stale (prior drain died).
  if (!claimedRows || claimedRows.length === 0) {
    const reclaim = await supabase
      .from("comms_outbox")
      .update(claimPatch)
      .eq("id", rowId)
      .eq("status", "sending")
      .lt("claimed_at", staleCutoff)
      .select("id, channel, attempts, payload");
    if (reclaim.error) throw new Error(`comms_reclaim_failed: ${reclaim.error.message}`);
    claimedRows = reclaim.data;
  }

  const row = (claimedRows?.[0] as OutboxRow | undefined) ?? null;
  if (!row) return "SKIPPED"; // lost the race / not eligible

  const attempt = row.attempts + 1;
  try {
    const { outcome, providerId } =
      row.channel === "email"
        ? await deliverEmail(supabase, row.payload as EmailOutboxPayload)
        : await deliverSms(supabase, row.payload as SmsOutboxPayload);

    await supabase
      .from("comms_outbox")
      .update({
        status: TERMINAL_STATUS[outcome],
        last_result: outcome,
        provider_id: providerId ?? null,
        attempts: attempt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    return outcome === "SUCCESS" ? "SENT" : "GATED";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (attempt >= MAX_COMMS_ATTEMPTS) {
      // Terminal — COLUMNS-ONLY (status='failed'); nothing to jobs_dead_letter.
      await supabase
        .from("comms_outbox")
        .update({ status: "failed", last_result: "FAILED", last_error: message, attempts: attempt, updated_at: new Date().toISOString() })
        .eq("id", rowId);
      logger.error(`[comms-outbox] row ${rowId} dead-lettered after ${attempt} attempts`, message);
      return "FAILED";
    }
    // Retry: back to pending with a small linear backoff so a flapping provider
    // isn't hammered every tick.
    await supabase
      .from("comms_outbox")
      .update({
        status: "pending",
        last_error: message,
        attempts: attempt,
        run_at: new Date(Date.now() + attempt * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    logger.warn(`[comms-outbox] row ${rowId} attempt ${attempt} failed, re-queued`, message);
    return "RETRY";
  }
}

export async function drainCommsOutbox(batchSize: number = DEFAULT_BATCH): Promise<CommsDrainSummary> {
  const supabase = getServiceSupabase();
  const now = new Date().toISOString();

  // Candidates = due, not-yet-terminal rows. A fresh 'sending' row (owned by a
  // live drain) is selected but the per-row claim CAS will skip it; only a
  // pending or stale-'sending' row is actually claimable.
  const { data, error } = await supabase
    .from("comms_outbox")
    .select("id")
    .lte("run_at", now)
    .in("status", ["pending", "sending"])
    .order("created_at", { ascending: true })
    .limit(batchSize);
  if (error) throw new Error(`comms_drain_query_failed: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) {
    return { status: "NO_PENDING", claimed: 0, sent: 0, gated: 0, retried: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let gated = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rows) {
    let result: Awaited<ReturnType<typeof processOutboxRow>>;
    try {
      result = await processOutboxRow(supabase, r.id as string);
    } catch (err) {
      // Never let one row abort the batch (e.g. a claim/DB error on that row).
      logger.error(`[comms-outbox] unexpected error on row ${r.id}`, err);
      skipped++;
      continue;
    }
    if (result === "SENT") sent++;
    else if (result === "GATED") gated++;
    else if (result === "RETRY") retried++;
    else if (result === "FAILED") failed++;
    else skipped++;
  }

  return { status: "OK", claimed: sent + gated + retried + failed, sent, gated, retried, failed, skipped };
}
