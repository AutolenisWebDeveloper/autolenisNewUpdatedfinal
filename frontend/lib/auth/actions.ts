"use server";

import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UserRole, BuyerPlan, AffiliateStatus } from "@prisma/client";
import { sendWelcomeEmail } from "@/lib/services/email/resend.service";
import { getAppUrl, getSafeBuyerRedirect, getSafePortalRedirect } from "@/lib/auth/urls";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AuthResult {
  error?: string;
  success?: boolean;
  message?: string;
}

// Typed helpers for Supabase admin APIs (not fully typed via @supabase/ssr's
// createBrowserClient at our version — use explicit interface + unknown cast).
interface GenerateLinkResult {
  data: { properties?: { action_link?: string } };
  error?: { message: string } | null;
}
interface GenerateLinkAdmin {
  generateLink(opts: {
    type: string;
    email: string;
    password?: string;
    options?: { redirectTo: string; data?: Record<string, unknown> };
  }): Promise<GenerateLinkResult>;
  updateUserById(
    userId: string,
    attrs: { user_metadata?: Record<string, unknown> },
  ): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
}
function getAdminLinkGenerator(): GenerateLinkAdmin {
  return createServiceSupabaseClient().auth.admin as unknown as GenerateLinkAdmin;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// Ensure Prisma user + buyer record exists for authenticated Supabase user
async function ensurePrismaUser(
  supabaseUserId: string,
  email: string,
  role: UserRole = UserRole.BUYER,
  plan: BuyerPlan = BuyerPlan.STANDARD,
  firstName?: string,
  lastName?: string,
  termsAcceptedAt?: string | null,
  termsVersion?: string | null,
) {
  const existing = await prisma.user.findUnique({ where: { supabaseId: supabaseUserId } });
  if (existing) return existing;

  // ── Upgrade existing guest user in place ──────────────────────────────────
  // /api/public/request-vehicle may have pre-created a User with a
  // `guest_<uuid>` placeholder supabaseId. When the same email signs up for
  // real, replace the placeholder so we don't hit the unique-email constraint.
  const existingByEmail = await prisma.user.findUnique({
    where:   { email: email.toLowerCase() },
    include: { buyer: { select: { id: true, isGuest: true } } },
  });
  if (existingByEmail && existingByEmail.supabaseId.startsWith("guest_")) {
    const upgraded = await prisma.user.update({
      where: { id: existingByEmail.id },
      data:  {
        supabaseId: supabaseUserId,
        role,
        ...(role === UserRole.BUYER && !existingByEmail.buyer ? {
          buyer: {
            create: {
              firstName: firstName ?? email.split("@")[0],
              lastName: lastName ?? "",
              onboardingComplete: false,
              plan,
              termsAcceptedAt: termsAcceptedAt ? new Date(termsAcceptedAt) : null,
              termsVersion: termsVersion ?? null,
            },
          },
        } : {}),
      },
    });
    if (existingByEmail.buyer?.isGuest) {
      await prisma.buyer.update({
        where: { id: existingByEmail.buyer.id },
        data:  {
          isGuest: false,
          ...(termsAcceptedAt ? { termsAcceptedAt: new Date(termsAcceptedAt) } : {}),
          ...(termsVersion ? { termsVersion } : {}),
        },
      }).catch(err => console.error("[ensurePrismaUser] guest buyer flip failed:", err));
    }
    return upgraded;
  }

  const user = await prisma.user.create({
    data: {
      supabaseId: supabaseUserId,
      email: email.toLowerCase(),
      role,
      ...(role === UserRole.BUYER ? {
        buyer: {
          create: {
            firstName: firstName ?? email.split("@")[0],
            lastName: lastName ?? "",
            onboardingComplete: false,
            plan,
            // Consent captured at signup via Supabase user_metadata (Fix C3).
            // Persisted here so the Buyer row reflects the agreement that the
            // user gave on the signup form before the magic link was issued.
            termsAcceptedAt: termsAcceptedAt ? new Date(termsAcceptedAt) : null,
            termsVersion: termsVersion ?? null,
          },
        },
      } : {}),
    },
    include: role === UserRole.BUYER ? { buyer: { select: { id: true } } } : undefined,
  });

  // ── Transfer guest VehicleRequests on signup ─────────────────────────────
  // If the buyer previously submitted a request as a guest, transfer those
  // requests to their new registered account. Non-blocking.
  if (role === UserRole.BUYER) {
    const newBuyerId = (user as { buyer?: { id: string } | null }).buyer?.id;
    if (newBuyerId) {
      prisma.buyer.findFirst({
        where:  { user: { email: email.toLowerCase() }, isGuest: true },
        select: { id: true },
      }).then(async guestBuyer => {
        if (!guestBuyer || guestBuyer.id === newBuyerId) return;
        await Promise.all([
          prisma.vehicleRequest.updateMany({
            where: { buyerId: guestBuyer.id },
            data:  { buyerId: newBuyerId },
          }),
          prisma.buyer.update({
            where: { id: guestBuyer.id },
            data:  { isGuest: false },
          }),
        ]);
      }).catch(err =>
        console.error("[ensurePrismaUser] guest transfer failed:", err)
      );
    }
  }

  // Safety net: if role is AFFILIATE and the affiliate register route's DB
  // transaction failed (race/crash), ensure an Affiliate record exists so the
  // user is not orphaned. The register route pre-creates it; this only fires
  // if it's genuinely missing.
  if (role === UserRole.AFFILIATE) {
    const existingAffiliate = await prisma.affiliate.findFirst({
      where: { userId: user.id },
    });
    if (!existingAffiliate) {
      await prisma.affiliate.create({
        data: {
          userId: user.id,
          status: AffiliateStatus.PENDING,
          referralCode: `AFF-${user.id.slice(0, 8).toUpperCase()}`,
          level: 1,
        },
      }).catch(err =>
        console.error("[ensurePrismaUser] affiliate create failed:", err)
      );
    }
  }

  return user;
}

// Record affiliate attribution when a referred buyer signs up
async function recordAffiliateAttribution(userId: string, referralCode: string) {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { referralCode },
      select: { id: true, userId: true },
    });
    if (!affiliate) return;

    if (affiliate.userId === userId) {
      console.warn(
        `[recordAffiliateAttribution] Self-referral attempt blocked: ` +
        `affiliate ${affiliate.id} tried to refer themselves.`
      );
      return;
    }

    await prisma.affiliateReferral.upsert({
      where: { affiliateId_referredUserId: { affiliateId: affiliate.id, referredUserId: userId } },
      create: {
        affiliateId: affiliate.id,
        referredUserId: userId,
        referralCode,
      },
      update: { referralCode },
    });
  } catch (err) {
    console.error("[recordAffiliateAttribution] failed to record attribution:", err);
    // Non-blocking — do not throw; buyer signup must not fail due to attribution error
  }
}

