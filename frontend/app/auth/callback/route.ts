import { logger } from "@/lib/logger";
import { createServerSupabaseClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import { ensurePrismaUser, recordAffiliateAttribution } from "@/lib/auth/actions";
import { getSafeBuyerRedirect } from "@/lib/auth/urls";
import { UserRole, BuyerPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ContactService } from "@/lib/services/contact.service";
import { getServiceSupabase } from "@/lib/supabase-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // The `role` param is set by the affiliate registration flow in the redirectTo URL.
  const roleParam = searchParams.get("role");
  const isAffiliate = roleParam === "AFFILIATE";
  const defaultNext = isAffiliate ? "/affiliate/portal/dashboard" : "/buyer/dashboard";
  const buyerNext = getSafeBuyerRedirect(searchParams.get("next") ?? searchParams.get("redirect"));
  const next = isAffiliate ? defaultNext : buyerNext ?? defaultNext;

  const supabase = await createServerSupabaseClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const meta = data.user.user_metadata ?? {};
      const resolvedRole =
        isAffiliate || meta.role === "AFFILIATE" ? UserRole.AFFILIATE : UserRole.BUYER;
      const plan: BuyerPlan =
        meta.plan === "PREMIUM" ? BuyerPlan.PREMIUM : BuyerPlan.STANDARD;
      const user = await ensurePrismaUser(
        data.user.id,
        data.user.email!,
        resolvedRole,
        plan,
        meta.firstName as string | undefined,
        meta.lastName as string | undefined,
        (meta.termsAcceptedAt as string | undefined) ?? null,
        (meta.termsVersion as string | undefined) ?? null,
      );
      if (resolvedRole === UserRole.BUYER && typeof meta.referralCode === "string" && meta.referralCode) {
        await recordAffiliateAttribution(user.id, meta.referralCode);
      }
      if (resolvedRole === UserRole.BUYER) {
        await trySendEmailVerified(data.user.id, data.user.email!);
        await syncBuyerContact(user.id, data.user.email!, meta);
      }
      // Fallback: if the role param was missing, check the actual DB role so
      // affiliates always land on their portal rather than the buyer dashboard.
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });
      const finalRedirect =
        dbUser?.role === "AFFILIATE"
          ? "/affiliate/portal/dashboard"
          : dbUser?.role === "SUPER_ADMIN"
            ? "/admin/dashboard"
            : next;
      return NextResponse.redirect(new URL(finalRedirect, request.url));
    }
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type: type as "email" | "recovery" | "invite" | "email_change",
      token_hash,
    });
    if (!error && data.user) {
      const meta = data.user.user_metadata ?? {};
      const resolvedRole =
        isAffiliate || meta.role === "AFFILIATE" ? UserRole.AFFILIATE : UserRole.BUYER;
      const plan: BuyerPlan =
        meta.plan === "PREMIUM" ? BuyerPlan.PREMIUM : BuyerPlan.STANDARD;
      const user = await ensurePrismaUser(
        data.user.id,
        data.user.email!,
        resolvedRole,
        plan,
        meta.firstName as string | undefined,
        meta.lastName as string | undefined,
        (meta.termsAcceptedAt as string | undefined) ?? null,
        (meta.termsVersion as string | undefined) ?? null,
      );
      if (resolvedRole === UserRole.BUYER && typeof meta.referralCode === "string" && meta.referralCode) {
        await recordAffiliateAttribution(user.id, meta.referralCode);
      }
      if ((type === "email" || type === "signup" || type === "magiclink") && resolvedRole === UserRole.BUYER) {
        await trySendEmailVerified(data.user.id, data.user.email!);
        await syncBuyerContact(user.id, data.user.email!, meta);
      }
      // Fallback: check DB role in case role param was absent from the redirect URL.
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true },
      });
      const finalRedirect =
        dbUser?.role === "AFFILIATE"
          ? "/affiliate/portal/dashboard"
          : dbUser?.role === "SUPER_ADMIN"
            ? "/admin/dashboard"
            : next;
      return NextResponse.redirect(new URL(finalRedirect, request.url));
    }
  }

  return NextResponse.redirect(new URL("/auth/signin?error=callback_failed", request.url));
}

// Sync the newly verified buyer into the CRM contacts table. Idempotent —
// upsertContact dedupes by email and linkContactIdentity has a unique constraint
// on (entity_type, entity_id). Best-effort: never blocks the redirect.
async function syncBuyerContact(
  userId: string,
  email: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const buyer = await prisma.buyer.findFirst({
      where: { userId },
      select: { id: true, firstName: true, lastName: true, phone: true },
    });
    if (!buyer) return;

    const crmSupabase = getServiceSupabase();
    const contact = await ContactService.upsertContact(crmSupabase, {
      email,
      phone: buyer.phone ?? null,
      firstName: buyer.firstName ?? (meta.firstName as string | undefined),
      lastName: buyer.lastName ?? (meta.lastName as string | undefined),
      source: 'buyer_signup',
      consentEmail: true,
      consentText: 'AutoLenis buyer registration',
    });
    await ContactService.linkContactIdentity(crmSupabase, contact.id, 'buyer', buyer.id);

    // Emit the buyer_signup domain event → Make.com orchestration (+ legacy
    // in-app engine behind the cutover flag). Best-effort; never blocks signup.
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent('buyer_signup', {
      domainEntityId: buyer.id,
      supabase: crmSupabase,
      contact: {
        email,
        phone: buyer.phone ?? null,
        firstName: buyer.firstName ?? (meta.firstName as string | undefined),
        lastName: buyer.lastName ?? (meta.lastName as string | undefined),
        source: 'buyer_signup',
        consentEmail: true,
        consentText: 'AutoLenis buyer registration',
      },
      data: { buyer_id: buyer.id },
    });
  } catch (err) {
    logger.error("[auth/callback] CRM contact sync failed:", err);
  }
}

