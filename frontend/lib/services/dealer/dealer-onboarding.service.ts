// lib/services/dealer/dealer-onboarding.service.ts
import { prisma } from "@/lib/prisma";

export async function getDealerOnboardingStatus(dealerId: string) {
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, include: { user: true, feedConfig: true } });
  if (!dealer) return null;

  // Batch 2 (FS-N) — real checks instead of hardcoded `false`.
  const [licenseRecord, inventoryCount, signature] = await Promise.all([
    prisma.dealerLicense.findFirst({ where: { dealerId, isActive: true }, select: { id: true } }),
    prisma.inventoryItem.count({ where: { dealerId } }),
    prisma.dealerAgreementSignature.findUnique({ where: { dealerId }, select: { id: true } }),
  ]);

  const steps = [
    { key: "profile", done: !!(dealer.dealershipName && dealer.phone && dealer.city) },
    { key: "license", done: !!licenseRecord },
    { key: "inventory", done: inventoryCount > 0 },
    { key: "dms-feed", done: !!dealer.feedConfig },
    { key: "agreement", done: !!signature || !!dealer.marketplaceAgreementSignedAt },
  ];
  // DMS feed is optional; onboarding is complete when the required steps are done.
  const requiredKeys = new Set(["profile", "license", "inventory", "agreement"]);
  const complete = steps.filter((s) => requiredKeys.has(s.key)).every((s) => s.done);
  return { steps, complete, status: dealer.status };
}