// ─── Sign Up ───────────────────────────────────────────────────────────────

export async function signUpAction(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.toLowerCase()?.trim();
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string | null;
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const planInput = (formData.get("plan") as string)?.toUpperCase()?.trim();
  const plan: BuyerPlan = planInput === "PREMIUM" ? BuyerPlan.PREMIUM : BuyerPlan.STANDARD;
  const referralCode = (formData.get("referralCode") as string)?.trim() || null;
  const agreeTerms = formData.get("agreeTerms") === "on" || formData.get("agreeTerms") === "true";
  const agreePrivacy = formData.get("agreePrivacy") === "on" || formData.get("agreePrivacy") === "true";
  const redirectParam = getSafeBuyerRedirect((formData.get("redirect") as string)?.trim() || null);

  if (!email || !password || password.length < 8) {
    return { error: "Please enter a valid email and a password of at least 8 characters." };
  }
  if (confirmPassword !== null && confirmPassword !== password) {
    return { error: "Passwords do not match." };
  }
  if (!agreeTerms || !agreePrivacy) {
    return { error: "Please accept the Terms of Service and Privacy Policy." };
  }

  // Surface a clear duplicate-email message on sign-up only — the "never reveal"
  // rule applies to sign-in / forgot-password, not to the registration form
  // where industry standard is to tell the user they already have an account.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return { error: "An account with this email already exists. Sign in instead →" };
  }

  const callbackUrl = new URL(`${getAppUrl()}/auth/callback`);
  if (redirectParam) callbackUrl.searchParams.set("redirect", redirectParam);

  // Generate the Supabase signup link through the admin API so Supabase creates
  // the unconfirmed auth user without sending its default email. We then send
  // the single branded AutoLenis verification email below.
  let verificationUrl: string;
  const { data: linkData, error } = await getAdminLinkGenerator().generateLink({
    type: "signup",
    email,
    password,
    options: {
      redirectTo: callbackUrl.toString(),
      data: {
        firstName,
        lastName,
        role: "BUYER",
        plan,
        referralCode,
        // Consent captured at signup — persisted by callback into Buyer record
        termsAcceptedAt: new Date().toISOString(),
        termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
      },
    },
  });

  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      return { error: "An account with this email already exists. Sign in instead →" };
    }
    console.error("[signUpAction] generateLink failed:", {
      message: error.message,
      status: (error as { status?: number }).status,
      email: email.slice(0, 3) + "***",
    });
    return { error: "Unable to create your account. Please try again." };
  }

  if (!linkData?.properties?.action_link) {
    console.error(
      "[signUpAction] generateLink returned no action_link — check SUPABASE_SERVICE_ROLE_KEY env var",
    );
    return { error: "Account creation failed. Please try again." };
  }

  verificationUrl = linkData.properties.action_link;

  // Send branded welcome / verification email via Resend.
  try {
    await sendWelcomeEmail({ to: email, firstName: firstName ?? email.split("@")[0], verificationUrl });
  } catch (e) {
    // Non-blocking — welcome email failure must never fail sign-up
    console.error("[signUpAction] welcome email failed:", e);
  }

  return { success: true, message: "Check your email to confirm your account." };
}

