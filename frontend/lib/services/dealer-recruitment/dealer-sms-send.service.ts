// Phase 3 / Task 8c — dealer SMS. Built in full, shipped OFF.
//
// CONSENT IS DELEGATED, NOT COPIED. Every consent decision here comes from
// lib/services/sms/consent-basis — the same gate sendCrmSms evaluates. This
// module deliberately contains no basis literals and no DNC constant of its own,
// and a test asserts that structurally. A private copy would drift from the CRM
// path, and a drifted copy is how a consent check becomes decorative.
//
// WHY THIS REACHES NOBODY TODAY. dealer_contact_profiles.consent_basis defaults
// to NONE and nothing in this change writes anything else, so every dealer
// prospect is refused. That is the correct outcome for vendor-sourced numbers
// with no consent record — the count of unconsented messages to send is zero.
// Enabling it is an owner and counsel decision, not an engineering one.
//
// THE TWILIO CLIENT IS INJECTED. mock.module on a bare specifier does not apply
// under this repo's CJS transform: a `resend` mock earlier on this branch
// recorded zero calls while the service reached the live API with a real
// recipient. Injection keeps the suite off the network by construction.
//
// EVERY ATTEMPT LEAVES EXACTLY ONE ROW, including a blocked one — the same
// invariant the email path now holds. A gate that refuses silently is the bug
// that made an empty dealer_outreach_log unreadable.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/utils/phone";
import { evaluateConsentBasis, type ConsentBasis } from "@/lib/services/sms/consent-basis";

export type DealerSmsReason =
  | "send_disabled"
  | "not_found"
  | "invalid_phone"
  | "already_contacted"
  | "no_consent_basis"
  | "dnc_blocked"
  | "phone_type_blocked"
  | "suppressed"
  | "quiet_hours"
  | "not_configured"
  | "send_error";

export interface DealerSmsResult {
  success: boolean;
  reason?: DealerSmsReason;
  error?: string;
  twilioSid?: string;
  outreachLogId?: string;
}

export interface SendDealerSmsInput {
  prospectId: string;
  body: string;
  step?: number;
}

export interface DealerSmsTarget {
  prospectId: string;
  phone: string | null;
  state: string | null;
  zip: string | null;
  consentBasis: string | null;
  dncStatus: string | null;
  phoneType: string | null;
}

export interface DealerSmsDeps {
  prisma: PrismaClient;
  now: Date;
  sendEnabled: () => boolean;
  loadTarget: (prospectId: string) => Promise<DealerSmsTarget | null>;
  findPriorLiveAttempt: (prospectId: string, step: number) => Promise<{ id: string } | null>;
  /** Observability hook so a test can prove the SHARED gate was consulted. */
  onConsentEvaluated: (basis: ConsentBasis, allowed: boolean) => void;
  isSmsSuppressed: (phone: string) => Promise<boolean>;
  inQuietHours: (now: Date, loc: { state: string | null; zip: string | null }) => boolean;
  dispatch: (to: string, body: string) => Promise<{ sid: string | null; error: string | null }>;
  createLog: (data: Record<string, unknown>) => Promise<{ id: string }>;
  updateLog: (id: string, data: Record<string, unknown>) => Promise<void>;
}

/** OFF by default. Enabling is an owner decision, and counsel's before that. */
export function dealerSmsSendEnabled(): boolean {
  return process.env.DEALER_OUTREACH_SMS_ENABLED === "true";
}

/** Map the shared gate's block reason onto this service's vocabulary. */
const GATE_REASON: Record<string, DealerSmsReason> = {
  NO_CONSENT_BASIS: "no_consent_basis",
  DNC_BLOCKED: "dnc_blocked",
  PHONE_TYPE_BLOCKED: "phone_type_blocked",
};

/**
 * Send one dealer SMS.
 *
 * Gate order, all BEFORE any provider call:
 *   send flag -> prospect exists -> phone valid -> idempotency ->
 *   shared consent gate (consent, DNC, phone type) -> suppression -> quiet hours
 *
 * Suppression and quiet hours are evaluated HERE rather than when a queue was
 * built: a number opted out five minutes ago must not be messaged because a
 * batch was assembled ten minutes ago.
 */
