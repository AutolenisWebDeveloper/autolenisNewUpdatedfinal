import { logger } from "@/lib/logger";
import "server-only";
import { Resend } from "resend";
import twilio from "twilio";
import { getServiceSupabase } from "@/lib/supabase-service";
import { ContactService } from "@/lib/services/contact.service";
import { SuppressionService } from "@/lib/services/suppression.service";
import { normalizePhone } from "@/lib/utils/phone";
import type { Contact } from "@/lib/types/crm";

// ---------------------------------------------------------------------------
// QStash job notification layer — direct Resend / Twilio sends with the same
// consent + suppression gating the legacy Inngest workers enforced. Consent
// (consent_sms / do_not_contact) lives on the Supabase `contacts` row that is
// linked to a buyer / dealer / affiliate via `contact_identities`.
//
// SMS is hard-gated on TCPA consent: a message is only sent when a linked
// contact exists with consent_sms = true, do_not_contact = false, and the
// number is not suppressed. Every SMS body is suffixed with the required
// "Reply STOP to opt out." line.
// ---------------------------------------------------------------------------

export type JobEntityType = "buyer" | "dealer" | "affiliate";

const FROM_NAME = process.env.FROM_NAME ?? "AutoLenis";
const FROM_EMAIL = "noreply@autolenis.com";
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();

let _resend: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!_resend) _resend = new Resend(apiKey);
  return _resend;
}

let _twilio: ReturnType<typeof twilio> | null = null;
function getTwilio(): ReturnType<typeof twilio> | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (!_twilio) _twilio = twilio(sid, token);
  return _twilio;
}

// Resolve the Supabase contact linked to a platform entity (buyer/dealer/
// affiliate). Returns null when no contact has been linked — in which case SMS
// is skipped (no consent on record) while transactional email can still send.
async function resolveContact(
  entityType: JobEntityType,
  entityId: string,
): Promise<Contact | null> {
  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from("contact_identities")
      .select("contact_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (!data?.contact_id) return null;
    return await ContactService.getContactById(supabase, data.contact_id);
  } catch (err) {
    logger.error(`[qstash/notify] contact resolution failed for ${entityType}:${entityId}`, err);
    return null;
  }
}

interface NotifyOptions {
  entityType: JobEntityType;
  entityId: string;
  /** Fallback phone (E.164 or raw) used only when the linked contact has none. */
  phone?: string | null;
  email?: string | null;
  /** SMS body WITHOUT the "Reply STOP to opt out." suffix — it is appended here. */
  sms?: string;
  emailSubject?: string;
  emailHtml?: string;
}

export interface NotifyResult {
  smsSent: boolean;
  emailSent: boolean;
}

export async function notifyContact(opts: NotifyOptions): Promise<NotifyResult> {
  const contact = await resolveContact(opts.entityType, opts.entityId);
  const result: NotifyResult = { smsSent: false, emailSent: false };

  if (opts.sms) {
    result.smsSent = await sendSms(contact, opts.phone ?? null, opts.sms);
  }

  if (opts.emailSubject && opts.emailHtml) {
    const email = opts.email ?? contact?.email ?? null;
    result.emailSent = await sendEmail(contact, email, opts.emailSubject, opts.emailHtml);
  }

  return result;
}

async function sendSms(
  contact: Contact | null,
  fallbackPhone: string | null,
  body: string,
): Promise<boolean> {
  // TCPA hard gate — every SMS requires an explicit, current opt-in.
  if (!contact || !contact.consent_sms || contact.do_not_contact) return false;

  const phone = normalizePhone(contact.phone ?? fallbackPhone);
  if (!phone) return false;

  try {
    const supabase = getServiceSupabase();
    if (await SuppressionService.isSmsSuppressed(supabase, phone)) return false;

    const client = getTwilio();
    if (!client) {
      logger.warn(`[qstash/notify] Twilio not configured — SMS skipped for ${phone}`);
      return false;
    }

    await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: phone,
      body: `${body}\n\nReply STOP to opt out.`,
    });
    return true;
  } catch (err) {
    logger.error("[qstash/notify] SMS send failed:", err);
    return false;
  }
}

async function sendEmail(
  contact: Contact | null,
  email: string | null,
  subject: string,
  html: string,
): Promise<boolean> {
  if (!email) return false;
  // A contact flagged do-not-contact is suppressed across every channel.
  if (contact?.do_not_contact) return false;

  try {
    const supabase = getServiceSupabase();
    if (await SuppressionService.isEmailSuppressed(supabase, email)) return false;

    const resend = getResend();
    if (!resend) {
      logger.warn(`[qstash/notify] Resend not configured — email skipped for ${email}`);
      return false;
    }

    const out = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html,
      headers: { "List-Unsubscribe": `<${APP_URL}/unsubscribe>` },
    });
    if (out.error) {
      logger.error(`[qstash/notify] Resend dispatch failed for ${email}:`, out.error);
      return false;
    }
    return true;
  } catch (err) {
    logger.error("[qstash/notify] email send failed:", err);
    return false;
  }
}

// Minimal branded email wrapper so job emails share one consistent shell.
export function renderEmail(opts: {
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<div style="margin:28px 0"><a href="${opts.ctaUrl}" style="display:inline-block;background:#0B5FD1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${opts.ctaText}</a></div>`
      : "";
  return `
    <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff">
      <div style="background:#0B5FD1;padding:28px 32px">
        <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:-0.01em">${opts.heading}</h1>
      </div>
      <div style="padding:28px 32px;color:#1f2937;line-height:1.7;font-size:14px">
        ${opts.bodyHtml}
        ${cta}
      </div>
      <div style="background:#F8F9FA;padding:18px 32px;border-top:1px solid #E5E7EB;text-align:center">
        <p style="margin:0;color:#94A3B8;font-size:11px">AutoLenis, Inc. · <a href="${APP_URL}/unsubscribe" style="color:#94A3B8">Unsubscribe</a></p>
      </div>
    </div>`;
}

export { APP_URL as NOTIFY_APP_URL };
