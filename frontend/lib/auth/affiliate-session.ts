import { createServerSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

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

  // Block suspended affiliates — full portal access is revoked until support resolves the issue.
  if (affiliate.status === "SUSPENDED") {
    redirect("/affiliate/unsubscribed?reason=suspended");
  }

  // Block rejected affiliates — application was denied; portal access must not be granted.
  if (affiliate.status === "REJECTED") {
    redirect("/affiliate/unsubscribed?reason=rejected");
  }

  return affiliate;
}

// R3/decision 2 — the reconciled exempt set: the pre-existing four plus
// dashboard (home + onboarding CTA), notifications (admin decisions arrive
// there), and resources. Everything else in the portal requires the wizard to
// have been started. Exported so the gate test can prove every filesystem
// route is either exempt or gated, with no unreachable page and no loop.
export const ONBOARDING_EXEMPT_PATHS = [
  "/affiliate/portal/onboarding",
  "/affiliate/portal/profile",
  "/affiliate/portal/settings",
  "/affiliate/portal/compliance",
  "/affiliate/portal/dashboard",
  "/affiliate/portal/notifications",
  "/affiliate/portal/resources",
];

// The portal layout calls this for every portal page. Read-only: a missing
// review row means NOT_STARTED (the wizard page provisions the record on
// first visit); a degraded read (e.g. unmigrated environment) also resolves
// to NOT_STARTED, which lands on the wizard's own error state — never a loop.
export async function requireAffiliateWithOnboarding() {
  const affiliate = await requireAffiliate();

  const review = await prisma.affiliateOnboardingReview
    .findUnique({ where: { affiliateId: affiliate.id }, select: { status: true } })
    .catch(() => null);
  const onboardingStatus = review?.status ?? "NOT_STARTED";

  const headersList = await headers();
  const pathname    = headersList.get("x-pathname") ?? "";

  if (
    onboardingStatus === "NOT_STARTED" &&
    pathname.startsWith("/affiliate/portal/") &&
    !ONBOARDING_EXEMPT_PATHS.some(p => pathname.startsWith(p))
  ) {
    redirect("/affiliate/portal/onboarding?step=1");
  }

  return { affiliate, onboardingStatus };
}
