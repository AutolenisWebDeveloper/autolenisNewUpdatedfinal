import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

// Lazy Resend client — same pattern as lib/services/email/resend.service.ts so
// the route does not throw at build time when RESEND_API_KEY is unset.
let resendInstance: Resend | null = null;
function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

const FROM_NAME = process.env.FROM_NAME ?? "AutoLenis";
const FROM_EMAIL = "noreply@autolenis.com";
const FROM = `${FROM_NAME} <${FROM_EMAIL}>`;
const ADMIN_TO = process.env.ADMIN_NOTIFICATION_EMAIL ?? "team@autolenis.com";

// TCPA consent disclosure recorded when a phone number is submitted with SMS
// consent. Kept server-authoritative so the stored consent text is the terms we
// consider agreed to, independent of the client label.
const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from AutoLenis regarding my inquiry, account " +
  "notifications, and service-related communications. Message frequency varies. " +
  "Message and data rates may apply. Reply STOP to opt out, HELP for assistance. " +
  "Consent is not a condition of purchase.";

export const contactSchema = z
  .object({
    name:       z.string().min(1).max(100),
    email:      z.string().email(),
    phone:      z.string().max(30).optional(),
    subject:    z.string().min(1).max(200),
    message:    z.string().min(1).max(5000),
    smsConsent: z.boolean().optional(),
  })
  // TCPA defense-in-depth: never accept a phone number for messaging without an
  // explicit consent flag. The client also gates this, but the server must not
  // rely on a client check.
  .refine((d) => !(d.phone && d.phone.trim().length > 0) || d.smsConsent === true, {
    message: "SMS consent is required when a phone number is provided.",
    path: ["smsConsent"],
  });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid JSON" }, correlationId: crypto.randomUUID() },
      { status: 400 }
    );
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" }, correlationId: crypto.randomUUID() },
      { status: 400 }
    );
  }

  const { name, email, phone, subject, message, smsConsent } = parsed.data;
  const hasPhone = !!(phone && phone.trim().length > 0);
  // Auditable TCPA consent record — captured only when a phone was provided with
  // consent, and stamped with the time and the exact terms agreed to.
  const smsConsentRecord = hasPhone && smsConsent === true
    ? { smsConsent: true, smsConsentAt: new Date().toISOString(), smsConsentText: SMS_CONSENT_TEXT }
    : { smsConsent: false };
  const resend = getResend();

  // 1. Notify admin (non-blocking — do not fail the request if email fails).
  if (resend) {
    resend.emails.send({
      from: FROM,
      to: ADMIN_TO,
      replyTo: email,
      subject: `[Contact] ${subject} — from ${name}`,
      text: `New contact form submission.\n\nName: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ""}\nSubject: ${subject}\n\nMessage:\n${message}`,
    }).catch(err => logger.error("[contact] admin notification failed:", err));

    // 2. Send confirmation to user (non-blocking).
    resend.emails.send({
      from: FROM,
      to: email,
      subject: "We received your message — AutoLenis",
      text: `Hi ${name},\n\nThanks for reaching out. We received your message and will get back to you within 1–2 business days.\n\nHere's what you sent:\n\nSubject: ${subject}\n${message}\n\n— The AutoLenis Team`,
    }).catch(err => logger.error("[contact] user confirmation failed:", err));
  } else {
    logger.warn("[contact] Resend client not configured — emails skipped");
  }

  // 3. Persist to DB so admin has a paper trail even if email delivery fails.
  // Notification.buyerId/dealerId/affiliateId are all optional — a free-floating
  // SYSTEM_ALERT is acceptable for internal staff visibility.
  await prisma.notification.create({
    data: {
      type: "SYSTEM_ALERT",
      title: `Contact Form: ${subject}`,
      body: `From: ${name} <${email}>\n\n${message.slice(0, 500)}${message.length > 500 ? "…" : ""}`,
      metadata: { source: "public_contact_form", name, email, phone: phone ?? null, subject, fullMessage: message, ...smsConsentRecord },
    },
  }).catch(err => logger.error("[contact] DB log failed:", err));

  return NextResponse.json({ success: true, data: { message: "Message sent" } }, { status: 201 });
}
