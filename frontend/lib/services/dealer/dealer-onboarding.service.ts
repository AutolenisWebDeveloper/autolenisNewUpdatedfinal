// lib/services/dealer/dealer-onboarding.service.ts
import { prisma } from "@/lib/prisma";

export async function getDealerOnboardingStatus(dealerId: string) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, include: { user: true, feedConfig: true } });
  if (!dealer) return null;
  const steps = [
    { key: "profile", done: !!(dealer.dealershipName && dealer.phone && dealer.city) },
    { key: "license", done: false }, // Would check DealerLicense
    { key: "inventory", done: false },
    { key: "dms-feed", done: !!dealer.feedConfig },
  ];
  const complete = steps.every(s => s.done);
  return { steps, complete, status: dealer.status };
}
