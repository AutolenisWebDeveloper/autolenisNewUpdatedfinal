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
import { ESignStatus, NotificationType, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { logger } from "@/lib/logger";
import { advanceDealStatus } from "@/lib/services/deal/deal.service";
import { loadContractPdfBytes } from "@/lib/services/contract-shield/extract-text";
import {
  CONSENT_POLICY_VERSION,
  validateAcknowledgments,
  buildConsentSnapshot,
  IncompleteConsentError,
  type AcknowledgmentInput,
  type ConsentSnapshot,
} from "./consent-policy";
import { generateAndUploadExecutedContract } from "./executed-contract.service";
import { envelopeSelect, isExecutedArtifactEnabled, normalizeEnvelope } from "./esign-schema-gate";

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
/**
 * The signing ceremony cannot run because the consent + executed-artifact schema
 * (migrations 20261014 + 20261015) must be assumed unapplied — the schema gate is
 * closed. Signing FAILS CLOSED rather than proceeding: a completed signature whose
 * frozen consent snapshot cannot be persisted would report success while silently
 * dropping the very evidence the (attorney-blocked) consent policy exists to
 * capture. Reads stay available; only capturing NEW consent is refused.
 */
export class ESignSchemaUnavailableError extends Error {
  code = "ESIGN_UNAVAILABLE";
  constructor() {
    super(
      "Electronic signing is unavailable: ESIGN_EXECUTED_ARTIFACT_ENABLED is off, so the consent " +
        "record and executed-artifact schema (migrations 20261014/20261015) must be assumed unapplied.",
    );
    this.name = "ESignSchemaUnavailableError";
  }
}

export class EnvelopeNotSignableError extends Error {
  code = "ENVELOPE_NOT_SIGNABLE";
  constructor(public readonly status: ESignStatus) { super(`Envelope is not in a signable state (${status})`); this.name = "EnvelopeNotSignableError"; }
}

/** Validate the four required consent acknowledgments, normalizing the detailed
 *  IncompleteConsentError to the route-mapped ConsentRequiredError (§1 fail-closed). */
function validateConsentOrThrow(acknowledgments: AcknowledgmentInput[]): void {
  try {
    validateAcknowledgments(acknowledgments ?? []);
  } catch (err) {
    if (err instanceof IncompleteConsentError) throw new ConsentRequiredError();
    throw err;
  }
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

// A terminal signing record is immutable historical evidence. Once an envelope
// reaches any of these states it is never mutated in place; a new attempt must
// archive it (VOIDED/DECLINED/EXPIRED) or is disallowed entirely (COMPLETED).
const TERMINAL_STATUSES: ESignStatus[] = [
  ESignStatus.COMPLETED,
  ESignStatus.VOIDED,
  ESignStatus.DECLINED,
  ESignStatus.EXPIRED,
];
export function isTerminalStatus(status: ESignStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// Every evidence field the current row carries — copied verbatim into the
// immutable history record and cleared on the working row for a fresh attempt.
type EnvelopeRow = NonNullable<Awaited<ReturnType<typeof prisma.eSignEnvelope.findUnique>>>;

/**
 * Read one envelope through the schema gate (see ./esign-schema-gate). With the
 * gate closed the query projects ONLY the columns that exist in the unmigrated
 * production database and the executed-artifact/consent fields are reported as
 * absent; with it open the full row is read. Either way the caller gets the same
 * EnvelopeRow shape, so no downstream code needs to know which state it is in.
 */
async function loadEnvelope(where: Prisma.ESignEnvelopeWhereUniqueInput): Promise<EnvelopeRow | null> {
  const select = envelopeSelect();
  const row = select
    ? await prisma.eSignEnvelope.findUnique({ where, select })
    : await prisma.eSignEnvelope.findUnique({ where });
  return normalizeEnvelope(row);
}

function historySnapshot(e: EnvelopeRow) {
  return {
    dealId: e.dealId,
    envelopeId: e.id,
    attemptNumber: e.attemptNumber,
    status: e.status,
    documentVersionId: e.documentVersionId,
    documentHash: e.documentHash,
    signerUserId: e.signerUserId,
    signerRole: e.signerRole,
    signerName: e.signerName,
    signerEmail: e.signerEmail,
    consentedToElectronic: e.consentedToElectronic,
    consentedAt: e.consentedAt,
    signatureText: e.signatureText,
    signedAt: e.signedAt,
    viewedAt: e.viewedAt,
    ipAddress: e.ipAddress,
    userAgent: e.userAgent,
    declineReason: e.declineReason,
    voidedAt: e.voidedAt,
    voidReason: e.voidReason,
    expiresAt: e.expiresAt,
    completedAt: e.completedAt,
    certificatePdfPath: e.certificatePdfPath,
    sentAt: e.sentAt,
    // Consent record + executed-artifact refs travel with the archived attempt so
    // the frozen consent snapshot and executed copy survive supersession intact.
    consentPolicyVersion: e.consentPolicyVersion,
    consentSnapshot: (e.consentSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
    executedDocumentKey: e.executedDocumentKey,
    executedDocumentHash: e.executedDocumentHash,
    executedGeneratedAt: e.executedGeneratedAt,
  };
}

/**
 * Ensure a prepared in-house signing envelope for a deal, bound to the approved
 * contract by hash. A COMPLETED envelope is final signed evidence — returned
 * unchanged, never reset. A superseded TERMINAL attempt (VOIDED/DECLINED/EXPIRED)
 * is snapshotted into the immutable ESignEnvelopeHistory archive BEFORE the
 * one-per-deal working row is re-initialized as a distinct new attempt, so
 * terminal records are never mutated or recycled. A still-live non-terminal
 * attempt (PENDING/SENT/DELIVERED) is re-bound in place (same attempt). Fails
 * closed if there is no approved document to sign.
 */
export async function prepareBuyerSigningEnvelope(
  dealId: string,
  signer?: { signerUserId?: string; signerName?: string; signerEmail?: string },
): Promise<PrepareResult> {
  // Fail closed before anything is written: a prepared envelope would only lead the
  // buyer to a signature that recordBuyerSignature must then refuse.
  if (!isExecutedArtifactEnabled()) throw new ESignSchemaUnavailableError();
  const existing = await loadEnvelope({ dealId });

  // COMPLETED signed evidence is permanent — never superseded, never reset.
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

  // Fresh-attempt state: bind the current approved document and CLEAR every field
  // from a prior attempt so no stale evidence carries onto the new transaction.
  const freshAttempt = {
    status: ESignStatus.SENT,
    sentAt: new Date(),
    documentVersionId: contract.id,
    documentHash,
    signerRole: SIGNER_ROLE,
    signerUserId: signer?.signerUserId ?? null,
    signerName: signer?.signerName ?? null,
    signerEmail: signer?.signerEmail ?? null,
    consentedToElectronic: false,
    consentedAt: null,
    signatureText: null,
    signedAt: null,
    viewedAt: null,
    ipAddress: null,
    userAgent: null,
    declineReason: null,
    voidedAt: null,
    voidReason: null,
    completedAt: null,
    certificatePdfPath: null,
    certificateGeneratedAt: null,
    // Clear the prior attempt's consent record + executed artifact so nothing
    // carries onto the new transaction (consent is never reused across attempts).
    consentPolicyVersion: null,
    consentSnapshot: Prisma.DbNull,
    executedDocumentKey: null,
    executedDocumentHash: null,
    executedGeneratedAt: null,
    confirmationsSentAt: null,
    expiresAt,
  };

  // Superseding a TERMINAL attempt: preserve it immutably in history, then
  // re-initialize the working row as a distinct new attempt — atomically. A CAS
  // on the observed terminal status ensures exactly one concurrent prepare wins
  // the supersede (so a terminal record is archived exactly once, never twice).
  // Reachable only with the schema gate OPEN (the guard at the top of this function
  // throws otherwise), so e_sign_envelope_history and attempt_number are guaranteed
  // to exist here and the archive is unconditional.
  if (existing && isTerminalStatus(existing.status)) {
    const won = await prisma.$transaction(async (tx) => {
      const swap = await tx.eSignEnvelope.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { ...freshAttempt, attemptNumber: existing.attemptNumber + 1 },
      });
      if (swap.count === 0) return false; // a concurrent prepare already superseded it
      await tx.eSignEnvelopeHistory.create({ data: historySnapshot(existing) });
      return true;
    });
    const current = await loadEnvelope({ id: existing.id });
    if (!current) throw new NoSignableDocumentError();
    void won;
    return {
      envelopeId: current.id,
      documentVersionId: current.documentVersionId ?? contract.id,
      documentHash: current.documentHash ?? documentHash,
      status: current.status,
    };
  }

  // No envelope yet, or a still-live non-terminal attempt (PENDING/SENT/DELIVERED)
  // re-bound to the current approved document — same attempt, safe in place.
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
    // Explicit projection: create/update/upsert emit a RETURNING clause covering
    // every scalar unless narrowed, which would name the gated columns. Only id +
    // status are used, and both exist in every schema state.
    select: { id: true, status: true },
  });

  return { envelopeId: envelope.id, documentVersionId: contract.id, documentHash, status: envelope.status };
}

