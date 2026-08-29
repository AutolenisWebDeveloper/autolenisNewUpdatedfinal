// /api/affiliate/register — full self-serve registration
// 1. Zod-validate form
// 2. Check email uniqueness (Prisma User)
// 3. Create Supabase user via admin API (service role, bypasses rate limits)
// 4. Generate signup verification link via admin API
// 5. Create Prisma User (role = AFFILIATE) + Affiliate in transaction
// 6. Send Resend verification email with signup link
// 7. Return { success: true } — no auto sign-in; user must verify email first

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/auth/api";
import { limitAuthAttempt, clientIpKey } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/prisma";
import { UserRole, AffiliateStatus } from "@prisma/client";
import { sendAffiliateVerificationEmail } from "@/lib/services/email/resend.service";
import { ContactService } from "@/lib/services/contact.service";
import { getServiceSupabase } from "@/lib/supabase-service";
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

// Service-role client comes from the shared adapter (lib/supabase-service) —
// this route previously built its own duplicate client from the raw SDK.

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

  // R4 — this is an unauthenticated route that mints service-role Supabase
  // users and sends email; without a throttle, sybil registration and email
  // flooding are free. Keyed by BOTH source IP and target email, same tiers
  // as the buyer auth actions. (The duplicate-email 409 below intentionally
  // matches the buyer signup convention of naming an existing account on the
  // REGISTRATION form; the throttle is what blunts enumeration at scale.)
  const ipKey = clientIpKey(request.headers);
  const [ipLimit, emailLimit] = await Promise.all([
    limitAuthAttempt(`affiliate-register:ip:${ipKey}`),
    limitAuthAttempt(`affiliate-register:email:${normalizedEmail}`, { tokens: 5, window: "10 m" }),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    return errorResponse("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.", 429);
  }

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
  let parentLevel = 0;
  if (referralCode) {
    const parent = await prisma.affiliate.findFirst({
      where: { referralCode: referralCode.toUpperCase(), status: AffiliateStatus.ACTIVE },
    });
    if (parent) {
      parentId = parent.id;
      parentLevel = parent.level;
    }
  }

  // 3. Create Supabase user via admin API (bypasses rate limits)
  //    email_confirm: false → user must click link to verify
  //    bcrypt hashing handled by Supabase internally at cost factor 10+ (secure)
  const admin = getServiceSupabase();
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
    logger.error("[affiliate/register] Supabase admin createUser failed", { code: createErr?.code, msg });
    if (/already|registered|exists|duplicate/i.test(msg)) {
      // O8 — we only reach Supabase after confirming no Prisma user holds this
      // email, so a Supabase duplicate here means an ORPHANED auth user (a
      // prior registration crashed between createUser and the DB transaction).
      // "Sign in instead" would dead-end them — sign-in has no account row.
      return errorResponse(
        "EMAIL_ORPHANED",
        "This email is attached to an incomplete registration. Contact support@autolenis.com and we'll reset it for you.",
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
    logger.error("[affiliate/register] generateLink failed", err);
  }

  // O2 — without a link there is NO way to verify: Supabase sends no email of
  // its own (email_confirm:false is the point of the admin API), and the old
  // fallback email told the user to find one that doesn't exist. Fail loudly
  // and roll the Supabase user back so the email stays reusable.
  if (!verificationLink) {
    try {
      await admin.auth.admin.deleteUser(supabaseUserId);
    } catch { /* best-effort cleanup */ }
    return errorResponse(
      "VERIFICATION_UNAVAILABLE",
      "We couldn't issue your verification email right now. Nothing was created — please try again in a few minutes.",
      503,
    );
  }

  // 5. Create Prisma User + Affiliate in a transaction.
  // O9 — the referral-code uniqueness check is check-then-insert; the @unique
  // constraint makes a collision safe but it used to abort the whole signup
  // with a 500. On a referral-code P2002 we regenerate and retry once instead.
  let referral = "";
  let unsubscribeToken: string;
  let affiliateId = "";
  try {
    unsubscribeToken = crypto.randomBytes(24).toString("hex");

    for (let attempt = 0; attempt < 2; attempt++) {
      referral = await uniqueReferralCode();
      try {
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              supabaseId: supabaseUserId,
              email: normalizedEmail,
              role: UserRole.AFFILIATE,
            },
          });

          const affiliate = await tx.affiliate.create({
            data: {
              userId: user.id,
              referralCode: referral,
              status: AffiliateStatus.ACTIVE, // auto-activate on email verification
              // R10/O7 — a recruit sits at the parent's depth + 1 (capped at 3;
              // the commission walk pays at most 3 ancestor levels regardless).
              level: parentId ? Math.min(parentLevel + 1, 3) : 1,
              parentId,
              promotionMethod,
              website: website || null,
              ftcAcknowledgedAt: new Date(),
              unsubscribeToken,
            },
          });
          affiliateId = affiliate.id;
        });
        break;
      } catch (err) {
        const isReferralCollision =
          (err as { code?: string })?.code === "P2002" &&
          JSON.stringify((err as { meta?: unknown })?.meta ?? "").includes("referral");
        if (isReferralCollision && attempt === 0) continue;
        throw err;
      }
    }
  } catch (err) {
    // Roll back the Supabase user we created
    try {
      await admin.auth.admin.deleteUser(supabaseUserId);
    } catch { /* best-effort cleanup */ }
    logger.error("[affiliate/register] DB transaction failed", err);
    return errorResponse("SIGNUP_FAILED", "Something went wrong. Please try again.", 500);
  }

  // 6. Send verification email via Resend (idempotent)
  try {
    await sendAffiliateVerificationEmail(normalizedEmail, firstName, referral, verificationLink);
  } catch (err) {
    // Non-fatal — user can still use "Resend" flow later
    logger.error("[affiliate/register] Verification email failed", err);
  }

  // 7. Sync into CRM contacts (non-fatal — signup completes even if this fails)
  try {
    const crmSupabase = getServiceSupabase();
    const contact = await ContactService.upsertContact(crmSupabase, {
      email: normalizedEmail,
      firstName,
      lastName,
      source: 'affiliate_signup',
      consentEmail: true,
      consentText: 'AutoLenis affiliate registration',
    });
    if (affiliateId) {
      await ContactService.linkContactIdentity(crmSupabase, contact.id, 'affiliate', affiliateId);
    }

    // Emit the affiliate_signup domain event → Make.com orchestration (+ legacy
    // in-app engine behind the cutover flag). Best-effort; never blocks signup.
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent('affiliate_signup', {
      domainEntityId: affiliateId,
      supabase: crmSupabase,
      contact: {
        email: normalizedEmail,
        firstName,
        lastName,
        source: 'affiliate_signup',
        consentEmail: true,
        consentText: 'AutoLenis affiliate registration',
      },
      data: { affiliate_id: affiliateId, referral_code: referral },
    });
  } catch (err) {
    logger.error("[affiliate/register] CRM contact sync failed", err);
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
