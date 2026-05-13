// /api/affiliate/register — full self-serve registration
// 1. Zod-validate form
// 2. Check email uniqueness (Prisma User)
// 3. Create Supabase user via admin API (service role, bypasses rate limits)
// 4. Generate signup verification link via admin API
// 5. Create Prisma User (role = AFFILIATE) + Affiliate in transaction
// 6. Send Resend verification email with signup link
// 7. Return { success: true } — no auto sign-in; user must verify email first

import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { UserRole, AffiliateStatus } from "@prisma/client";
import { sendAffiliateVerificationEmail } from "@/lib/services/email/resend.service";
import crypto from "crypto";

const schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email required"),
  password: z.string()
    .min(12, "Password must be at least 12 characters.")
    .max(128)
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number."
    ),
  website: z.string().url().optional().or(z.literal("")),
  promotionMethod: z.string().min(1, "Promotion method is required"),
  ftcDisclosure: z.literal(true, { errorMap: () => ({ message: "FTC disclosure acknowledgment required" }) }),
  termsAgreed: z.literal(true, { errorMap: () => ({ message: "You must agree to the Affiliate Terms" }) }),
  referralCode: z.string().optional(),
});

// AL + 6 random alphanumeric uppercase chars
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

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON payload", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse("VALIDATION_ERROR", first?.message ?? "Invalid input", 400);
  }

  const { firstName, lastName, email, password, website, promotionMethod, referralCode } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Duplicate email check (platform-wide)
  const existingUser = await prisma.user.findFirst({ where: { email: normalizedEmail } });
  if (existingUser) {
    return errorResponse(
      "EMAIL_EXISTS",
      "An account with this email already exists. Sign in instead.",
      409,
    );
  }

  // 2. Resolve parent referral if provided
  let parentId: string | undefined;
  if (referralCode) {
    const parent = await prisma.affiliate.findFirst({
      where: { referralCode: referralCode.toUpperCase(), status: AffiliateStatus.ACTIVE },
    });
    if (parent) parentId = parent.id;
  }

  // 3. Create Supabase user via admin API (bypasses rate limits)
  //    email_confirm: false → user must click link to verify
  //    bcrypt hashing handled by Supabase internally at cost factor 10+ (secure)
  const admin = adminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: false,
    user_metadata: {
      firstName,
      lastName,
      role: "AFFILIATE",
      website: website || null,
      promotionMethod,
    },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "";
    // eslint-disable-next-line no-console
    console.error("[affiliate/register] Supabase admin createUser failed", { code: createErr?.code, msg });
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return errorResponse(
        "EMAIL_EXISTS",
        "An account with this email already exists. Sign in instead.",
        409,
      );
    }
    return errorResponse("SIGNUP_FAILED", "Something went wrong. Please try again.", 500);
  }

  const supabaseUserId = created.user.id;

  // 4. Generate signup verification link (admin API bypasses rate limits)
  let verificationLink: string | undefined;
  try {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      password,
      options: {
        redirectTo: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/auth/callback?role=AFFILIATE`,
      },
    });
    if (!linkErr && linkData?.properties?.action_link) {
      verificationLink = linkData.properties.action_link;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[affiliate/register] generateLink failed", err);
  }

  // 5. Create Prisma User + Affiliate in a transaction
  let referral: string;
  let unsubscribeToken: string;
  try {
    referral = await uniqueReferralCode();
    unsubscribeToken = crypto.randomBytes(24).toString("hex");

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          supabaseId: supabaseUserId,
          email: normalizedEmail,
          role: UserRole.AFFILIATE,
        },
      });

      await tx.affiliate.create({
        data: {
          userId: user.id,
          referralCode: referral,
          status: AffiliateStatus.ACTIVE, // auto-activate on email verification
          level: parentId ? 2 : 1,
          parentId,
          promotionMethod,
          website: website || null,
          ftcAcknowledgedAt: new Date(),
          unsubscribeToken,
        },
      });
    });
  } catch (err) {
    // Roll back the Supabase user we created
    try {
      await admin.auth.admin.deleteUser(supabaseUserId);
    } catch { /* best-effort cleanup */ }
    // eslint-disable-next-line no-console
    console.error("[affiliate/register] DB transaction failed", err);
    return errorResponse("SIGNUP_FAILED", "Something went wrong. Please try again.", 500);
  }

  // 6. Send verification email via Resend (idempotent)
  try {
    await sendAffiliateVerificationEmail(normalizedEmail, firstName, referral, verificationLink);
  } catch (err) {
    // Non-fatal — user can still use "Resend" flow later
    // eslint-disable-next-line no-console
    console.error("[affiliate/register] Verification email failed", err);
  }

  return successResponse(
    {
      email: normalizedEmail,
      referralCode: referral,
      requiresEmailVerification: true,
    },
    201,
  );
}