/**
 * Public gated read of a deal's envelope, for routes and sibling services that
 * need the whole row. Goes through the same schema gate as every internal read,
 * so no caller has to know whether the executed-artifact migrations are applied.
 */
export async function readEnvelopeForDeal(dealId: string): Promise<EnvelopeRow | null> {
  return loadEnvelope({ dealId });
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
  // The four required electronic-signature acknowledgments (§1). Each must be
  // affirmatively accepted; validated server-side against the active consent
  // policy. A typed name / view / click is never consent on its own.
  acknowledgments: AcknowledgmentInput[];
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
  // Consent gate (§1): every required acknowledgment must be affirmatively
  // accepted. Fails closed (ConsentRequiredError) before anything is recorded.
  // A typed name alone is not consent — but an empty adopted name is still invalid.
  // Fail closed: consent_policy_version / consent_snapshot do not exist while the
  // gate is closed, so the frozen per-attempt consent record could not be persisted.
  // Recording a COMPLETED signature anyway would be a false success.
  if (!isExecutedArtifactEnabled()) throw new ESignSchemaUnavailableError();
  validateConsentOrThrow(params.acknowledgments);
  if (!params.signatureText?.trim()) throw new ConsentRequiredError();

  const envelope = await loadEnvelope({ dealId: params.dealId });
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
  // A lapsed signing window is not signable, even if the hourly sweep hasn't run
  // yet: lazily expire it (CAS) and reject, so the TTL is actually enforced and no
  // signature can land on an expired envelope.
  if (envelope.expiresAt && envelope.expiresAt.getTime() < Date.now()) {
    await expireIfElapsed(params.dealId);
    throw new EnvelopeNotSignableError(ESignStatus.EXPIRED);
  }
  if (!envelope.documentVersionId) throw new NoSignableDocumentError();

  const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
  if (!contract || contract.status !== "APPROVED") {
    // The approved document backing this envelope is gone/superseded → re-issue.
    await voidEnvelopeInternal(params.dealId, "Approved contract no longer available");
    throw new DocumentChangedError();
  }

  // Tamper check (§3): the bytes signed MUST match the bytes bound at prepare
  // time. Recomputed immediately before completion; consent is then bound to THIS
  // exact hash + version, so it can never be reattributed to a changed document.
  const currentHash = await computeDocumentHash(contract.documentUrl);
  if (currentHash !== envelope.documentHash) {
    await voidEnvelopeInternal(params.dealId, "Contract document changed after signing began");
    throw new DocumentChangedError();
  }

  const now = new Date();
  // Frozen per-attempt consent snapshot, bound to the exact version + hash just
  // validated. Persisted verbatim (append-only) — a future policy change never
  // rewrites it.
  const consentSnapshot = buildConsentSnapshot({
    signerUserId: params.signerUserId,
    signerName: params.signerName,
    signerRole: SIGNER_ROLE,
    signerEmail: params.signerEmail,
    documentVersionId: contract.id,
    documentVersion: contract.version,
    documentHash: currentHash,
    consentedAt: now,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

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
        consentPolicyVersion: CONSENT_POLICY_VERSION,
        consentSnapshot: consentSnapshot as unknown as Prisma.InputJsonValue,
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
    // Append-only CONSENT_ACCEPTED audit event (§2) — the full attribution + the
    // exact acknowledgments, bound to the document version + hash.
    await tx.adminAuditLog.create({
      data: {
        adminId: "system",
        adminEmail: "system@autolenis.com",
        action: "CONSENT_ACCEPTED",
        entityType: "ESignEnvelope",
        entityId: envelope.id,
        reason: `Buyer accepted all e-signature consent acknowledgments (${CONSENT_POLICY_VERSION})`,
        metadata: {
          dealId: params.dealId,
          signerUserId: params.signerUserId,
          signerRole: SIGNER_ROLE,
          consentPolicyVersion: CONSENT_POLICY_VERSION,
          documentVersionId: contract.id,
          documentVersion: contract.version,
          documentHash: currentHash,
          acknowledgments: consentSnapshot.acknowledgments.map((a) => ({ key: a.key, accepted: a.accepted })),
          consentedAt: now.toISOString(),
          ipAddress: params.ipAddress,
        } as Prisma.InputJsonValue,
      },
    });
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

/** Buyer declines to sign — truthful terminal exception; deal is NOT advanced.
 *  No-op on an already-terminal record: a terminal signing record is immutable and
 *  never cross-transitioned (e.g. VOIDED must not become DECLINED). */
export async function declineBuyerSignature(dealId: string, reason?: string): Promise<void> {
  const envelope = await loadEnvelope({ dealId });
  if (!envelope || isTerminalStatus(envelope.status)) return;
  // CAS on the observed non-terminal status so we can never overwrite a record
  // that became terminal concurrently.
  const swap = await prisma.eSignEnvelope.updateMany({
    where: { id: envelope.id, status: envelope.status },
    data: { status: ESignStatus.DECLINED, declineReason: reason ?? "Declined by buyer" },
  });
  if (swap.count === 0) return;
  await writeExceptionAudit(dealId, envelope.id, "ESIGN_ENVELOPE_DECLINED", reason);
}

/** Void a signing envelope (admin action or internal re-issue). Deal not advanced.
 *  No-op on an already-terminal record — terminal signing records are immutable. */
export async function voidEnvelopeInternal(dealId: string, reason: string): Promise<void> {
  const envelope = await loadEnvelope({ dealId });
  if (!envelope || isTerminalStatus(envelope.status)) return;
  const swap = await prisma.eSignEnvelope.updateMany({
    where: { id: envelope.id, status: envelope.status },
    data: { status: ESignStatus.VOIDED, voidedAt: new Date(), voidReason: reason },
  });
  if (swap.count === 0) return;
  await writeExceptionAudit(dealId, envelope.id, "ESIGN_ENVELOPE_VOIDED", reason);
}

// ── Scheduled sweeps (§8/§9) ─────────────────────────────────────────────────

/** Statuses a still-live signing attempt can be in (non-terminal, expirable). */
const EXPIRABLE_STATUSES: ESignStatus[] = [ESignStatus.SENT, ESignStatus.DELIVERED, ESignStatus.PENDING];

/**
 * Bulk expiry sweep (§9): transition every prepared-but-unsigned envelope past its
 * expiresAt to EXPIRED. Per-row compare-and-swap on the observed non-terminal
 * status, so it can NEVER expire a COMPLETED (or any other terminal) record or
 * mutate a state that changed concurrently. Idempotent (already-EXPIRED rows are
 * excluded by the status filter) and audited per transition. Terminal-history is
 * preserved: an EXPIRED record stays the current attempt until a subsequent
 * authorized prepare archives it — this sweep never writes history directly.
 */
export async function sweepExpiredEnvelopes(limit = 500): Promise<{ scanned: number; expired: number }> {
  const now = new Date();
  const candidates = await prisma.eSignEnvelope.findMany({
    where: { status: { in: EXPIRABLE_STATUSES }, expiresAt: { lt: now } },
    select: { id: true, dealId: true, status: true },
    take: limit,
  });
  let expired = 0;
  for (const c of candidates) {
    const swap = await prisma.eSignEnvelope.updateMany({
      where: { id: c.id, status: c.status }, // CAS: only if still the observed non-terminal status
      data: { status: ESignStatus.EXPIRED },
    });
    if (swap.count === 1) {
      expired += 1;
      await writeExceptionAudit(c.dealId, c.id, "ESIGN_ENVELOPE_EXPIRED", "Signing window elapsed");
    }
  }
  return { scanned: candidates.length, expired };
}

/**
 * Durability reconciliation sweep (§8): for every COMPLETED envelope still missing
 * its executed artifact, certificate, or confirmations, re-drive
 * finalizeSignedContract from the frozen evidence. Idempotent and immutable-safe
 * (guarded writes never touch an existing artifact). Repeated/unrecoverable
 * failures are surfaced via logger.error (Sentry — the existing operational-
 * exception rail): a COMPLETED envelope that stays unfinalized past the grace
 * window is logged as an operational exception rather than silently retried
 * forever. No new recovery engine.
 */
export interface ReconcileSignedContractsResult {
  /** True when the sweep did no work because the schema gate is closed. */
  skipped: boolean;
  /** Machine-readable reason, present only when skipped. */
  reason?: "executed_artifact_disabled";
  scanned: number;
  finalized: number;
  pending: number;
  stuck: number;
}

export async function reconcileSignedContracts(
  limit = 100,
): Promise<ReconcileSignedContractsResult> {
  // The whole sweep filters and writes on executed_document_key /
  // confirmations_sent_at. With migrations 20261014/20261015 unapplied those
  // columns do not exist and the query is a guaranteed 42703, which is exactly
  // why this cron failed 100% of the time. Report a truthful skip — counters
  // stay zero and `skipped` says why, so the run is never mistaken for a sweep
  // that found nothing to do.
  if (!isExecutedArtifactEnabled()) {
    return { skipped: true, reason: "executed_artifact_disabled", scanned: 0, finalized: 0, pending: 0, stuck: 0 };
  }
  const STUCK_AFTER_MS = 60 * 60 * 1000; // 1 hour
  const now = Date.now();
  const pendingEnvelopes = await prisma.eSignEnvelope.findMany({
    where: {
      status: ESignStatus.COMPLETED,
      // In-house envelopes only — a legacy DocuSign-completed envelope has no
      // documentVersionId and no in-house executed artifact to generate, so it
      // must never be picked up here (it would reconcile forever and log noise).
      documentVersionId: { not: null },
      OR: [
        { executedDocumentKey: null },
        { certificatePdfPath: null },
        { confirmationsSentAt: null },
      ],
    },
    select: { dealId: true, completedAt: true },
    take: limit,
  });

  let finalized = 0;
  let pending = 0;
  let stuck = 0;
  for (const env of pendingEnvelopes) {
    const result = await finalizeSignedContract(env.dealId);
    if (result.artifactReady && result.certificateReady && result.confirmationsSent) {
      finalized += 1;
    } else {
      pending += 1;
      const ageMs = env.completedAt ? now - env.completedAt.getTime() : 0;
      if (ageMs > STUCK_AFTER_MS) {
        stuck += 1;
        logger.error(
          `[esign-artifact-reconcile] COMPLETED envelope for deal ${env.dealId} still unfinalized after ` +
            `${Math.round(ageMs / 60000)}m (artifact=${result.artifactReady} cert=${result.certificateReady} ` +
            `confirmations=${result.confirmationsSent}) — operational exception, manual review needed`,
        );
      }
    }
  }
  return { skipped: false, scanned: pendingEnvelopes.length, finalized, pending, stuck };
}

/** Lazy expiry: mark a prepared-but-unsigned envelope EXPIRED once past its TTL.
 *  Compare-and-swap on the OBSERVED non-terminal status so a signature that
 *  completes concurrently (SENT→COMPLETED between the read and the write) can never
 *  be overwritten to EXPIRED — a terminal signed record stays immutable. */
export async function expireIfElapsed(dealId: string): Promise<boolean> {
  const envelope = await loadEnvelope({ dealId });
  if (!envelope || !envelope.expiresAt) return false;
  const signable = envelope.status === "SENT" || envelope.status === "DELIVERED" || envelope.status === "PENDING";
  if (signable && envelope.expiresAt.getTime() < Date.now()) {
    const swap = await prisma.eSignEnvelope.updateMany({
      where: { id: envelope.id, status: envelope.status }, // CAS: only if still the observed signable status
      data: { status: ESignStatus.EXPIRED },
    });
    if (swap.count === 0) return false; // it changed under us (e.g. completed) — do not touch it
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
    const envelope = await loadEnvelope({ dealId });
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

// ── Executed-contract artifact + confirmation sequencing (§4/§5/§7/§8) ────────

export interface FinalizeSignedContractResult {
  artifactReady: boolean;
  certificateReady: boolean;
  confirmationsSent: boolean;
}

/**
 * Finalize a COMPLETED signature in the correct order (§7): generate + store the
 * executed contract artifact FIRST, then the evidence certificate, then — only
 * once BOTH are durably available — emit the buyer/dealer "signed contract is
 * ready" confirmations exactly once. A generation failure never discards the
 * (already-committed) signature evidence; it simply leaves confirmations unsent so
 * the reconciliation cron re-drives (§8). Idempotent and safe to re-run: the
 * artifact write is guarded (immutable once set), and confirmations are gated by a
 * one-way marker + per-channel idempotency. Best-effort — never throws.
 */
export async function finalizeSignedContract(dealId: string): Promise<FinalizeSignedContractResult> {
  const notReady: FinalizeSignedContractResult = { artifactReady: false, certificateReady: false, confirmationsSent: false };
  // Gate closed → the executed-artifact and confirmation columns do not exist, so
  // there is nothing that can be finalized. Report NOT ready rather than a
  // vacuous success: an unfinalized signature must stay visibly unfinalized.
  if (!isExecutedArtifactEnabled()) return notReady;
  try {
    const envelope = await loadEnvelope({ dealId });
    if (!envelope || envelope.status !== "COMPLETED") return notReady;

    // 1) Executed artifact — generated from FROZEN evidence, immutable once set.
    const artifactKey = await ensureExecutedArtifact(envelope);
    if (!artifactKey) return notReady; // gen failed → do NOT confirm; cron re-drives

    // 2) Evidence certificate (idempotent).
    const certPath = await finalizeBuyerSignatureCertificate(dealId);
    if (!certPath) return { artifactReady: true, certificateReady: false, confirmationsSent: false };

    // 3) Confirmations — only now that artifact + certificate both exist.
    const confirmationsSent = await emitSignatureConfirmations(dealId);
    return { artifactReady: true, certificateReady: true, confirmationsSent };
  } catch (err) {
    logger.error("[buyer-signing] finalizeSignedContract failed (non-fatal):", err);
    return notReady;
  }
}

/**
 * Ensure the executed-contract artifact exists for a COMPLETED envelope, returning
 * its storage key (or null if it can't be produced yet). Generated from the frozen
 * attempt evidence (pinned ContractVersion + hash + consent snapshot + adopted
 * signature). The DB reference is written with a null-only guard so a completed
 * artifact is NEVER overwritten/regenerated by later app-data changes (§5).
 */
async function ensureExecutedArtifact(envelope: EnvelopeRow): Promise<string | null> {
  if (!isExecutedArtifactEnabled()) return null; // no executed_document_key column to write
  if (envelope.executedDocumentKey) return envelope.executedDocumentKey; // already set → immutable
  if (!envelope.documentVersionId || !envelope.documentHash || !envelope.signedAt) return null;

  const contract = await prisma.contractVersion.findUnique({ where: { id: envelope.documentVersionId } });
  if (!contract) return null;

  const consentSnapshot = (envelope.consentSnapshot as unknown as ConsentSnapshot | null) ?? null;
  const result = await generateAndUploadExecutedContract({
    envelopeId: envelope.id,
    dealId: envelope.dealId,
    signerName: envelope.signerName ?? "AutoLenis Buyer",
    signerEmail: envelope.signerEmail ?? "",
    signerUserId: envelope.signerUserId ?? "",
    signerRole: envelope.signerRole ?? SIGNER_ROLE,
    documentVersionId: envelope.documentVersionId,
    documentVersion: contract.version,
    documentUrl: contract.documentUrl,
    documentHash: envelope.documentHash,
    signatureText: envelope.signatureText ?? "",
    signedAt: envelope.signedAt,
    consentedAt: envelope.consentedAt ?? envelope.signedAt,
    consentPolicyVersion: envelope.consentPolicyVersion,
    consentSnapshot,
    certificateReference: envelope.certificatePdfPath ?? envelope.id,
  });
  if (!result) return null;

  // Guarded null-only write — immutable: a concurrent finalize or a later app-data
  // change can never clobber an already-recorded executed artifact.
  await prisma.eSignEnvelope.updateMany({
    where: { id: envelope.id, executedDocumentKey: null },
    data: {
      executedDocumentKey: result.key,
      executedDocumentHash: result.hash,
      executedGeneratedAt: new Date(),
    },
  });
  const fresh = await prisma.eSignEnvelope.findUnique({
    where: { id: envelope.id },
    select: { executedDocumentKey: true },
  });
  return fresh?.executedDocumentKey ?? result.key;
}

/**
 * Emit the buyer + dealer "your signed contract is ready" confirmations, only
 * after the executed artifact + certificate are both available. Gated by the
 * one-way confirmationsSentAt marker so the normal re-drive path never re-sends.
 * Each channel is independently idempotent against that path: the buyer email is
 * exactly-once (EmailSendLog idempotency key); the dealer in-app notification is
 * deduped on a stable metadata key (best-effort — a check-then-insert, so two
 * truly-concurrent first runs could in principle create two rows; the CRM event is
 * likewise at-least-once). Returns true if this call emitted (or confirmed) them.
 */
async function emitSignatureConfirmations(dealId: string): Promise<boolean> {
  // Without confirmations_sent_at there is no exactly-once marker, so sending
  // would risk re-notifying the buyer and dealer on every sweep. Do not send.
  if (!isExecutedArtifactEnabled()) return false;
  const envelope = await loadEnvelope({ dealId });
  if (!envelope || envelope.status !== "COMPLETED") return false;
  if (!envelope.executedDocumentKey || !envelope.certificatePdfPath) return false; // artifact not ready
  if (envelope.confirmationsSentAt) return true; // already sent

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      buyer: { include: { user: { select: { email: true } } } },
      offer: { select: { dealerId: true, dealer: { select: { isSystemPlaceholder: true } } } },
    },
  });
  if (!deal) return false;

  const buyerEmail = deal.buyer?.user?.email ?? envelope.signerEmail ?? "";
  const firstName = deal.buyer?.firstName ?? "there";

  // Buyer CRM event (best-effort).
  try {
    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("contract_signed", {
      domainEntityId: dealId,
      contact: {
        email: buyerEmail || null,
        phone: deal.buyer?.phone ?? null,
        firstName: deal.buyer?.firstName,
        lastName: deal.buyer?.lastName,
        source: "buyer_signup",
      },
      data: { deal_id: dealId, envelope_id: envelope.id, buyer_id: deal.buyerId },
    });
  } catch (err) {
    logger.error("[buyer-signing] contract_signed emit failed (non-fatal):", err);
  }

  // Buyer confirmation email (idempotent).
  try {
    if (buyerEmail) {
      const { sendContractSignedEmail } = await import("@/lib/services/email/resend.service");
      await sendContractSignedEmail({ to: buyerEmail, firstName, dealId, envelopeId: envelope.id });
    }
  } catch (err) {
    logger.error("[buyer-signing] buyer confirmation email failed (non-fatal):", err);
  }

  // Dealer notification — contract EXECUTED (dealer did not sign; a copy is
  // available). Registered dealers only; deduped on a stable metadata key.
  try {
    const dealerId = deal.offer?.dealerId ?? null;
    const isPlaceholder = deal.offer?.dealer?.isSystemPlaceholder ?? false;
    if (dealerId && !isPlaceholder) {
      const dedupeKey = `esign-executed:${dealId}:${envelope.id}`;
      const existing = await prisma.notification.findFirst({
        where: { dealerId, metadata: { path: ["key"], equals: dedupeKey } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.notification.create({
          data: {
            dealerId,
            type: NotificationType.DEAL_STAGE_CHANGED,
            title: "Purchase contract executed",
            body:
              "The buyer has electronically signed the purchase contract. " +
              "An executed copy is available in your deal record.",
            actionUrl: `/dealer/deals/${dealId}`,
            metadata: { key: dedupeKey, dealId, envelopeId: envelope.id, kind: "ESIGN_EXECUTED" },
          },
        });
      }
    }
  } catch (err) {
    logger.error("[buyer-signing] dealer execution notification failed (non-fatal):", err);
  }

  // One-way marker (guarded) so confirmations are not re-sent on the next re-drive.
  await prisma.eSignEnvelope.updateMany({
    where: { id: envelope.id, confirmationsSentAt: null },
    data: { confirmationsSentAt: new Date() },
  });
  return true;
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
