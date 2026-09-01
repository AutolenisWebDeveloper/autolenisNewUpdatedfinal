"use server";

import { logger } from "@/lib/logger";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase";
import { headers } from "next/headers";
import { limitAuthAttempt } from "@/lib/security/rate-limit";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UserRole, BuyerPlan, AffiliateStatus } from "@prisma/client";
import { sendWelcomeEmail } from "@/lib/services/email/resend.service";
import { scheduleLifecycleWorkload } from "@/lib/services/crm/lifecycle-scheduler";
import {
  getAppUrl,
  getSafeBuyerRedirect,
  getSafeAffiliateRedirect,
  getSafeDealerRedirect,
} from "@/lib/auth/urls";
import { getCurrentTermsVersion } from "@/lib/auth/terms";

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

// Ensure Prisma user + buyer record exists for authenticated Supabase user.
// M6 — referralCode (from Supabase user_metadata) makes every provisioning
// path record affiliate attribution: before, only the /auth/callback path
// attributed, so a buyer provisioned by the sign-in or accept-terms safety
// nets silently lost their referrer.
async function ensurePrismaUser(
  supabaseUserId: string,
  email: string,
  role: UserRole = UserRole.BUYER,
  plan: BuyerPlan = BuyerPlan.STANDARD,
  firstName?: string,
  lastName?: string,
  termsAcceptedAt?: string | null,
  termsVersion?: string | null,
  referralCode?: string | null,
) {
  const existing = await prisma.user.findUnique({
    where:   { supabaseId: supabaseUserId },
    include: { buyer: { select: { id: true } } },
  });
  if (existing) {
    // A User row with NO Buyer row is the exact half-provisioned state that both
    // self-heal call sites call this function to repair: acceptTermsAction (when
    // its buyer.updateMany matches zero rows) and requireBuyer. Returning
    // `existing` untouched made that heal a NO-OP for the one case it exists to
    // fix — the caller retried its Buyer write, still matched zero rows, and
    // the account was stranded: accepting the terms could never take effect and
    // the buyer could never leave /auth/accept-terms.
    //
    // upsert (Buyer.userId is @unique) so two concurrent heals cannot collide on
    // the unique constraint, and `update: {}` guarantees an existing Buyer is
    // never overwritten — healing must never clobber real buyer data.
    if (role === UserRole.BUYER && !existing.buyer) {
      await prisma.buyer.upsert({
        where:  { userId: existing.id },
        create: {
          userId:             existing.id,
          firstName:          firstName ?? email.split("@")[0],
          lastName:           lastName ?? "",
          onboardingComplete: false,
          plan,
          termsAcceptedAt:    termsAcceptedAt ? new Date(termsAcceptedAt) : null,
          termsVersion:       termsVersion ?? null,
        },
        update: {},
      });
    }
    if (role === UserRole.BUYER && referralCode) {
      // Idempotent (upsert + self-referral guard inside); never throws.
      await recordAffiliateAttribution(existing.id, referralCode);
    }
    return existing;
  }

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
      }).catch(err => logger.error("[ensurePrismaUser] guest buyer flip failed:", err));
    }
    // M6 — a guest-upgraded buyer keeps their referrer too.
    if (role === UserRole.BUYER && referralCode) {
      await recordAffiliateAttribution(upgraded.id, referralCode);
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
      // Lifecycle — enter the buyer welcome + activation-recovery sequence so
      // website signups get the same automation as landing-page submissions.
      // Internal vs QStash is chosen per the form-submitted activation flag.
      scheduleLifecycleWorkload({
        workload: "form_submitted",
        buyerId: newBuyerId,
        firstName: firstName ?? email.split("@")[0],
        email: email.toLowerCase(),
        phone: "",
        campaign: "organic",
      }).catch(() => {});

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
        logger.error("[ensurePrismaUser] guest transfer failed:", err)
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
          // Auto-approved: affiliate accounts never wait for admin approval.
          status: AffiliateStatus.ACTIVE,
          referralCode: `AFF-${user.id.slice(0, 8).toUpperCase()}`,
          level: 1,
        },
      }).catch(err =>
        logger.error("[ensurePrismaUser] affiliate create failed:", err)
      );
    }
  }

  // M6 — record attribution for a freshly-provisioned buyer, whatever path
  // provisioned them. Idempotent and non-throwing.
  if (role === UserRole.BUYER && referralCode) {
    await recordAffiliateAttribution(user.id, referralCode);
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
      logger.warn(
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

    // M14 — mirror the attribution onto the Buyer row (set-if-null:
    // first-touch wins). Buyer.affiliateId was never written by the referral
    // chain, which left the inactive-affiliate cron's buyer-activity signal
    // permanently dead and admin KPIs empty.
    await prisma.buyer.updateMany({
      where: { userId, affiliateId: null },
      data: { affiliateId: affiliate.id },
    });

    // Group 8 (8A) — close the click→conversion loop: mark the most recent
    // unconverted referral click for this code as converted. Non-blocking.
    const { attributeConversion } = await import(
      "@/lib/services/affiliate/referral.service"
    );
    await attributeConversion(referralCode, userId);

    // M9 — award referral milestones at the referral event itself, not only
    // when the referrer happens to open /buyer/referral. Idempotent (unique
    // buyerId+milestone) and best-effort inside this try.
    const referrerBuyer = await prisma.buyer.findUnique({
      where: { userId: affiliate.userId },
      select: { id: true },
    });
    if (referrerBuyer) {
      const { evaluateBuyerReferralMilestones } = await import(
        "@/lib/services/referral/referral-milestone.service"
      );
      await evaluateBuyerReferralMilestones(referrerBuyer.id);
    }
  } catch (err) {
    logger.error("[recordAffiliateAttribution] failed to record attribution:", err);
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
  // M6 — server-side cookie fallback: the client JS copies the affiliate_ref
  // cookie into the form field, but with JS interference or a cleared field the
  // attribution silently dropped. The cookie set by proxy.ts is authoritative
  // when the form carries no code.
  let referralCode = (formData.get("referralCode") as string)?.trim() || null;
  if (!referralCode) {
    const { cookies } = await import("next/headers");
    referralCode = (await cookies()).get("affiliate_ref")?.value?.trim() || null;
  }
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
        termsVersion: getCurrentTermsVersion(),
      },
    },
  });

  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      return { error: "An account with this email already exists. Sign in instead →" };
    }
    logger.error("[signUpAction] generateLink failed:", {
      message: error.message,
      status: (error as { status?: number }).status,
      email: email.slice(0, 3) + "***",
    });
    return { error: "Unable to create your account. Please try again." };
  }

  if (!linkData?.properties?.action_link) {
    logger.error(
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
    logger.error("[signUpAction] welcome email failed:", e);
  }

  return { success: true, message: "Check your email to confirm your account." };
}