// ─── Sign In ───────────────────────────────────────────────────────────────

export async function signInAction(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.toLowerCase()?.trim();
  const password = formData.get("password") as string;
  const remember = formData.get("remember") === "1" || formData.get("remember") === "on";
  const redirectParam = getSafePortalRedirect((formData.get("redirect") as string)?.trim() || null);

  if (!email || !password) {
    return { error: "Incorrect email or password" };
  }

  const supabase = await createServerSupabaseClient({ extendedSession: remember });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Incorrect email or password" };
  }

  // Guard: buyer must have verified their email before accessing the portal.
  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    return { error: "verify_required" };
  }

  // Lookup user role for correct portal redirect
  const user = await prisma.user.findUnique({
    where: { supabaseId: data.user.id },
    select: { role: true },
  });

  const role = user?.role ?? (data.user.user_metadata?.role as string | undefined) ?? "BUYER";

  // Affiliate status gate — only ACTIVE affiliates may enter the portal.
  // PENDING / REJECTED / SUSPENDED accounts are signed out and shown a
  // status-specific message before any redirect happens.
  if (role === "AFFILIATE") {
    const affiliate = await prisma.affiliate.findFirst({
      where: { user: { supabaseId: data.user.id } },
      select: { status: true },
    });
    if (!affiliate || affiliate.status !== "ACTIVE") {
      // Tear down the just-issued Supabase session so the cookie cannot be
      // used to access the portal.
      await supabase.auth.signOut();
      switch (affiliate?.status) {
        case "PENDING":
          return { error: "Your application is under review. You'll receive an email once approved." };
        case "REJECTED":
          return { error: "Your application was not approved. Contact support for more information." };
        case "SUSPENDED":
          return { error: "Your account has been suspended. Contact support." };
        default:
          // No affiliate record yet — same enumeration-safe generic error.
          return { error: "Incorrect email or password" };
      }
    }
    redirect("/affiliate/portal/dashboard");
  }
  if (role === "DEALER") redirect("/dealer/dashboard");

  // Default: ensure buyer record exists then send to buyer dashboard
  await ensurePrismaUser(data.user.id, email, UserRole.BUYER);
  redirect(redirectParam ?? "/buyer/dashboard");
}

