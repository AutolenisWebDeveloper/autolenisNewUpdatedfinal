// POST /api/admin/dealers/applications/[appId]/approve
// Creates Supabase user + User + Dealer records, then emails a secure single-use
// account-claim link. NO plaintext password is ever generated, stored, returned,
// or emailed — the dealer sets their own password via /dealer/claim (WO-2).

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { UserRole, DealerStatus } from "@prisma/client";
import { sendDealerApplicationApprovedEmail } from "@/lib/services/email/resend.service";
import { issueClaimToken } from "@/lib/services/dealer-recruitment/account-claim.service";
import crypto from "crypto";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

interface RouteContext { params: Promise<{ appId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const { appId } = await params;

  const app = await prisma.dealerApplication.findUnique({ where: { id: appId } });
  if (!app) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  if (app.status !== "PENDING") return NextResponse.json({ error: "Application already reviewed" }, { status: 409 });

  const supabase = adminClient();

  // Create the Supabase user with a random, UNSTORED password. Nobody — not even
  // us — knows it; the dealer establishes their real password through the claim
  // flow. This is intentionally a throwaway value, never persisted or returned.
  const unstoredPassword = crypto.randomBytes(24).toString("base64url");
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: app.contactEmail.toLowerCase(),
    password: unstoredPassword,
    email_confirm: true,
    user_metadata: { role: "DEALER", dealershipName: app.dealershipName },
  });

  if (authErr || !created?.user) {
    const msg = authErr?.message ?? "";
    if (/already|exists|duplicate/i.test(msg)) {
      // User might already exist — find them
      const existing = await prisma.user.findFirst({ where: { email: app.contactEmail.toLowerCase() } });
      if (existing) {
        await prisma.dealerApplication.update({
          where: { id: appId },
          data: { status: "APPROVED", reviewedBy: admin.adminId, reviewedAt: new Date() },
        });
        return NextResponse.json({ success: true, note: "User already existed" });
      }
    }
    return NextResponse.json({ error: "Failed to create user account" }, { status: 500 });
  }

  const supabaseUserId = created.user.id;

  let dealerId = "";
  try {
    let dealer: { id: string };
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          supabaseId: supabaseUserId,
          email: app.contactEmail.toLowerCase(),
          role: UserRole.DEALER,
          requiresPasswordChange: true,
        },
      });
      dealer = await tx.dealer.create({
        data: {
          userId: user.id,
          dealershipName: app.dealershipName,
          city: app.city,
          state: app.state,
          zip: app.zip,
          licenseNumber: app.licenseNumber,
          status: DealerStatus.PENDING, // dealer must complete onboarding to become ACTIVE
        },
      });
      await tx.dealerApplication.update({
        where: { id: appId },
        data: {
          status: "APPROVED",
          reviewedBy: admin.adminId,
          reviewedAt: new Date(),
          dealerId: dealer.id,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "STATUS_CHANGE",
          entityType: "DealerApplication",
          entityId: appId,
          reason: "Application approved",
          metadata: { dealerId: dealer.id },
        },
      });
    });
    dealerId = dealer!.id;
  } catch (err) {
    await supabase.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    console.error("[dealer/applications/approve] DB error:", err);
    return NextResponse.json({ error: "Database error during approval" }, { status: 500 });
  }

  // Mint a secure single-use claim token (hashed at rest, 7-day expiry) and email
  // the claim link. If token issuance fails we still report success (the account
  // exists) — an admin can re-issue from the dealer record.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  try {
    const { rawToken, expiresAt } = await issueClaimToken({
      dealerId,
      applicationId: appId,
      createdByAdminId: admin.adminId,
    });

    await sendDealerApplicationApprovedEmail({
      to: app.contactEmail,
      contactName: app.contactName,
      dealershipName: app.dealershipName,
      claimUrl: `${appUrl}/dealer/claim?token=${rawToken}`,
      expiresAt: expiresAt.toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      }),
    });
  } catch (err) {
    console.error("[dealer/applications/approve] Claim token / email error:", err);
  }

  return NextResponse.json({
    success: true,
    message: "Application approved — secure account-claim link emailed to the dealer",
  });
}
