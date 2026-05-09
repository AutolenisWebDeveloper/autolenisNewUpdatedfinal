// lib/services/buyer/buyer-onboarding.service.ts
import { prisma } from "@/lib/prisma";

export interface OnboardingStep { label: string; done: boolean; key: string }

export async function getOnboardingSteps(buyerId: string): Promise<OnboardingStep[]> {
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true, preQualification: true },
  });
  if (!buyer) return [];
  return [
    { key: "account", label: "Account created", done: true },
    { key: "profile", label: "Personal details", done: !!(buyer.firstName && buyer.lastName && buyer.phone) },
    { key: "prequal", label: "Pre-qualification", done: !!buyer.preQualification },
    { key: "terms", label: "Terms accepted", done: !!buyer.termsAcceptedAt },
  ];
}

export async function saveOnboardingStep(buyerId: string, step: string, data: Record<string, unknown>) {
  if (step === "profile") {
    await prisma.buyer.update({ where: { id: buyerId }, data: data as { firstName?: string; lastName?: string; phone?: string } });
  }
  await prisma.buyerActivityEvent.create({ data: { buyerId, eventType: `ONBOARDING_${step.toUpperCase()}`, title: `Onboarding: ${step} completed`, metadata: data as object } }).catch(() => {});
}
