import { createServerSupabaseClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import { ensurePrismaUser, recordAffiliateAttribution } from "@/lib/auth/actions";
import { getSafeBuyerRedirect } from "@/lib/auth/urls";
import { UserRole, BuyerPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmailVerifiedEmail } from "@/lib/services/email/resend.service";
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
    console.error("[auth/callback] CRM contact sync failed:", err);
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
    await sendEmailVerifiedEmail({ to: email, firstName });

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
    console.error("[auth/callback] email-verified send failed:", e);
  }
}
