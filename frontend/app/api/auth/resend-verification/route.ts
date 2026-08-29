// POST /api/auth/resend-verification
// Resends the AutoLenis branded verification email.
// Caller supplies: { email: string }
// Rate limiting: one resend per 60 seconds per email (checked via AdminAuditLog).
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase";
import { sendWelcomeEmail, sendAffiliateVerificationEmail } from "@/lib/services/email/resend.service";
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

// O2 — the affiliate variant: same rate-limit + enumeration-safety contract,
// affiliate-branded email, callback tagged with role=AFFILIATE (matching the
// register route) so verification lands on the affiliate sign-in.
async function resendForAffiliate(normalizedEmail: string) {
  const affiliate = await prisma.affiliate
    .findFirst({
      where: { user: { email: normalizedEmail } },
      select: { id: true, referralCode: true, profile: { select: { firstName: true } } },
    })
    .catch(() => null);
  const entityId = affiliate?.id ?? normalizedEmail;

  const recentResend = await prisma.adminAuditLog
    .findFirst({
      where: {
        action: "VERIFICATION_RESENT",
        entityType: "AFFILIATE",
        entityId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    })
    .catch(() => null);
  if (recentResend) {
    return NextResponse.json(
      { error: "Please wait a moment before requesting another verification email." },
      { status: 429 },
    );
  }

  try {
    const admin = createServiceSupabaseClient().auth.admin as unknown as GenerateLinkAdmin;
    const { data: linkData } = await admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      options: { redirectTo: `${getAppUrl()}/auth/callback?role=AFFILIATE` },
    });
    const verificationUrl = linkData?.properties?.action_link;
    if (verificationUrl && affiliate) {
      const firstName = affiliate.profile?.firstName ?? normalizedEmail.split("@")[0];
      await sendAffiliateVerificationEmail(normalizedEmail, firstName, affiliate.referralCode, verificationUrl);
      await prisma.adminAuditLog
        .create({
          data: {
            action: "VERIFICATION_RESENT",
            entityType: "AFFILIATE",
            entityId,
            adminId: "system",
            adminEmail: "system@autolenis.com",
            metadata: { email: normalizedEmail },
          },
        })
        .catch(() => {});
    } else {
      // No link means Supabase can't mint one (already verified, or admin API
      // failure) — never send a dead-end email pointing nowhere.
      logger.error("[resend-verification] affiliate link unavailable", { email: normalizedEmail });
    }
  } catch (e) {
    logger.error("[resend-verification] affiliate resend failed:", e);
    // Enumeration-safe: fall through to success either way.
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { email?: string };
  const { email } = body;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // O2 — affiliates need a reachable resend path too: their sign-in blocks
  // unverified emails, but this route was buyer-branded end to end. Branch on
  // the account's role; one route, no parallel system.
  const account = await prisma.user
    .findFirst({ where: { email: normalizedEmail }, select: { role: true } })
    .catch(() => null);
  if (account?.role === "AFFILIATE") {
    return resendForAffiliate(normalizedEmail);
  }

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
