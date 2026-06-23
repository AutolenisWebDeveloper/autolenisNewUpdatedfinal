// lib/services/dealer/dealer-contract.service.ts
import { prisma } from "@/lib/prisma";
import { scanContract } from "@/lib/services/contract-shield/contract-shield.service";

/** Thrown when a dealer attempts to act on a deal that is not their own win. */
export class DealOwnershipError extends Error {
  constructor() {
    super("This deal is not associated with your dealership.");
    this.name = "DealOwnershipError";
  }
}

/**
 * Verifies the deal exists and was won by this dealer (the deal's accepted
 * offer carries the dealer's id). Throws DealOwnershipError otherwise.
 * Mirrors the ownership model used by dealer-deals.service (scope via
 * offer.dealerId) so a dealer can never reach a Deal record that isn't theirs.
 */
export async function assertDealerOwnsDeal(dealId: string, dealerId: string): Promise<void> {
  const owned = await prisma.deal.findFirst({
    where: { id: dealId, offer: { dealerId } },
    select: { id: true },
  });
  if (!owned) throw new DealOwnershipError();
}

export async function uploadDealerContract(dealId: string, dealerId: string, documentUrl: string) {
  // Authorization chokepoint — protects every caller, not just the HTTP route.
  await assertDealerOwnsDeal(dealId, dealerId);

  const existing = await prisma.contractVersion.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existing[0]?.version ?? 0) + 1;

  // Supersede old versions
  if (existing.length) await prisma.contractVersion.updateMany({ where: { dealId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });

  const cv = await prisma.contractVersion.create({
    data: { dealId, documentUrl, version, uploadedBy: dealerId, status: "UPLOADED" },
  });

  // Trigger automatic scan
  await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "SCANNING", scanRunAt: new Date() } });
  await scanContract(dealId, `Contract version ${version}`, dealerId).catch(err => {
    prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "REJECTED", rejectionReason: String(err) } }).catch(() => {});
  });

  return cv;
}

export async function getDealContracts(dealId: string) {
  return prisma.contractVersion.findMany({ where: { dealId }, orderBy: { version: "desc" } });
}