// ─── Sign In ───────────────────────────────────────────────────────────────

export async function signInAction(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.toLowerCase()?.trim();
  const password = formData.get("password") as string;
  const remember = formData.get("remember") === "1" || formData.get("remember") === "on";
  // Hold the raw param; we resolve it against the *signed-in role* below so a
  // buyer can never be redirected into /dealer/* or /affiliate/* and vice-versa.
  const rawRedirect = (formData.get("redirect") as string)?.trim() || null;

  if (!email || !password) {
    return { error: "Incorrect email or password" };
  }

  // Brute-force guard, keyed by source IP and by target account. Fails OPEN
  // on limiter-store outage (sign-in must never be blocked by our own infra).
  {
    const hdrs = await headers();
    const ip = (hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()) || hdrs.get("x-real-ip") || "unknown";
    for (const key of [`signin:portal:ip:${ip}`, `signin:portal:email:${email}`]) {
      const rl = await limitAuthAttempt(key);
      if (!rl.ok) return { error: rl.message };
    }
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

  // Affiliate status gate. R6/decision 1 — the activation model is
  // auto-ACTIVE on email verification, and requireAffiliate() deliberately
  // permits PENDING (safety-net-provisioned accounts): blocking PENDING here
  // locked those accounts out entirely while the server gates would have let
  // them in. Only REJECTED/SUSPENDED are refused; both are also enforced
  // server-side on every page and API call.
  if (role === "AFFILIATE") {
    const affiliate = await prisma.affiliate.findFirst({
      where: { user: { supabaseId: data.user.id } },
      select: { status: true },
    });
    if (!affiliate || affiliate.status === "REJECTED" || affiliate.status === "SUSPENDED") {
      // Tear down the just-issued Supabase session so the cookie cannot be
      // used to access the portal.
      await supabase.auth.signOut();
      switch (affiliate?.status) {
        case "REJECTED":
          return { error: "Your application was not approved. Contact support for more information." };
        case "SUSPENDED":
          return { error: "Your account has been suspended. Contact support." };
        default:
          // No affiliate record yet — same enumeration-safe generic error.
          return { error: "Incorrect email or password" };
      }
    }
    redirect(getSafeAffiliateRedirect(rawRedirect) ?? "/affiliate/portal/dashboard");
  }
  if (role === "DEALER") {
    redirect(getSafeDealerRedirect(rawRedirect) ?? "/dealer/dashboard");
  }

  // Default: ensure buyer record exists then send to buyer dashboard.
  // M6 — pass the signup referral code so safety-net provisioning attributes.
  await ensurePrismaUser(
    data.user.id,
    email,
    UserRole.BUYER,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (data.user.user_metadata?.referralCode as string | undefined) ?? null,
  );
  redirect(getSafeBuyerRedirect(rawRedirect) ?? "/buyer/dashboard");
}

// ─── Sign Out ─────────────────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();

  // R13 — land each role on ITS sign-in page: affiliates were dumped on the
  // buyer-branded /auth/signin. Read the role before tearing the session down.
  let signInTarget = "/auth/signin";
  try {
    const { data } = await supabase.auth.getUser();
    if ((data?.user?.user_metadata?.role as string | undefined) === "AFFILIATE") {
      signInTarget = "/affiliate/signin";
    }
  } catch { /* default target */ }

  await supabase.auth.signOut();

  // Clear companion cookies set during session
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("al_remember");      // "Remember me" UX preference
  cookieStore.delete("affiliate_ref");    // Affiliate attribution cookie

  redirect(signInTarget);
}

