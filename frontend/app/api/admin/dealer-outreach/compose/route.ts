// POST /api/admin/dealer-outreach/compose — send a custom, admin-authored email
// to a dealer prospect and log it to the communication history.
//
// This differs from /send (which builds an AI-generated / sequence template). Here
// the admin supplies the subject + body verbatim; we wrap it in the same CAN-SPAM
// footer used by the template service and dispatch via Resend. Suppression and the
// missing-env deliverability guard are mirrored inline (we do NOT call the send
// service so the compose flow stays independent of sequence semantics).
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { Resend } from "resend";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { getServiceSupabase } from "@/lib/supabase-service";
import { SuppressionService } from "@/lib/services/suppression.service";
import { missingEmailEnvVars } from "@/lib/services/dealer-recruitment/dealer-email-send.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_EMAIL_TYPES = new Set([
  "invitation",
  "follow_up",
  "missing_info",
  "offer_follow_up",
  "re_engagement",
  "general",
]);

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

const FROM_NAME = process.env.FROM_NAME ?? "Markist Athelus";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autolenis.com").trim();

interface Body {
  dealerProspectId?: string;
  subject?: string;
  body?: string;
  emailType?: string;
}

let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

// Best-effort suppression check — mirrors dealer-email-send.service. Fails open
// only when the Supabase client can't be constructed.
async function isSuppressed(email: string): Promise<boolean> {
  try {
    const supabase = getServiceSupabase();
    return await SuppressionService.isEmailSuppressed(supabase, email);
  } catch (err) {
    logger.warn(
      `[compose] Suppression check failed (allowing send): ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Wrap the admin's plain-text body in the founder signature + CAN-SPAM footer,
// matching the structure produced by email-template.service buildFullEmail.
function buildEmail(
  rawBody: string,
  dealerEmail: string,
): { html: string; text: string } {
  const replyTo = process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com";
  const physicalAddress = process.env.AUTOLENIS_PHYSICAL_ADDRESS ?? "AutoLenis, Inc.";

  const text = `${rawBody}

Best,
${FROM_NAME}
Founder, AutoLenis
${replyTo}
${APP_URL}

---
This email was sent to ${dealerEmail} because your dealership is listed as an automotive retailer matching buyer demand in your area. If you'd prefer not to receive future emails, reply with "UNSUBSCRIBE" and we'll remove you immediately.

${physicalAddress}`;

  const html = `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;font-size:14px;line-height:1.7">${text
    .split("\n\n")
    .map((para) => {
      if (para.startsWith("---")) {
        return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>`;
      }
      return `<p style="margin:0 0 16px">${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n")}</div>`;

  return { html, text };
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  const dealerProspectId = body.dealerProspectId?.trim();
  const subject = body.subject?.trim();
  const messageBody = body.body?.trim();
  const emailType = body.emailType?.trim();

  if (!dealerProspectId) return adminError("MISSING_ID", "dealerProspectId is required", 400);
  if (!subject) return adminError("MISSING_SUBJECT", "subject is required", 400);
  if (!messageBody) return adminError("MISSING_BODY", "body is required", 400);
  if (!emailType || !VALID_EMAIL_TYPES.has(emailType)) {
    return adminError("INVALID_TYPE", "emailType is invalid", 400);
  }
  if (subject.length > SUBJECT_MAX) {
    return adminError("SUBJECT_TOO_LONG", `subject exceeds ${SUBJECT_MAX} chars`, 400);
  }
  if (messageBody.length > BODY_MAX) {
    return adminError("BODY_TOO_LONG", `body exceeds ${BODY_MAX} chars`, 400);
  }

  // Deliverability guard — refuse to send from an unconfigured sending domain.
  const missingEnv = missingEmailEnvVars();
  if (missingEnv.length > 0) {
    return adminError(
      "EMAIL_NOT_CONFIGURED",
      `Email domain not configured — set in Vercel before sending: ${missingEnv.join(", ")}`,
      400,
    );
  }

  const prospect = await prisma.dealerProspect.findUnique({
    where: { id: dealerProspectId },
    select: { id: true, name: true, email: true, contactedAt: true },
  });
  if (!prospect) return adminError("NOT_FOUND", "Prospect not found", 404);
  if (!prospect.email) return adminError("NO_EMAIL", "Dealer has no email", 400);

  if (await isSuppressed(prospect.email)) {
    return adminError(
      "SUPPRESSED",
      "Recipient is suppressed (bounced/unsubscribed)",
      400,
    );
  }

  const fromEmail = process.env.DEALER_OUTREACH_FROM_EMAIL ?? "dealers@autolenis.com";
  const { html, text } = buildEmail(messageBody, prospect.email);

  // Log row first (queued) so every attempt is recorded even if dispatch throws.
  const log = await prisma.dealerOutreachLog.create({
    data: {
      dealerProspectId: prospect.id,
      outreachType: emailType,
      channel: "email",
      subject,
      body: text,
      toEmail: prospect.email,
      fromEmail,
      status: "queued",
      outreachSequenceStep: null,
    },
  });

  const resend = getResend();
  if (!resend) {
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: "RESEND_API_KEY not configured" },
    });
    return adminError("EMAIL_NOT_CONFIGURED", "Email sending not configured", 400);
  }

  try {
    const result = await resend.emails.send({
      from: `${FROM_NAME} <${fromEmail}>`,
      to: prospect.email,
      replyTo: process.env.DEALER_OUTREACH_REPLY_TO ?? "markist@skaipay.com",
      subject,
      html,
      text,
      tags: [
        { name: "outreach_type", value: emailType },
        { name: "dealer_id", value: prospect.id },
        { name: "compose", value: "custom" },
      ],
    });

    if (result.error || !result.data?.id) {
      const msg = result.error?.message ?? "Resend returned no message id";
      await prisma.dealerOutreachLog.update({
        where: { id: log.id },
        data: { status: "failed", errorMessage: msg },
      });
      return adminError("SEND_FAILED", msg, 502);
    }

    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "sent", resendId: result.data.id },
    });

    // Stamp first-contact timestamp if this is the dealer's first touch.
    if (!prospect.contactedAt) {
      await prisma.dealerProspect
        .update({ where: { id: prospect.id }, data: { contactedAt: new Date() } })
        .catch(() => {
          // Non-blocking — the send already succeeded.
        });
    }

    return adminSuccess({ success: true, outreachLogId: log.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.dealerOutreachLog.update({
      where: { id: log.id },
      data: { status: "failed", errorMessage: msg },
    });
    return adminError("SEND_FAILED", msg, 500);
  }
}
