// lib/services/esign/buyer-signing.service.ts
//
// In-house buyer purchase-contract electronic signature (Program 4 correction —
// replaces DocuSign). The ESignEnvelope row IS the signing transaction and the
// canonical evidence record; there is no external provider. Authority for the
// SIGNED deal transition is an internal, server-recorded signature — never a
// provider webhook.
//
// Invariants:
//  • The signed document is the Contract-Shield-APPROVED ContractVersion, bound
//    immutably by a SHA-256 hash over the exact stored bytes.
//  • A page view is never a signature. Signing requires an affirmative
//    electronic-signature consent + an adopted (typed) name, submitted server-side.
//  • Signer attribution (user id, role, email, IP, user-agent, timestamps) is
//    resolved server-side; the client cannot supply any of it authoritatively.
//  • If the contract changed since the envelope was prepared, the old hash no
//    longer matches: the envelope is VOIDED and re-issued — the prior consent is
//    never silently carried onto a modified document.
//  • Recording a signature is idempotent (dealId is @unique; an already-COMPLETED
//    envelope is a no-op) and drives the deal to SIGNED exactly once (the
//    advanceDealStatus CAS guarantees it).

import { prisma } from "@/lib/prisma";
import { ESignStatus, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { loadContractPdfBytes } from "@/lib/services/contract-shield/extract-text";

const CONTRACT_BUCKET = "dealer-contracts";
const SIGNING_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const SIGNER_ROLE = "BUYER";

export class NoSignableDocumentError extends Error {
  code = "NO_SIGNABLE_DOCUMENT";
  constructor() { super("No Contract-Shield-approved contract is available to sign"); this.name = "NoSignableDocumentError"; }
}
export class ConsentRequiredError extends Error {
  code = "CONSENT_REQUIRED";
  constructor() { super("Affirmative electronic-signature consent is required to sign"); this.name = "ConsentRequiredError"; }
}
export class DocumentChangedError extends Error {
  code = "DOCUMENT_CHANGED";
  constructor() { super("The contract changed since signing began; the signature request was voided and must be re-issued"); this.name = "DocumentChangedError"; }
}
export class EnvelopeNotSignableError extends Error {
  code = "ENVELOPE_NOT_SIGNABLE";
  constructor(public readonly status: ESignStatus) { super(`Envelope is not in a signable state (${status})`); this.name = "EnvelopeNotSignableError"; }
}

/** SHA-256 (hex) over the exact stored contract bytes — the tamper-evidence anchor. */
export async function computeDocumentHash(documentUrl: string): Promise<string> {
  const bytes = await loadContractPdfBytes(documentUrl);
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/** The Contract-Shield-approved contract version for a deal (latest APPROVED), or null. */
async function getApprovedContractVersion(dealId: string) {
  return prisma.contractVersion.findFirst({
    where: { dealId, status: "APPROVED" },
    orderBy: { version: "desc" },
  });
}

export interface PrepareResult {
  envelopeId: string;
  documentVersionId: string;
  documentHash: string;
  status: ESignStatus;
}

/**
 * Ensure a prepared in-house signing envelope for a deal, bound to the approved
 * contract by hash. Idempotent per deal (dealId @unique). A COMPLETED envelope is
 * returned unchanged. Fails closed if there is no approved document to sign.
 * Optionally provide signer identity (from the authenticated buyer).
 */
export async function prepareBuyerSigningEnvelope(
  dealId: string,
  signer?: { signerUserId?: string; signerName?: string; signerEmail?: string },
): Promise<PrepareResult> {
  const existing = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (existing?.status === "COMPLETED") {
    return {
      envelopeId: existing.id,
      documentVersionId: existing.documentVersionId ?? "",
      documentHash: existing.documentHash ?? "",
      status: existing.status,
    };
  }

  const contract = await getApprovedContractVersion(dealId);
  if (!contract) throw new NoSignableDocumentError();

  const documentHash = await computeDocumentHash(contract.documentUrl);
  const expiresAt = new Date(Date.now() + SIGNING_TTL_MS);

  const envelope = await prisma.eSignEnvelope.upsert({
    where: { dealId },
    create: {
      dealId,
      status: ESignStatus.SENT,
      sentAt: new Date(),
      documentVersionId: contract.id,
      documentHash,
      signerRole: SIGNER_ROLE,
      signerUserId: signer?.signerUserId ?? null,
      signerName: signer?.signerName ?? null,
      signerEmail: signer?.signerEmail ?? null,
      expiresAt,
    },
    update: {
      // Re-prepare a not-yet-signed envelope against the current approved
      // document (a new contract version resets the binding + any prior decline).
      status: ESignStatus.SENT,
      sentAt: new Date(),
      documentVersionId: contract.id,
      documentHash,
      signerRole: SIGNER_ROLE,
      ...(signer?.signerUserId ? { signerUserId: signer.signerUserId } : {}),
      ...(signer?.signerName ? { signerName: signer.signerName } : {}),
      ...(signer?.signerEmail ? { signerEmail: signer.signerEmail } : {}),
      declineReason: null,
      expiresAt,
    },
  });

  return { envelopeId: envelope.id, documentVersionId: contract.id, documentHash, status: envelope.status };
}

/** A short-lived signed URL to VIEW the contract document being signed. */
export async function getContractViewUrl(documentUrl: string, expirySeconds = 900): Promise<string | null> {
  try {
    if (/^https?:\/\//i.test(documentUrl)) return documentUrl;
    const { createServiceSupabaseClient } = await import("@/lib/supabase");
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase.storage.from(CONTRACT_BUCKET).createSignedUrl(documentUrl, expirySeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch (err) {
    logger.error("[buyer-signing] contract view URL failed:", err);
    return null;
  }
}

export interface RecordSignatureParams {
  dealId: string;
  signerUserId: string;
  signerName: string;
  signerEmail: string;
  signatureText: string;
  consentedToElectronic: boolean;
  ipAddress: string;
  userAgent: string;
}

export interface RecordSignatureResult {
  status: "COMPLETED";
  envelopeId: string;
  alreadySigned: boolean;
}

/**
 * Record the buyer's in-house signature. Server-authoritative: consent, adopted
 * name, IP/UA, and timestamps are captured here; the client supplies only its
 * consent action and adopted name. Verifies the document is unchanged (tamper
 * check), persists the full evidence + audit atomically, then drives the deal to
 * SIGNED. Idempotent: a second submission on a COMPLETED envelope is a no-op.
 */
export async function recordBuyerSignature(params: RecordSignatureParams): Promise<RecordSignatureResult> {
  if (!params.consentedToElectronic) throw new ConsentRequiredError();
  if (!params.signatureText?.trim()) throw new ConsentRequiredError();

  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId: params.dealId } });
  if (!envelope) throw new NoSignableDocumentError();

  // Idempotent: already signed → no-op (never double-sign / double-advance).
  if (envelope.status === "COMPLETED") {
    await ensureDealSigned(params.dealId, params.signerUserId);
    return { status: "COMPLETED", envelopeId: envelope.id, alreadySigned: true };
  }
  // Only a live, prepared envelope can be signed. Declined/voided/expired must be re-prepared.
  if (envelope.status !== "SENT" && envelope.status !== "DELIVERED" && envelope.status !== "PENDING") {
    throw new EnvelopeNotSignableError(envelope.status);
  }
  if (!envelope.documentVersionId) throw new NoSignableDocumentError();

  const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
  if (!contract || contract.status !== "APPROVED") {
    // The approved document backing this envelope is gone/superseded → re-issue.
    await voidEnvelopeInternal(params.dealId, "Approved contract no longer available");
    throw new DocumentChangedError();
  }

  // Tamper check: the bytes signed MUST match the bytes bound at prepare time.
  const currentHash = await computeDocumentHash(contract.documentUrl);
  if (currentHash !== envelope.documentHash) {
    await voidEnvelopeInternal(params.dealId, "Contract document changed after signing began");
    throw new DocumentChangedError();
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Compare-and-swap on the prepared status so a concurrent double-submit
    // cannot both complete (only one moves SENT/DELIVERED/PENDING → COMPLETED).
    const swap = await tx.eSignEnvelope.updateMany({
      where: { id: envelope.id, status: envelope.status },
      data: {
        status: ESignStatus.COMPLETED,
        completedAt: now,
        signedAt: now,
        consentedToElectronic: true,
        consentedAt: now,
        signatureText: params.signatureText.trim(),
        signerUserId: params.signerUserId,
        signerRole: SIGNER_ROLE,
        signerName: params.signerName,
        signerEmail: params.signerEmail,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        documentHash: currentHash,
      },
    });
    if (swap.count === 0) {
      // Lost the race — another submission completed it. Treat as idempotent.
      return;
    }
    await tx.adminAuditLog.create({
      data: {
        adminId: "system",
        adminEmail: "system@autolenis.com",
        action: "ESIGN_SIGNED",
        entityType: "ESignEnvelope",
        entityId: envelope.id,
        reason: "Buyer completed in-house electronic signature",
        metadata: {
          dealId: params.dealId,
          signerUserId: params.signerUserId,
          documentVersionId: envelope.documentVersionId,
          documentHash: currentHash,
          ipAddress: params.ipAddress,
        },
      },
    });
  });

  // Drive the deal to SIGNED through the guarded seam (idempotent CAS). Done
  // AFTER the evidence commit; ensureDealSigned re-drives on any later read if
  // this specific call is interrupted — no silent limbo, no false completion.
  await ensureDealSigned(params.dealId, params.signerUserId);

  return { status: "COMPLETED", envelopeId: envelope.id, alreadySigned: false };
}

/**
 * Ensure a deal with a COMPLETED signature envelope has reached SIGNED. Idempotent
 * and self-healing: safe to call on every read of a signed envelope, so an
 * interrupted post-signature advance is recovered without a reconciliation cron.
 */
export async function ensureDealSigned(dealId: string, actorId?: string): Promise<void> {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
  if (!deal) return;
  // Reachable target: CONTRACT_APPROVED → SIGNING_PENDING → SIGNED. Advance the
  // hops that are still legal; the CAS makes each idempotent.
  if (deal.status === "CONTRACT_APPROVED") {
    await advanceDealStatus(dealId, "SIGNING_PENDING", { actorId, actorRole: "BUYER", reason: "In-house signature recorded" });
  }
  const after = await prisma.deal.findUnique({ where: { id: dealId }, select: { status: true } });
  if (after?.status === "SIGNING_PENDING") {
    await advanceDealStatus(dealId, "SIGNED", { actorId, actorRole: "BUYER", reason: "In-house signature recorded" });
  }
}

/** Buyer declines to sign — truthful terminal exception; deal is NOT advanced. */
export async function declineBuyerSignature(dealId: string, reason?: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope || envelope.status === "COMPLETED" || envelope.status === "DECLINED") return;
  await prisma.eSignEnvelope.update({
    where: { dealId },
    data: { status: ESignStatus.DECLINED, declineReason: reason ?? "Declined by buyer" },
  });
  await writeExceptionAudit(dealId, envelope.id, "ESIGN_ENVELOPE_DECLINED", reason);
}

