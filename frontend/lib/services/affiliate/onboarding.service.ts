import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export async function getOnboardingStatus(affiliateId: string) {
  try {
    const review = await prisma.affiliateOnboardingReview.findUnique({
      where: { affiliateId },
    });
    return review?.status ?? "NOT_STARTED";
  } catch {
    return "NOT_STARTED"; // table not migrated yet
  }
}

export async function ensureOnboardingRecord(affiliateId: string) {
  try {
    return await prisma.affiliateOnboardingReview.upsert({
      where:  { affiliateId },
      create: { affiliateId, status: "NOT_STARTED", currentStep: 1 },
      update: {},
    });
  } catch {
    return null; // table not migrated yet — non-fatal
  }
}

export async function saveOnboardingStep(
  affiliateId: string,
  step: number,
  status: "IN_PROGRESS" | "SUBMITTED" = "IN_PROGRESS"
) {
  return prisma.affiliateOnboardingReview.upsert({
    where:  { affiliateId },
    create: { affiliateId, status, currentStep: step },
    update: {
      currentStep: step,
      status,
      ...(status === "SUBMITTED" ? { submittedAt: new Date() } : {}),
    },
  });
}

export async function getOnboardingProfile(affiliateId: string) {
  try {
    const [review, profile, taxProfile, legacyPaymentProfile, payoutMethod, documents] = await Promise.all([
      prisma.affiliateOnboardingReview.findUnique({ where: { affiliateId } }),
      prisma.affiliateProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliateTaxProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliatePaymentProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliatePayoutMethod.findUnique({ where: { affiliateId } }),
      prisma.affiliateDocument.findMany({ where: { affiliateId } }),
    ]);

    // H-6 unification: AffiliatePayoutMethod (the Finance Hub model) is the
    // CANONICAL banking record. When banking was set up in the Finance Hub but
    // the legacy AffiliatePaymentProfile row is absent, synthesize the legacy
    // display shape from the canonical record so the wizard prefill and the
    // profile card render it without per-page changes. Legacy-only fields the
    // canonical model lacks (holderName, zellePhone) live on the legacy row.
    const paymentProfile =
      legacyPaymentProfile ??
      (payoutMethod
        ? {
            id: payoutMethod.id,
            affiliateId,
            payoutMethod: payoutMethod.method,
            holderName: null,
            routingLast4: payoutMethod.routingNumberLast4,
            accountLast4: payoutMethod.accountNumberLast4,
            accountType: payoutMethod.accountType,
            paypalEmail: payoutMethod.paypalEmail,
            zellePhone: null,
            verified: !!payoutMethod.verifiedAt,
            createdAt: payoutMethod.createdAt,
            updatedAt: payoutMethod.updatedAt,
          }
        : null);

    return { review, profile, taxProfile, paymentProfile, payoutMethod, documents };
  } catch {
    logger.warn("[onboarding] onboarding tables not yet migrated — returning empty profile");
    return { review: null, profile: null, taxProfile: null, paymentProfile: null, payoutMethod: null, documents: [] as Awaited<ReturnType<typeof prisma.affiliateDocument.findMany>> };
  }
}

export function computeOnboardingCompletion(data: Awaited<ReturnType<typeof getOnboardingProfile>>) {
  const { profile, taxProfile, paymentProfile, payoutMethod, documents } = data;
  const steps = {
    personalInfo:    !!(profile?.firstName && profile?.addressLine1 && profile?.phone),
    businessProfile: !!(profile?.entityType),
    taxInfo:         !!(taxProfile?.certified && taxProfile?.tinLast4),
    // H-6: banking readiness uses the SAME predicate as the Finance Hub
    // (`hasBanking = !!payoutMethod?.method`) so the two surfaces can never
    // disagree again. The old `accountLast4` requirement also wrongly failed
    // PAYPAL/ZELLE/CHECK payees, who have no account number. Pre-unification
    // legacy rows still count via paymentProfile.payoutMethod.
    paymentProfile:  !!(payoutMethod?.method || paymentProfile?.payoutMethod),
    documents:       documents.some(d => d.type === "GOVERNMENT_ID"),
  };
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount     = Object.keys(steps).length;
  return { steps, completedCount, totalCount, isComplete: completedCount === totalCount };
}
