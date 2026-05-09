import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account Setup", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import OnboardingWizardClient from "@/components/buyer/OnboardingWizardClient";

export const dynamic = "force-dynamic";

export default async function BuyerOnboardingPage() {
  const buyer = await requireBuyer();

  // Compute prequal status — available because requireBuyer includes preQualification.
  const prequal = buyer.preQualification;
  const prequalApproved =
    !!prequal &&
    prequal.decision === "APPROVED" &&
    prequal.expiresAt > new Date();

  // Redirect away from the wizard if onboarding is already done,
  // OR if the buyer somehow has an approved prequal without the
  // onboardingComplete flag being set (edge case from data migration).
  if (buyer.onboardingComplete || prequalApproved) {
    redirect(prequalApproved ? "/buyer/search" : "/buyer/prequal");
  }

  return (
    <OnboardingWizardClient
      initial={{
        firstName: buyer.firstName ?? "",
        lastName: buyer.lastName ?? "",
        phone: buyer.phone ?? "",
        onboardingComplete: buyer.onboardingComplete,
      }}
    />
  );
}
