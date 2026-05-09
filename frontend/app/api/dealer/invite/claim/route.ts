// POST /api/dealer/invite/claim — validate invitation token, create User+Dealer, redirect to onboarding

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { UserRole, DealerStatus } from "@prisma/client";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { sendDealerWelcomeEmail } from "@/lib/services/email/resend.service";
import { z } from "zod";

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

  // Find and validate invitation
  const invitation = await prisma.dealerInvitation.findUnique({ where: { token } });
  if (!invitation) return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 });
  if (invitation.status === "ACCEPTED") return NextResponse.json({ error: "Invitation already accepted" }, { status: 409 });
  if (invitation.status === "CANCELLED") return NextResponse.json({ error: "This invitation has been cancelled" }, { status: 410 });
  if (invitation.expiresAt < new Date()) {
    await prisma.dealerInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This invitation has expired. Please request a new one." }, { status: 410 });
  }

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
      await tx.dealerInvitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", acceptedAt: new Date(), dealerId: dealer.id },
      });
    });
  } catch (err) {
    await supabase.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    console.error("[dealer/invite/claim] DB error:", err);
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    await sendDealerWelcomeEmail({ to: invitation.email, contactName: invitation.contactName, dealershipName: invitation.dealershipName, dashboardUrl: `${appUrl}/dealer/dashboard` });
  } catch (err) {
    console.error("[dealer/invite/claim] Welcome email error:", err);
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

  const invitation = await prisma.dealerInvitation.findUnique({ where: { token } });
  if (!invitation) return NextResponse.json({ error: "Invalid invitation" }, { status: 404 });

  if (invitation.status === "ACCEPTED") {
    return NextResponse.json({ error: "Invitation already accepted", expired: true }, { status: 410 });
  }
  if (invitation.status === "CANCELLED") {
    return NextResponse.json({ error: "Invitation cancelled", expired: true }, { status: 410 });
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.dealerInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Invitation expired", expired: true }, { status: 410 });
  }

  return NextResponse.json({
    success: true,
    data: {
      dealershipName: invitation.dealershipName,
      contactName: invitation.contactName,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
}