/** Void a signing envelope (admin action or internal re-issue). Deal not advanced. */
export async function voidEnvelopeInternal(dealId: string, reason: string): Promise<void> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope || envelope.status === "COMPLETED" || envelope.status === "VOIDED") return;
  await prisma.eSignEnvelope.update({
    where: { dealId },
    data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
  });
  await writeExceptionAudit(dealId, envelope.id, "ESIGN_ENVELOPE_VOIDED", reason);
}

/** Lazy expiry: mark a prepared-but-unsigned envelope EXPIRED once past its TTL. */
export async function expireIfElapsed(dealId: string): Promise<boolean> {
  const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
  if (!envelope || !envelope.expiresAt) return false;
  const signable = envelope.status === "SENT" || envelope.status === "DELIVERED" || envelope.status === "PENDING";
  if (signable && envelope.expiresAt.getTime() < Date.now()) {
    await prisma.eSignEnvelope.update({ where: { dealId }, data: { status: ESignStatus.EXPIRED } });
    await writeExceptionAudit(dealId, envelope.id, "ESIGN_ENVELOPE_EXPIRED", "Signing window elapsed");
    return true;
  }
  return false;
}

/**
 * Generate the tamper-evident evidence certificate for a COMPLETED signature and
 * persist its storage path. Best-effort and idempotent: skips if already
 * generated, never throws (runs in after()). This is also the recovery path — a
 * missing certificate is regenerated on demand (e.g. from the download route),
 * so no reconciliation cron is needed.
 */
