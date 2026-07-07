// lib/services/dealer/dealer-contract.service.ts
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { scanContract } from "@/lib/services/contract-shield/contract-shield.service";
import { extractContractText } from "@/lib/services/contract-shield/extract-text";

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

  // Trigger the automatic scan on the REAL contract text. Fail-closed: a scan
  // that can't read the document or doesn't PASS never becomes APPROVED (see
  // scanContractVersion). Errors leave the row retryable, not terminally
  // rejected, so the contract-shield cron re-attempts on its next pass.
  await scanContractVersion(cv.id).catch(() => {});

  return cv;
}

/**
 * Scan a single uploaded ContractVersion against the junk-fee / doc-fee-cap
 * rules using the ACTUAL text extracted from its stored PDF, and converge its
 * workflow status. Shared by the dealer upload path and the contract-shield
 * cron so the two never diverge.
 *
 * Terminal outcomes:
 *   • scan status PASS      → ContractVersion APPROVED
 *   • scan status WARNING/FAIL → ContractVersion REJECTED (dealer must fix &
 *     re-upload); the junk-fee findings are recorded as the rejection reason.
 * Non-terminal (retryable) outcome:
 *   • extraction/scan error → row is left/reset to UPLOADED so the next cron
 *     pass retries. We NEVER auto-approve a document we could not read.
 */
export async function scanContractVersion(contractVersionId: string): Promise<void> {
  const cv = await prisma.contractVersion.findUnique({
    where: { id: contractVersionId },
    include: { deal: { include: { offer: { select: { dealerId: true } } } } },
  });
  if (!cv) return;

  await prisma.contractVersion.update({
    where: { id: cv.id },
    data: { status: "SCANNING", scanRunAt: new Date() },
  });

  try {
    const text = await extractContractText(cv.documentUrl);
    const result = await scanContract(cv.dealId, text, cv.deal.offer?.dealerId ?? cv.uploadedBy);

    if (result.status === "PASS") {
      await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "APPROVED", rejectionReason: null } });
    } else {
      const reason = `Contract Shield ${result.status} (score ${result.score}). ` +
        (result.fixList.length
          ? `Issues: ${result.fixList.map(f => f.item ?? f.foundValue).filter(Boolean).slice(0, 6).join("; ")}.`
          : "Manual review required.");
      await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "REJECTED", rejectionReason: reason } });
    }
  } catch (err) {
    // Fail closed: a document we could not read/scan is NOT approved. Reset to
    // UPLOADED (retryable) rather than a terminal REJECTED so a transient fetch
    // failure self-heals on the next cron pass.
    logger.error(`[contract-shield] scan failed for version ${cv.id} — left retryable:`, err);
    await prisma.contractVersion
      .update({ where: { id: cv.id }, data: { status: "UPLOADED" } })
      .catch(() => {});
  }
}

export async function getDealContracts(dealId: string) {
  return prisma.contractVersion.findMany({ where: { dealId }, orderBy: { version: "desc" } });
}
