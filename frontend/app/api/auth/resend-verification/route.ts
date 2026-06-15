// POST /api/auth/resend-verification
// Resends the AutoLenis branded verification email.
// Caller supplies: { email: string }
// Rate limiting: one resend per 60 seconds per email (checked via AdminAuditLog).
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/services/email/resend.service";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/auth/urls";

const IDEMPOTENCY_WINDOW_MS = 60_000;

interface GenerateLinkResult {
  data: { properties?: { action_link?: string } };
}
interface GenerateLinkAdmin {
  generateLink(opts: {
    type: string;
    email: string;
    options?: { redirectTo: string };
  }): Promise<GenerateLinkResult>;
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { email?: string };
  const { email } = body;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Look up buyer for rate limiting and email personalization
  const buyer = await prisma.buyer.findFirst({
    where: { user: { email: normalizedEmail } },
    select: { id: true, firstName: true },
  });
  const buyerEntityId = buyer?.id ?? normalizedEmail;

  // Rate limit: prevent spam — max 1 resend per 60s per buyer/email
  const recentResend = await prisma.adminAuditLog.findFirst({
    where: {
      action: "VERIFICATION_RESENT",
      entityType: "BUYER",
      entityId: buyerEntityId,
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
  }).catch(() => null);

  if (recentResend) {
    return NextResponse.json(
      { error: "Please wait a moment before requesting another verification email." },
      { status: 429 }
    );
  }

  try {
    const callbackUrl = `${getAppUrl()}/auth/callback`;
    const admin = createServiceSupabaseClient().auth.admin as unknown as GenerateLinkAdmin;

    // Generate a fresh OTP link via the admin API — does not trigger Supabase email.
    // Use signup type so the link only verifies the email rather than signing the
    // user in (magiclink would create a session). The callback verifies and
    // lands the buyer on the dashboard after they sign in normally.
    const { data: linkData } = await admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      options: { redirectTo: callbackUrl },
    });

    const verificationUrl =
      linkData?.properties?.action_link ??
      `${getAppUrl()}/auth/verify-email`;

    const firstName = buyer?.firstName ?? normalizedEmail.split("@")[0];

    await sendWelcomeEmail({
      to: normalizedEmail,
      firstName,
      verificationUrl,
      idempotencyKey: `welcome-resend-${normalizedEmail}-${Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS)}`,
    });

    // Log for rate limiting
    await prisma.adminAuditLog.create({
      data: {
        action: "VERIFICATION_RESENT",
        entityType: "BUYER",
        entityId: buyerEntityId,
        adminId: "system",
        adminEmail: "system@autolenis.com",
        metadata: { email: normalizedEmail },
      },
    }).catch(() => {});
  } catch (e) {
    logger.error("[resend-verification]", e);
    // Always return success — never reveal if email exists
  }

  return NextResponse.json({ success: true });
}
