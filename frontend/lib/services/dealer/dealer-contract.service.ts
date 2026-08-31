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

/**
 * ADMIN OVERRIDE — mark the deal's current contract version APPROVED.
 *
 * The automated scan is fail-closed: a WARNING/FAIL leaves the ContractVersion
 * REJECTED. When an admin overrides that verdict in the Contract Shield review
 * queue, the Deal is advanced to CONTRACT_APPROVED and the buyer is told to sign —
 * but prepareBuyerSigningEnvelope requires a ContractVersion whose status is
 * APPROVED. Without this the override produced a deal that could never be signed:
 * the envelope prepare threw NoSignableDocumentError, the route swallowed it, and
 * the deal dead-ended at CONTRACT_APPROVED.
 *
 * Lives here because this service owns ContractVersion (upload, versioning,
 * supersede, scan verdict) — the override reuses that ownership rather than
 * re-implementing version bookkeeping in an admin route.
 *
 * Approves the LATEST version and supersedes any other approved one, preserving the
 * one-approved-version-per-deal invariant that uploadDealerContract maintains.
 * Idempotent. Returns the approved version id, or null when the deal has no
 * contract version at all (nothing to approve).
 */
export async function approveContractVersionByAdmin(dealId: string): Promise<string | null> {
  const latest = await prisma.contractVersion.findMany({
    where: { dealId },
    orderBy: { version: "desc" },
    take: 1,
  });
  const target = latest[0];
  if (!target) return null;

  // Supersede any OTHER approved version first, so approving never leaves two.
  await prisma.contractVersion.updateMany({
    where: { dealId, status: "APPROVED", id: { not: target.id } },
    data: { status: "SUPERSEDED" },
  });

  await prisma.contractVersion.update({
    where: { id: target.id },
    data: { status: "APPROVED", rejectionReason: null },
  });
  return target.id;
}

/**
 * Version + store a contract for a deal and kick off the Contract Shield scan.
 *
 * Authorization-free by design: it is the shared pipeline behind BOTH entry points
 * and each of those owns its own authorization —
 *   • uploadDealerContract        → dealer, gated by assertDealerOwnsDeal
 *   • uploadContractForDealByAdmin → admin, gated by requirePermission at the route
 * Not exported, so no caller can reach it without passing through one of those.
 */
async function createContractVersionAndScan(dealId: string, documentUrl: string, uploadedBy: string) {
  const existing = await prisma.contractVersion.findMany({ where: { dealId }, orderBy: { version: "desc" }, take: 1 });
  const version = (existing[0]?.version ?? 0) + 1;

  // Supersede old versions
  if (existing.length) await prisma.contractVersion.updateMany({ where: { dealId, status: "APPROVED" }, data: { status: "SUPERSEDED" } });

  const cv = await prisma.contractVersion.create({
    data: { dealId, documentUrl, version, uploadedBy, status: "UPLOADED" },
  });

  // Trigger the automatic scan on the REAL contract text. Fail-closed: a scan
  // that can't read the document or doesn't PASS never becomes APPROVED (see
  // scanContractVersion). Errors leave the row retryable, not terminally
  // rejected, so the contract-shield cron re-attempts on its next pass.
  await scanContractVersion(cv.id).catch(() => {});

  return cv;
}

export async function uploadDealerContract(dealId: string, dealerId: string, documentUrl: string) {
  // Authorization chokepoint — protects every caller, not just the HTTP route.
  await assertDealerOwnsDeal(dealId, dealerId);
  return createContractVersionAndScan(dealId, documentUrl, dealerId);
}

/**
 * ADMIN/CONCIERGE upload path.
 *
 * A concierge (vehicle-request) deal has no Offer, and VehicleRequestOffer carries
 * no dealer identity — so assertDealerOwnsDeal can never pass for one and the ONLY
 * writer of ContractVersion was unreachable for that whole track. The consequence
 * was structural: no ContractVersion → no APPROVED version → prepareBuyerSigningEnvelope
 * fails → a concierge deal could never be signed and therefore never completed.
 *
 * This is the same pipeline the dealer path uses (identical versioning, supersede
 * and fail-closed scan) with admin authorization instead of dealer ownership, so
 * the concierge track joins the existing Contract Shield → e-sign flow rather than
 * getting a parallel one. Authorization is enforced by the calling admin route.
 */
export async function uploadContractForDealByAdmin(dealId: string, documentUrl: string, adminId: string) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) throw new DealOwnershipError();
  return createContractVersionAndScan(dealId, documentUrl, adminId);
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
