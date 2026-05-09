// POST /api/admin/users/create — create a user directly (bypass public signup)
// Supports userType: BUYER | DEALER | AFFILIATE

import { NextRequest, NextResponse } from "next/server";
import { getAdminWithRole, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { UserRole, BuyerPlan, DealerStatus, AffiliateStatus } from "@prisma/client";
import { z } from "zod";
import crypto from "crypto";
import {
  sendAdminCreatedBuyerEmail,
  sendAdminCreatedDealerEmail,
  sendAdminCreatedAffiliateEmail,
} from "@/lib/services/email/resend.service";

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const baseSchema = z.object({
  userType: z.enum(["BUYER", "DEALER", "AFFILIATE"]),
  email: z.string().email(),
  temporaryPassword: z.string().min(8),
});

const buyerSchema = baseSchema.extend({
  userType: z.literal("BUYER"),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  plan: z.enum(["STANDARD", "PREMIUM"]).default("STANDARD"),
});

const dealerSchema = baseSchema.extend({
  userType: z.literal("DEALER"),
  businessName: z.string().min(1),
  contactName: z.string().min(1),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
  state: z.string().length(2).optional(),
});

const affiliateSchema = baseSchema.extend({
  userType: z.literal("AFFILIATE"),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  promotionMethod: z.string().optional(),
});

const schema = z.discriminatedUnion("userType", [buyerSchema, dealerSchema, affiliateSchema]);

function generateReferralCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(6);
  let code = "AL";
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode();
    const existing = await prisma.affiliate.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique referral code");
}

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "OPERATIONS_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const data = parsed.data;
  const normalizedEmail = data.email.toLowerCase().trim();

  // Check email uniqueness
  const existing = await prisma.user.findFirst({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const supabase = adminSupabase();
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password: data.temporaryPassword,
    email_confirm: true,
    user_metadata: { role: data.userType, createdByAdmin: true },
  });

  if (authErr || !created?.user) {
    return NextResponse.json({ error: "Failed to create auth account" }, { status: 500 });
  }

  const supabaseUserId = created.user.id;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  try {
    if (data.userType === "BUYER") {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: normalizedEmail,
            role: UserRole.BUYER,
            requiresPasswordChange: true,
          },
        });
        await tx.buyer.create({
          data: {
            userId: user.id,
            firstName: data.firstName,
            lastName: data.lastName,
            plan: data.plan === "PREMIUM" ? BuyerPlan.PREMIUM : BuyerPlan.STANDARD,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.adminId,
            adminEmail: admin.email,
            action: "ADMIN_USER_CREATED",
            entityType: "User",
            entityId: user.id,
            reason: `Admin created buyer: ${normalizedEmail}`,
          },
        });
      });
      await sendAdminCreatedBuyerEmail(normalizedEmail, data.firstName, data.temporaryPassword, `${appUrl}/auth/signin`);

    } else if (data.userType === "DEALER") {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: normalizedEmail,
            role: UserRole.DEALER,
            requiresPasswordChange: true,
          },
        });
        await tx.dealer.create({
          data: {
            userId: user.id,
            dealershipName: data.businessName,
            phone: data.phone ?? null,
            state: data.state ?? null,
            licenseNumber: data.licenseNumber ?? null,
            status: DealerStatus.ACTIVE,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.adminId,
            adminEmail: admin.email,
            action: "ADMIN_USER_CREATED",
            entityType: "User",
            entityId: user.id,
            reason: `Admin created dealer: ${normalizedEmail}`,
          },
        });
      });
      await sendAdminCreatedDealerEmail(normalizedEmail, data.contactName, data.temporaryPassword, `${appUrl}/dealer/signin`);

    } else if (data.userType === "AFFILIATE") {
      const referralCode = await uniqueReferralCode();
      const unsubscribeToken = crypto.randomBytes(24).toString("hex");
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: normalizedEmail,
            role: UserRole.AFFILIATE,
            requiresPasswordChange: true,
          },
        });
        await tx.affiliate.create({
          data: {
            userId: user.id,
            referralCode,
            status: AffiliateStatus.ACTIVE,
            level: 1,
            promotionMethod: data.promotionMethod ?? null,
            unsubscribeToken,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.adminId,
            adminEmail: admin.email,
            action: "ADMIN_USER_CREATED",
            entityType: "User",
            entityId: user.id,
            reason: `Admin created affiliate: ${normalizedEmail}`,
          },
        });
      });
      await sendAdminCreatedAffiliateEmail(normalizedEmail, data.firstName, referralCode, data.temporaryPassword, `${appUrl}/auth/signin`);
    }
  } catch (err) {
    await supabase.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    console.error("[admin/users/create] DB error:", err);
    return NextResponse.json({ error: "Database error while creating user" }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: `${data.userType} account created successfully` }, { status: 201 });
}
