import { createServerSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export async function getAuthenticatedAffiliate() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // M7/D4 — this runs for the layout AND every portal page render. The old
  // include loaded the full User row, the affiliate's ENTIRE approved
  // commission history (unbounded, used by no caller — pages aggregate via
  // getCommissionSummary), and a children sample. Callers read only
  // user.email; everything else was dead per-request weight.
  return prisma.affiliate.findFirst({
    where: { user: { supabaseId: user.id } },
    include: {
      user: { select: { id: true, email: true, role: true } },
    },
  });
}

export async function requireAffiliate() {
  const affiliate = await getAuthenticatedAffiliate();
  // All authenticated affiliate routes are canonical under /affiliate/portal/*
  if (!affiliate) redirect("/auth/signin");

  // REVOCATION, not approval: suspension is the abuse kill switch applied to
  // an already-active account. No affiliate ever waits for approval to get in.
  if (affiliate.status === "SUSPENDED") {
    redirect("/affiliate/unsubscribed?reason=suspended");
  }

  // REVOCATION, not approval: REJECTED is an admin-initiated shutdown of an
  // existing account (there is no application review to fail).
  if (affiliate.status === "REJECTED") {
    redirect("/affiliate/unsubscribed?reason=rejected");
  }

  return affiliate;
}

// APPROVAL GATE REMOVED (owner decision, 2026-08-29).
//
// Affiliate accounts are auto-approved at registration: no admin approval, no
// pending-approval state, and no onboarding gate stands between an affiliate
// and any portal surface. This helper is retained only so pages can render a
// NON-BLOCKING onboarding nudge (the wizard still collects tax + banking data,
// which the payout rail needs) — it never redirects.
//
// What is still enforced, and is NOT an approval gate: SUSPENDED and REJECTED
// (see requireAffiliate above) are revocations — the abuse kill switch applied
// after the fact, not a precondition for access.
export async function requireAffiliateWithOnboarding() {
  const affiliate = await requireAffiliate();

  // Read-only and failure-tolerant: a missing review row or a degraded read
  // both resolve to NOT_STARTED, which blocks nothing.
  const review = await prisma.affiliateOnboardingReview
    .findUnique({ where: { affiliateId: affiliate.id }, select: { status: true } })
    .catch(() => null);

  return { affiliate, onboardingStatus: review?.status ?? "NOT_STARTED" };
}
