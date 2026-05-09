import { createServerSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function getAuthenticatedAffiliate() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return prisma.affiliate.findFirst({
    where: { user: { supabaseId: user.id } },
    include: {
      user: true,
      commissions: { where: { status: "APPROVED" }, select: { amountCents: true, level: true } },
      children: { take: 1 },
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

  return affiliate;
}

export async function requireAffiliateWithOnboarding() {
  const affiliate = await requireAffiliate();

  const { ensureOnboardingRecord } = await import(
    "@/lib/services/affiliate/onboarding.service"
  );

  const onboarding = await ensureOnboardingRecord(affiliate.id);
  if (!onboarding) {
    redirect("/affiliate/portal/onboarding?step=1");
  }

  const headersList = await headers();
  const pathname    = headersList.get("x-pathname") ?? "";
  const exempt      = [
    "/affiliate/portal/onboarding",
    "/affiliate/portal/profile",
    "/affiliate/portal/settings",
    "/affiliate/portal/compliance",
  ];

  if (
    onboarding.status === "NOT_STARTED" &&
    !exempt.some(p => pathname.startsWith(p))
  ) {
    redirect("/affiliate/portal/onboarding?step=1");
  }

  return { affiliate, onboarding };
}