// ─── Forgot Password ──────────────────────────────────────────────────────

export async function forgotPasswordAction(formData: FormData): Promise<AuthResult> {
  const email = (formData.get("email") as string)?.toLowerCase()?.trim();
  // Identical success message whether email exists or not — prevents enumeration
  if (!email) return { success: true, message: "Check your email for password reset instructions." };

  // Throttle reset-email sends per IP + target address (email-bombing guard).
  // Fails OPEN; the enumeration-safe success message doubles as the 429 shape.
  {
    const hdrs = await headers();
    const ip = (hdrs.get("x-forwarded-for")?.split(",")[0]?.trim()) || hdrs.get("x-real-ip") || "unknown";
    for (const key of [`reset:ip:${ip}`, `reset:email:${email}`]) {
      const rl = await limitAuthAttempt(key, { tokens: 5, window: "10 m" });
      if (!rl.ok) return { success: true, message: "Check your email for password reset instructions." };
    }
  }

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

  // Capture the email so we can route post-reset to the role-correct dashboard.
  let resetEmail: string | null = null;

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
    resetEmail = data.user?.email ?? null;
  } else {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: "Failed to reset password. Your link may have expired." };
    resetEmail = user?.email ?? null;
  }

  // Establish a real cookie session with the new password so the buyer is
  // signed in directly into their dashboard — no detour through /auth/signin.
  if (resetEmail) {
    const cookieClient = await createServerSupabaseClient();
    const { data: signInData, error: signInError } = await cookieClient.auth.signInWithPassword({
      email: resetEmail,
      password,
    });
    if (!signInError && signInData.user) {
      const dbUser = await prisma.user.findUnique({
        where: { supabaseId: signInData.user.id },
        select: { role: true },
      });
      const role = dbUser?.role ?? (signInData.user.user_metadata?.role as string | undefined) ?? "BUYER";
      if (role === "AFFILIATE") redirect("/affiliate/portal/dashboard");
      if (role === "DEALER") redirect("/dealer/dashboard");
      redirect("/buyer/dashboard");
    }
  }

  // Fallback if we could not establish a session — direct the user to sign in.
  redirect("/auth/signin?reset=success");
}