export async function finalizeBuyerSignatureCertificate(dealId: string): Promise<string | null> {
  try {
    const envelope = await prisma.eSignEnvelope.findUnique({ where: { dealId } });
    if (!envelope || envelope.status !== "COMPLETED") return null;
    if (envelope.certificatePdfPath) return envelope.certificatePdfPath; // idempotent
    if (!envelope.documentVersionId || !envelope.documentHash || !envelope.signedAt) return null;

    const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
    const { generateAndUploadBuyerContractCertificate } = await import("./buyer-contract-certificate.service");
    const path = await generateAndUploadBuyerContractCertificate({
      envelopeId: envelope.id,
      dealId,
      signerName: envelope.signerName ?? "AutoLenis Buyer",
      signerEmail: envelope.signerEmail ?? "",
      signerUserId: envelope.signerUserId ?? "",
      documentVersionId: envelope.documentVersionId,
      documentVersion: contract?.version ?? 1,
      documentHash: envelope.documentHash,
      consentedAt: envelope.consentedAt ?? envelope.signedAt,
      signedAt: envelope.signedAt,
      ipAddress: envelope.ipAddress ?? "unknown",
      userAgent: envelope.userAgent ?? "unknown",
    });
    if (!path) return null;
    // Guarded write: only set while still null so a concurrent finalize can't clobber.
    await prisma.eSignEnvelope.updateMany({
      where: { id: envelope.id, certificatePdfPath: null },
      data: { certificatePdfPath: path, certificateGeneratedAt: new Date() },
    });
    return path;
  } catch (err) {
    logger.error("[buyer-signing] certificate finalize failed (non-fatal):", err);
    return null;
  }
}

async function writeExceptionAudit(dealId: string, envelopeId: string, action: string, reason?: string): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: "system",
      adminEmail: "system@autolenis.com",
      action,
      entityType: "ESignEnvelope",
      entityId: envelopeId,
      reason: reason ?? null,
      metadata: { dealId } as Prisma.InputJsonValue,
    },
  }).catch(() => {});
}
