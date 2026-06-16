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
    const [review, profile, taxProfile, paymentProfile, documents] = await Promise.all([
      prisma.affiliateOnboardingReview.findUnique({ where: { affiliateId } }),
      prisma.affiliateProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliateTaxProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliatePaymentProfile.findUnique({ where: { affiliateId } }),
      prisma.affiliateDocument.findMany({ where: { affiliateId } }),
    ]);
    return { review, profile, taxProfile, paymentProfile, documents };
  } catch {
    logger.warn("[onboarding] onboarding tables not yet migrated — returning empty profile");
    return { review: null, profile: null, taxProfile: null, paymentProfile: null, documents: [] as Awaited<ReturnType<typeof prisma.affiliateDocument.findMany>> };
  }
}

export function computeOnboardingCompletion(data: Awaited<ReturnType<typeof getOnboardingProfile>>) {
  const { profile, taxProfile, paymentProfile, documents } = data;
  const steps = {
    personalInfo:    !!(profile?.firstName && profile?.addressLine1 && profile?.phone),
    businessProfile: !!(profile?.entityType),
    taxInfo:         !!(taxProfile?.certified && taxProfile?.tinLast4),
    paymentProfile:  !!(paymentProfile?.payoutMethod && paymentProfile?.accountLast4),
    documents:       documents.some(d => d.type === "GOVERNMENT_ID"),
  };
  const completedCount = Object.values(steps).filter(Boolean).length;
  const totalCount     = Object.keys(steps).length;
  return { steps, completedCount, totalCount, isComplete: completedCount === totalCount };
}
