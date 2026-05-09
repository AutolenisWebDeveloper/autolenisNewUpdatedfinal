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

const schema = z.object({
  name:    z.string().min(1).max(100),
  email:   z.string().email(),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" }, correlationId: crypto.randomUUID() },
      { status: 400 }
    );
  }

  const { name, email, subject, message } = parsed.data;
  const resend = getResend();

  // 1. Notify admin (non-blocking — do not fail the request if email fails).
  if (resend) {
    resend.emails.send({
      from: FROM,
      to: ADMIN_TO,
      replyTo: email,
      subject: `[Contact] ${subject} — from ${name}`,
      text: `New contact form submission.\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
    }).catch(err => console.error("[contact] admin notification failed:", err));

    // 2. Send confirmation to user (non-blocking).
    resend.emails.send({
      from: FROM,
      to: email,
      subject: "We received your message — AutoLenis",
      text: `Hi ${name},\n\nThanks for reaching out. We received your message and will get back to you within 1–2 business days.\n\nHere's what you sent:\n\nSubject: ${subject}\n${message}\n\n— The AutoLenis Team`,
    }).catch(err => console.error("[contact] user confirmation failed:", err));
  } else {
    console.warn("[contact] Resend client not configured — emails skipped");
  }

  // 3. Persist to DB so admin has a paper trail even if email delivery fails.
  // Notification.buyerId/dealerId/affiliateId are all optional — a free-floating
  // SYSTEM_ALERT is acceptable for internal staff visibility.
  await prisma.notification.create({
    data: {
      type: "SYSTEM_ALERT",
      title: `Contact Form: ${subject}`,
      body: `From: ${name} <${email}>\n\n${message.slice(0, 500)}${message.length > 500 ? "…" : ""}`,
      metadata: { source: "public_contact_form", name, email, subject, fullMessage: message },
    },
  }).catch(err => console.error("[contact] DB log failed:", err));

  return NextResponse.json({ success: true, data: { message: "Message sent" } }, { status: 201 });
}