// ─── Accept Terms ─────────────────────────────────────────────────────────

export async function acceptTermsAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/signin");

  const now = new Date();
  const termsVersion = getCurrentTermsVersion();
  const requestedRedirect = (formData.get("redirect") as string)?.trim() || null;

  // Acceptance is a TWO-STORE write: Prisma (the source of truth the buyer
  // layout reads) and Supabase user_metadata (what the edge gate reads, since
  // the edge cannot call Prisma). Both gates bounce an unaccepted buyer back
  // here, so a HALF-applied acceptance is a permanent redirect loop with
  // nothing shown to the buyer. Every failure below therefore returns the buyer
  // to this page with an actionable error instead of into the loop.
  //
  // /auth/accept-terms is deliberately NOT in proxy.ts's AUTH_ROUTES, so
  // redirecting back here does not itself bounce.
  const failTo = (code: string): never => {
    const params = new URLSearchParams({ error: code });
    if (requestedRedirect) params.set("redirect", requestedRedirect);
    redirect(`/auth/accept-terms?${params.toString()}`);
  };

  // 1. Persist to Prisma (source of truth).
  //
  // updateMany matches 0 rows when the authenticated Supabase user has no
  // Prisma Buyer — an account whose auth-callback provisioning did not
  // complete. Discarding that count is what stranded such accounts: the write
  // "succeeded", the layout still saw termsAcceptedAt = null, and the buyer
  // looped forever. Heal it through the same provisioning path signup uses,
  // then retry once, and fail loudly if it still does not apply.
  let persisted = await prisma.buyer.updateMany({
    where: { user: { supabaseId: user.id } },
    data: { termsAcceptedAt: now, termsVersion },
  });

  if (persisted.count === 0) {
    const role = (user.user_metadata?.role as string | undefined) ?? "BUYER";
    if (role !== "BUYER") {
      logger.error(
        "[acceptTermsAction] no Buyer row for non-BUYER user; refusing to provision one",
        { supabaseId: user.id, role },
      );
      failTo("NO_BUYER_PROFILE");
    }
    if (!user.email) {
      logger.error("[acceptTermsAction] authenticated user has no email; cannot provision buyer", {
        supabaseId: user.id,
      });
      failTo("NO_BUYER_PROFILE");
    }
    try {
      await ensurePrismaUser(
        user.id,
        user.email as string,
        UserRole.BUYER,
        (user.user_metadata?.plan as BuyerPlan | undefined) ?? BuyerPlan.STANDARD,
        user.user_metadata?.firstName as string | undefined,
        user.user_metadata?.lastName as string | undefined,
        now.toISOString(),
        termsVersion,
        // M6 — safety-net provisioning must not lose the referrer.
        (user.user_metadata?.referralCode as string | undefined) ?? null,
      );
    } catch (err) {
      logger.error("[acceptTermsAction] buyer provisioning failed:", err);
      failTo("NO_BUYER_PROFILE");
    }
    persisted = await prisma.buyer.updateMany({
      where: { user: { supabaseId: user.id } },
      data: { termsAcceptedAt: now, termsVersion },
    });
    if (persisted.count === 0) {
      logger.error(
        "[acceptTermsAction] acceptance did not apply after provisioning — buyer would loop",
        { supabaseId: user.id },
      );
      failTo("NO_BUYER_PROFILE");
    }
  }

  // 2. Sync to Supabase user_metadata so the edge gate agrees with Prisma.
  //    A failure here leaves the edge gate still bouncing /buyer/* back to this
  //    page, so it must NOT be swallowed — surface it and let the buyer retry.
  const adminClient = getAdminLinkGenerator();
  const { error: metadataError } = await adminClient.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      termsAcceptedAt: now.toISOString(),
      termsVersion,
    },
  });
  if (metadataError) {
    logger.error(
      "[acceptTermsAction] failed to sync user_metadata.termsAcceptedAt:",
      metadataError.message,
    );
    failTo("SYNC_FAILED");
  }

  // 3. Both stores agree — redirect to original destination, or buyer dashboard
  redirect(getSafeBuyerRedirect(requestedRedirect) ?? "/buyer/dashboard");
}

export { ensurePrismaUser, recordAffiliateAttribution };
