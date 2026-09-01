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
 * Outcome of an admin Contract Shield approval. A refusal is a first-class,
 * inspectable result rather than `null`, so the calling route can fail CLOSED
 * with a specific reason instead of guessing why nothing was approved.
 */
export type AdminContractApproval =
  | { ok: true; contractVersionId: string }
  | {
      ok: false;
      code: "NO_LINKED_VERSION" | "VERSION_NOT_FOUND" | "SUPERSEDED_BY_NEWER_UPLOAD";
      message: string;
    };

/**
 * ADMIN OVERRIDE — mark the ContractVersion that a reviewed scan judged APPROVED.
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
 * COMPLIANCE GATE. Approval binds to `contractVersionId` — the exact document the
 * reviewed scan ran against (ContractScan.contractVersionId), NOT "the newest
 * version". Approving the newest was a fail-OPEN defect: a dealer revision
 * uploaded while the scan sat in the review queue became APPROVED without ever
 * being scanned, and buyer-signing.service binds the buyer's binding signature and
 * tamper hash to whichever version is APPROVED.
 *
 * Refuses, never guesses:
 *   • NO_LINKED_VERSION         — the scan predates the contract_version_id column
 *     (or is an admin override row with no document). The admin must re-scan; a
 *     heuristic here would reintroduce the defect.
 *   • VERSION_NOT_FOUND         — the linked version is gone, or belongs to another deal.
 *   • SUPERSEDED_BY_NEWER_UPLOAD — a newer version landed after the reviewed scan.
 *     Approving the reviewed one would sign a superseded document and approving the
 *     newer one would sign an unreviewed document, so neither happens. This is the
 *     clause that closes the upload-during-review race, independently of the link.
 *
 * A refusal writes nothing. Success supersedes any other APPROVED version,
 * preserving the one-approved-version-per-deal invariant that uploadDealerContract
 * maintains, and is idempotent.
 */
export async function approveContractVersionByAdmin(
  dealId: string,
  contractVersionId: string | null | undefined,
): Promise<AdminContractApproval> {
  if (!contractVersionId) {
    return {
      ok: false,
      code: "NO_LINKED_VERSION",
      message:
        "This review is not linked to a contract version, so we cannot tell which document was reviewed. Re-scan the contract and approve the new review.",
    };
  }

  const target = await prisma.contractVersion.findUnique({ where: { id: contractVersionId } });
  if (!target || target.dealId !== dealId) {
    return {
      ok: false,
      code: "VERSION_NOT_FOUND",
      message: "The contract version this review targeted no longer exists on this deal. Re-scan the contract.",
    };
  }

  // Upload-during-review pre-check: the reviewed document is only approvable while
  // it is still the deal's current one. This gives the specific, actionable refusal
  // in the ordinary (non-racing) case; the compare-and-set below is what actually
  // decides a genuine race.
  const newest = await prisma.contractVersion.findMany({
    where: { dealId },
    orderBy: { version: "desc" },
    take: 1,
  });
  const latestVersion = newest[0]?.version ?? target.version;
  if (latestVersion > target.version) {
    return {
      ok: false,
      code: "SUPERSEDED_BY_NEWER_UPLOAD",
      message:
        "A newer contract version was uploaded after this review ran, so this verdict is stale. Review the latest scan instead.",
    };
  }

  // COMPARE-AND-SET. The pre-check above read the version list; an upload
  // committing between that read and this write would otherwise slip through —
  // the read says "still current", the write approves a document that was
  // superseded a moment later. Claiming the row conditionally on
  // `status != SUPERSEDED` lets the database settle that race: because
  // createContractVersionAndScan supersedes EVERY other version, a concurrent
  // upload marks this target SUPERSEDED, the claim matches zero rows, and the
  // approval refuses instead of binding a buyer's signature to a stale document.
  // This is also the first write in the function, so a refusal still writes nothing.
  const claimed = await prisma.contractVersion.updateMany({
    where: { id: target.id, status: { not: "SUPERSEDED" } },
    data: { status: "APPROVED", rejectionReason: null },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      code: "SUPERSEDED_BY_NEWER_UPLOAD",
      message:
        "A newer contract version was uploaded while this approval was being processed, so this verdict is stale. Review the latest scan instead.",
    };
  }

  // Only now retire any OTHER approved version, so approving never leaves two.
  await prisma.contractVersion.updateMany({
    where: { dealId, status: "APPROVED", id: { not: target.id } },
    data: { status: "SUPERSEDED" },
  });

  return { ok: true, contractVersionId: target.id };
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

  // Create the replacement BEFORE retiring what it replaces: superseding first
  // would leave the deal with no live version at all if the create then failed.
  const cv = await prisma.contractVersion.create({
    data: { dealId, documentUrl, version, uploadedBy, status: "UPLOADED" },
  });

  // Supersede EVERY other version for this deal, not only the APPROVED one. A
  // newer document makes each earlier one obsolete — a REJECTED row is not
  // re-approvable and an UPLOADED row must not keep occupying the scan queue.
  // It also makes SUPERSEDED a complete marker, which is what lets
  // approveContractVersionByAdmin settle the approve/upload race with a
  // conditional update instead of a read followed by an unguarded write.
  await prisma.contractVersion.updateMany({
    where: { dealId, id: { not: cv.id }, status: { not: "SUPERSEDED" } },
    data: { status: "SUPERSEDED" },
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
    // Pass cv.id so the ContractScan row records WHICH document it judged —
    // the link the admin approval gate binds to.
    const result = await scanContract(cv.dealId, text, cv.deal.offer?.dealerId ?? cv.uploadedBy, cv.id);

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
