// lib/services/dealer/dealer-contract.service.ts
import { prisma } from "@/lib/prisma";
import { scanContract } from "@/lib/services/contract-shield/contract-shield.service";

export async function uploadDealerContract(dealId: string, dealerId: string, documentUrl: string) {
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
