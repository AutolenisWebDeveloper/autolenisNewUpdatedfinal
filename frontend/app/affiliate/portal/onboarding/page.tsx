import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { ensureOnboardingRecord, getOnboardingProfile } from "@/lib/services/affiliate/onboarding.service";
import { redirect } from "next/navigation";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";

interface Props { searchParams: Promise<{ step?: string }> }

export default async function AffiliateOnboardingPage({ searchParams }: Props) {
  const affiliate = await requireAffiliate();
  const sp        = await searchParams;
  const step      = parseInt(sp.step ?? "1", 10);

  const [onboarding, profile] = await Promise.all([
    ensureOnboardingRecord(affiliate.id),
    getOnboardingProfile(affiliate.id),
  ]);

  if (!onboarding) {
    redirect("/affiliate/portal/onboarding?step=1");
  }

  return (
    <OnboardingWizard
      affiliateId={affiliate.id}
      email={affiliate.user.email}
      initialStep={step}
      onboarding={onboarding}
      profile={profile}
    />
  );
}