// ─── Sign Out ─────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();

  // Clear companion cookies set during session
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("al_remember");      // "Remember me" UX preference
  cookieStore.delete("affiliate_ref");    // Affiliate attribution cookie

  redirect("/auth/signin");
}

// ─── Forgot Password ──────────────────────────────────────────────────────

export async function forgotPasswordAction(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.toLowerCase()?.trim();
  // Identical success message whether email exists or not — prevents enumeration
  if (!email) return { success: true, message: "Check your email for password reset instructions." };

  try {
    const redirectTo = `${getAppUrl()}/auth/reset-password`;
    // Use admin generateLink to get the actual recovery URL and send our branded email.
    // This avoids sending two emails (Supabase + ours) for the same request.
    const { data: linkData } = await getAdminLinkGenerator().generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });
    const resetUrl = linkData?.properties?.action_link;
    if (resetUrl) {
      const { sendPasswordResetEmail } = await import("@/lib/services/email/resend.service");
      await sendPasswordResetEmail({ to: email, resetUrl });
    }
  } catch {
    // Intentionally silent — never reveal if email exists
  }

  return { success: true, message: "Check your email for password reset instructions." };
}

// ─── Reset Password ──────────────────────────────────────────────────────

export async function resetPasswordAction(formData: FormData): Promise<AuthResult> {
  const password = formData.get("password") as string;
  const confirm = formData.get("confirmPassword") as string;
  const tokenHash = (formData.get("tokenHash") as string)?.trim();

  if (!password || password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Passwords do not match." };

  if (tokenHash) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return { error: "Failed to reset password. Your link may have expired." };
    }
    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (verifyError || !data.session) {
      return { error: "Failed to reset password. Your link may have expired." };
    }
    const authedClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      },
    );
    const { error } = await authedClient.auth.updateUser({ password });
    if (error) return { error: "Failed to reset password. Your link may have expired." };
  } else {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: "Failed to reset password. Your link may have expired." };
  }

  redirect("/auth/signin?reset=success");
}

// ─── Accept Terms ─────────────────────────────────────────────────────────

export async function acceptTermsAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const now = new Date();
  const termsVersion = process.env.CURRENT_TERMS_VERSION ?? "2026-01-01";

  // 1. Persist to Prisma (source of truth)
  await prisma.buyer.updateMany({
    where: { user: { supabaseId: user.id } },
    data: {
      termsAcceptedAt: now,
      termsVersion,
    },
  });

  // 2. Sync to Supabase user_metadata so the edge middleware can read it
  //    without a Prisma call (edge cannot use Prisma). If this sync fails,
  //    log loudly — the middleware will keep redirecting back to /auth/accept-terms
  //    until the metadata is set, so a silent failure would create a redirect loop.
  const adminClient = getAdminLinkGenerator();
  const { error: metadataError } = await adminClient.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      termsAcceptedAt: now.toISOString(),
      termsVersion,
    },
  });
  if (metadataError) {
    console.error(
      "[acceptTermsAction] failed to sync user_metadata.termsAcceptedAt:",
      metadataError.message,
    );
  }

  // 3. Redirect to original destination, or buyer dashboard
  const redirectTo = getSafeBuyerRedirect(
    (formData.get("redirect") as string)?.trim() || null,
  );
  redirect(redirectTo ?? "/buyer/dashboard");
}

export { ensurePrismaUser, recordAffiliateAttribution };
