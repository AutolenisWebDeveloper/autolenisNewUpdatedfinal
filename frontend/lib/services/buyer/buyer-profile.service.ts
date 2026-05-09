// lib/services/buyer/buyer-profile.service.ts
import { prisma } from "@/lib/prisma";

export async function updateBuyerProfile(buyerId: string, data: { firstName?: string; lastName?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string; profilePictureUrl?: string }) {
  return prisma.buyer.update({ where: { id: buyerId }, data });
}

export async function completeBuyerOnboarding(buyerId: string) {
  await prisma.buyer.update({ where: { id: buyerId }, data: { onboardingComplete: true } });
  await prisma.buyerActivityEvent.create({ data: { buyerId, eventType: "ONBOARDING_COMPLETED", title: "Profile setup complete" } }).catch(() => {});
}

export async function getBuyerWithFullProfile(buyerId: string) {
  return prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: true, preQualification: true, shortlists: { include: { items: true } } },
  });
}
