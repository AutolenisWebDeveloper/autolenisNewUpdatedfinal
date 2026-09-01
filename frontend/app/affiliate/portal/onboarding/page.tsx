import { requireAffiliate } from "@/lib/auth/affiliate-session";
import { ensureOnboardingRecord, getOnboardingProfile } from "@/lib/services/affiliate/onboarding.service";
import { AlertCircle } from "lucide-react";
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

  // R12/O13 — the degraded state (onboarding record can't be provisioned,
  // e.g. an unmigrated environment) used to redirect("?step=1") — this very
  // URL — producing ERR_TOO_MANY_REDIRECTS in exactly the environment the
  // fallback was written for. Render an honest error state instead.
  if (!onboarding) {
    return (
      <div className="p-6 md:p-8 max-w-2xl" data-testid="onboarding-unavailable">
        <div className="bg-white border border-red-200 rounded-xl p-8 text-center">
          <AlertCircle size={28} className="text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-900 mb-2">Onboarding is temporarily unavailable</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            We couldn&apos;t load your onboarding record. Please refresh in a moment — if this
            keeps happening, contact{" "}
            <a href="mailto:support@autolenis.com" className="text-al-primary font-semibold hover:underline">
              support@autolenis.com
            </a>
            .
          </p>
        </div>
      </div>
    );
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
