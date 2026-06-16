import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

// Lazy Resend client — same pattern as lib/services/email/resend.service.ts.
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
  name:     z.string().max(100).optional(),
  email:    z.string().email().optional(),
  category: z.string().min(1).max(80),
  message:  z.string().min(1).max(5000),
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

  const { name, email, category, message } = parsed.data;
  const resend = getResend();

  // 1. Notify admin (non-blocking).
  if (resend) {
    resend.emails.send({
      from: FROM,
      to: ADMIN_TO,
      ...(email ? { replyTo: email } : {}),
      subject: `[Feedback] ${category}`,
      text: `Platform feedback received.\n\nCategory: ${category}\n${name ? `Name: ${name}\n` : ""}${email ? `Email: ${email}\n` : ""}\nMessage:\n${message}`,
    }).catch(err => logger.error("[feedback] admin notification failed:", err));

    // 2. Confirmation to user only if they provided an email (non-blocking).
    if (email) {
      resend.emails.send({
        from: FROM,
        to: email,
        subject: "Thanks for your feedback — AutoLenis",
        text: `${name ? `Hi ${name},\n\n` : ""}We appreciate your feedback. It helps us make AutoLenis better.\n\n— The AutoLenis Team`,
      }).catch(err => logger.error("[feedback] user confirmation failed:", err));
    }
  } else {
    logger.warn("[feedback] Resend client not configured — emails skipped");
  }

  // 3. Persist to DB for internal tracking.
  await prisma.notification.create({
    data: {
      type: "SYSTEM_ALERT",
      title: `Feedback: ${category}`,
      body: `${name ?? "Anonymous"}: ${message.slice(0, 500)}${message.length > 500 ? "…" : ""}`,
      metadata: { source: "public_feedback_form", name, email, category, message },
    },
  }).catch(err => logger.error("[feedback] DB log failed:", err));

  return NextResponse.json({ success: true, data: { message: "Feedback received" } }, { status: 201 });
}