export async function sendDealerSms(
  input: SendDealerSmsInput,
  deps?: Partial<DealerSmsDeps>,
): Promise<DealerSmsResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const sendEnabled = deps?.sendEnabled ?? dealerSmsSendEnabled;
  const step = input.step ?? 1;
  const loadTarget = deps?.loadTarget;
  const findPriorLiveAttempt = deps?.findPriorLiveAttempt ?? (async () => null);
  const onConsentEvaluated = deps?.onConsentEvaluated ?? (() => {});
  const isSmsSuppressed = deps?.isSmsSuppressed ?? (async () => true); // fail closed
  const inQuietHours = deps?.inQuietHours ?? (() => true); // fail closed
  const dispatch = deps?.dispatch;
  const createLog =
    deps?.createLog ??
    (async (data: Record<string, unknown>) =>
      prisma.dealerOutreachLog.create({ data: data as never, select: { id: true } }));
  const updateLog =
    deps?.updateLog ??
    (async (id: string, data: Record<string, unknown>) => {
      await prisma.dealerOutreachLog.update({ where: { id }, data: data as never });
    });

  const target = loadTarget ? await loadTarget(input.prospectId) : null;
  if (!target) {
    // No prospect means no FK to hang a row on — the same constraint the email
    // path has for not_found.
    return { success: false, reason: "not_found", error: "Dealer prospect not found" };
  }

  const phone = normalizePhone(target.phone ?? "");
  const basisRaw = (target.consentBasis ?? "NONE") as ConsentBasis;

  // One terminal row for a rejected attempt, carrying the basis in force.
  const reject = async (reason: DealerSmsReason, error: string): Promise<DealerSmsResult> => {
    const row = await createLog({
      dealerProspectId: target.prospectId,
      outreachType: `sms_step_${step}`,
      channel: "sms",
      status: "failed",
      errorMessage: error,
      toPhone: phone || target.phone,
      consentBasis: basisRaw,
      outreachSequenceStep: step,
      sentAt: now,
    });
    logger.warn(`[dealer-sms] blocked for ${target.prospectId} (${reason}): ${error}`);
    return { success: false, reason, error, outreachLogId: row.id };
  };

  if (!sendEnabled()) {
    return reject("send_disabled", "DEALER_OUTREACH_SMS_ENABLED is not true");
  }
  if (!phone) {
    return reject("invalid_phone", `Not a usable US phone number: ${target.phone ?? "(none)"}`);
  }

  // Idempotency: a live attempt at this step already exists. Point at it rather
  // than adding a second row or a second message.
  const prior = await findPriorLiveAttempt(target.prospectId, step);
  if (prior) {
    return {
      success: false,
      reason: "already_contacted",
      error: "An SMS attempt for this step already exists",
      outreachLogId: prior.id,
    };
  }

  // THE shared gate. Consent, DNC and phone type in one decision, identical to
  // the rule the CRM path evaluates.
  const consent = evaluateConsentBasis({
    basis: basisRaw,
    dncStatus: target.dncStatus,
    phoneType: target.phoneType,
  });
  onConsentEvaluated(consent.basis, consent.allowed);
  if (!consent.allowed) {
    const reason = GATE_REASON[consent.reason ?? ""] ?? "no_consent_basis";
    return reject(reason, `Phone channel closed: ${consent.reason} (basis ${consent.basis})`);
  }

  if (await isSmsSuppressed(phone)) {
    return reject("suppressed", "Recipient number is suppressed (STOP / opt-out)");
  }
  if (inQuietHours(now, { state: target.state, zip: target.zip })) {
    return reject("quiet_hours", "Outside the recipient's permitted local calling window");
  }
  if (!dispatch) {
    return reject("not_configured", "No SMS provider configured");
  }

  // Queued row before dispatch — "queued" is true exactly while in flight.
  const log = await createLog({
    dealerProspectId: target.prospectId,
    outreachType: `sms_step_${step}`,
    channel: "sms",
    status: "queued",
    body: input.body,
    toPhone: phone,
    consentBasis: consent.basis,
    outreachSequenceStep: step,
    sentAt: now,
  });

  let outcome: { sid: string | null; error: string | null };
  try {
    outcome = await dispatch(phone, input.body);
  } catch (err) {
    outcome = { sid: null, error: err instanceof Error ? err.message : String(err) };
  }

  if (outcome.error || !outcome.sid) {
    const message = outcome.error ?? "Provider returned no message sid";
    await updateLog(log.id, { status: "failed", errorMessage: message });
    logger.error(`[dealer-sms] dispatch failed for ${target.prospectId}: ${message}`);
    return { success: false, reason: "send_error", error: message, outreachLogId: log.id };
  }

  await updateLog(log.id, { status: "sent", twilioSid: outcome.sid });
  logger.info(`[dealer-sms] sent to ${target.prospectId} (${outcome.sid})`);
  return { success: true, twilioSid: outcome.sid, outreachLogId: log.id };
}
