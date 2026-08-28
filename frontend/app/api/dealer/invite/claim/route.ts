// POST /api/dealer/invite/claim — validate invitation token, create User+Dealer, redirect to onboarding

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { UserRole, DealerStatus } from "@prisma/client";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { sendDealerWelcomeEmail } from "@/lib/services/email/resend.service";
import { ContactService } from "@/lib/services/contact.service";
import { getServiceSupabase } from "@/lib/supabase-service";
import { z } from "zod";
import { validateInvitationToken, consumeInvitationToken } from "@/lib/services/dealer-recruitment/invitation-token.service";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  businessName: z.string().min(1).optional(),
});

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { token, password, businessName } = parsed.data;

  // Validate by HASH — the raw token is never stored, so it is never compared
  // against a stored plaintext value.
  const validation = await validateInvitationToken(token);
  if (!validation.ok) {
    if (validation.reason === "consumed") {
      return NextResponse.json({ error: "Invitation already accepted" }, { status: 409 });
    }
    if (validation.reason === "cancelled") {
      return NextResponse.json({ error: "This invitation has been cancelled" }, { status: 410 });
    }
    if (validation.reason === "expired") {
      return NextResponse.json(
        { error: "This invitation has expired. Please request a new one." },
        { status: 410 },
      );
    }
    return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 });
  }
  const invitation = {
    id: validation.invitationId,
    email: validation.email,
    dealershipName: validation.dealershipName,
    contactName: validation.contactName,
  };

  // Check if email already registered
  const existing = await prisma.user.findFirst({ where: { email: invitation.email.toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists. Please sign in." }, { status: 409 });
  }

  const supabase = adminSupabase();
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: invitation.email.toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { role: "DEALER", dealershipName: invitation.dealershipName },
  });

  if (authErr || !created?.user) {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  const supabaseUserId = created.user.id;
  let dealerId = "";

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          supabaseId: supabaseUserId,
          email: invitation.email.toLowerCase(),
          role: UserRole.DEALER,
        },
      });
      const dealer = await tx.dealer.create({
        data: {
          userId: user.id,
          dealershipName: businessName ?? invitation.dealershipName,
          status: DealerStatus.PENDING,
        },
      });
      dealerId = dealer.id;
      // Consumed through the service, inside THIS transaction, so the guard the
      // service enforces (PENDING + not yet consumed) actually applies here and
      // two concurrent claims of the same link cannot both create a dealer. The
      // loser's transaction aborts and its Supabase user is deleted below.
      const consumed = await consumeInvitationToken(invitation.id, dealer.id, new Date(), tx);
      if (!consumed) {
        throw new Error("INVITATION_ALREADY_CONSUMED");
      }
    });
  } catch (err) {
    await supabase.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    if (err instanceof Error && err.message === "INVITATION_ALREADY_CONSUMED") {
      // Lost the race: the invitation was accepted, cancelled, or swept to
      // EXPIRED between validation and consumption. No dealer was created.
      return NextResponse.json(
        { error: "This invitation is no longer available. Please request a new one." },
        { status: 409 },
      );
    }
    logger.error("[dealer/invite/claim] DB error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Issue dealer JWT
  const jwtToken = await signDealerJwt({
    dealerId,
    userId: created.user.id,
    email: invitation.email.toLowerCase(),
    role: "DEALER",
  });

  try {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
    await sendDealerWelcomeEmail({ to: invitation.email, contactName: invitation.contactName, dealershipName: invitation.dealershipName, dashboardUrl: `${appUrl}/dealer/dashboard` });
  } catch (err) {
    logger.error("[dealer/invite/claim] Welcome email error:", err);
  }

  // Sync into CRM contacts (non-fatal)
  try {
    const crmSupabase = getServiceSupabase();
    const [firstName, ...rest] = (invitation.contactName ?? "").split(" ");
    const lastName = rest.join(" ");
    const contact = await ContactService.upsertContact(crmSupabase, {
      email: invitation.email.toLowerCase(),
      firstName: firstName || invitation.dealershipName,
      lastName,
      source: 'dealer_signup',
      consentEmail: true,
      consentText: 'AutoLenis dealer onboarding',
    });
    if (dealerId) {
      await ContactService.linkContactIdentity(crmSupabase, contact.id, 'dealer', dealerId);
    }
  } catch (err) {
    logger.error("[dealer/invite/claim] CRM contact sync failed:", err);
  }

  const res = NextResponse.json({ success: true, redirect: "/dealer/onboarding" });
  res.cookies.set(DEALER_TOKEN_COOKIE, jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}

// GET /api/dealer/invite/claim?token=[token] — validate token and return invitation details
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const validation = await validateInvitationToken(token);
  if (!validation.ok) {
    if (validation.reason === "not_found") {
      return NextResponse.json({ error: "Invalid invitation" }, { status: 404 });
    }
    const message =
      validation.reason === "consumed"
        ? "Invitation already accepted"
        : validation.reason === "cancelled"
          ? "Invitation cancelled"
          : "Invitation expired";
    return NextResponse.json({ error: message, expired: true }, { status: 410 });
  }

  return NextResponse.json({
    success: true,
    data: {
      dealershipName: validation.dealershipName,
      contactName: validation.contactName,
      email: validation.email,
    },
  });
}