// Idempotent: sends the "email verified" confirmation email only once per buyer.
// Uses AdminAuditLog as a deduplication record to prevent duplicate sends on
// repeated callback visits (e.g. buyer clicks verification link twice).
async function trySendEmailVerified(supabaseId: string, email: string): Promise<void> {
  try {
    const buyer = await prisma.buyer.findFirst({
      where: { user: { supabaseId } },
      select: { id: true, firstName: true },
    });
    if (!buyer) return;

    // Check if we already sent the verified email for this buyer
    const alreadySent = await prisma.adminAuditLog.findFirst({
      where: {
        action: "EMAIL_VERIFIED_SENT",
        entityType: "BUYER",
        entityId: buyer.id,
      },
    });
    if (alreadySent) return;

    const firstName = buyer.firstName ?? email.split("@")[0];

    // §27.1 "Verification completed → Buyer" — PHASE 10, MIGRATED OFF THE DIRECT RAIL.
    //
    // TWO GUARDS, AND NEITHER IS THE OTHER'S SPARE. The `AdminAuditLog` row above is written
    // after a successful ENQUEUE — not after a successful send, which is what an earlier
    // version of this comment claimed and the second independent review corrected. So a
    // message the outbox later terminal-fails leaves the audit row present and the next
    // callback visit a no-op; the outbox's own terminal-failure exception is what covers that
    // case, not a retry from here. The outbox key covers what the audit row cannot: two
    // callback visits racing before either has written it.
    const { enqueueTransactional } = await import("@/lib/services/comms/transactional-dispatcher.service");
    const { PHASE_2_TEMPLATES } = await import("@/lib/services/comms/state-recheck-registry");
    const { EMAIL_VERIFIED_SUBJECT, renderEmailVerifiedEmail } = await import(
      "@/lib/services/email/templates/email-verified"
    );
    const { renderOnboardingIncomplete } = await import("@/lib/services/comms/phase2-email-content");
    await enqueueTransactional({
      triggerEvent: "auth.verification_completed",
      templateKey: PHASE_2_TEMPLATES.VERIFICATION_COMPLETED,
      channel: "email",
      recipientKind: "buyer",
      recipientId: buyer.id,
      to: email,
      idempotencyKey: `${PHASE_2_TEMPLATES.VERIFICATION_COMPLETED}:${buyer.id}`,
      payload: {
        email,
        subject: EMAIL_VERIFIED_SUBJECT(firstName),
        html: renderEmailVerifiedEmail({
          firstName,
          // The same URL `sendEmailVerifiedEmail` built (`resend.service.ts:984`), read from
          // the same variable rather than re-derived, so the link does not change with the rail.
          prequalUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/prequal`,
        }),
      },
    });

    // §27.1 "Onboarding incomplete → Buyer" — PHASE 10, the enqueue site this register row
    // never had. `skipIfOnboardingComplete` was registered in Phase 2 and nothing ever
    // produced a row for it to check.
    //
    // ONE NUDGE, NOT A SEQUENCE. §27.1 registers a single key, and the buyer has just proved
    // they read their email — a person who verifies and then stops has made a decision, and
    // chasing it three times is how a transactional rail turns into a drip campaign.
    //
    // Scheduled a day out and re-checked at send: the ordinary path is that the buyer
    // completes onboarding in the next few minutes, `skipIfOnboardingComplete` sees it, and
    // this row is never sent. It exists for the person who does not.
    //
    // Enqueued in the same block as the verification notice and guarded by the same audit
    // row, so a repeated callback visit cannot schedule a second one.
    await enqueueTransactional({
      triggerEvent: "auth.onboarding_incomplete",
      templateKey: PHASE_2_TEMPLATES.ONBOARDING_INCOMPLETE,
      channel: "email",
      recipientKind: "buyer",
      recipientId: buyer.id,
      to: email,
      idempotencyKey: `${PHASE_2_TEMPLATES.ONBOARDING_INCOMPLETE}:${buyer.id}`,
      runAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      payload: {
        email,
        ...renderOnboardingIncomplete({
          firstName,
          onboardingUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()}/buyer/onboarding`,
        }),
      },
    }).catch((err) => {
      // The verification notice above is the one this visit owes; a nudge that could not be
      // scheduled must not cost it, and must not stop the audit row being written.
      logger.error("[auth/callback] onboarding nudge not scheduled:", err);
    });

    // Record the send so future callback visits are no-ops
    await prisma.adminAuditLog.create({
      data: {
        action: "EMAIL_VERIFIED_SENT",
        entityType: "BUYER",
        entityId: buyer.id,
        adminId: "system",
        adminEmail: "system@autolenis.com",
        metadata: { email, sentAt: new Date().toISOString() },
      },
    }).catch(() => {});
  } catch (e) {
    logger.error("[auth/callback] email-verified send failed:", e);
  }
}
