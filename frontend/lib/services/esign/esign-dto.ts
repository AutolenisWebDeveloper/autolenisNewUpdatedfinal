// lib/services/esign/esign-dto.ts
//
// Server-side DTO shaping for e-sign records (§11/§12). Customer- and dealer-
// facing surfaces receive ONLY a safe summary; raw forensic evidence (IP address,
// user-agent, the consent snapshot's embedded attribution, internal security
// identifiers, audit metadata) is NEVER serialized to buyer/dealer responses.
// This boundary is enforced HERE (in the shape of the returned object), not by
// hiding fields in the frontend. The full forensic package is admin-only.
//
// Keep these shapers as allow-lists (construct the exact safe object) rather than
// deny-lists (delete keys), so a newly-added sensitive column can never leak by
// default into a customer/dealer response.

import type { ESignEnvelope, ESignEnvelopeHistory } from "@prisma/client";

// A minimal structural type so these shapers accept either the current envelope
// row or an archived history row (both carry the same evidence columns).
type EvidenceLike = Pick<
  ESignEnvelope,
  | "status"
  | "documentVersionId"
  | "documentHash"
  | "consentPolicyVersion"
  | "viewedAt"
  | "consentedAt"
  | "signedAt"
  | "completedAt"
  | "expiresAt"
  | "executedDocumentKey"
  | "certificatePdfPath"
> & { attemptNumber?: number };

const TERMINAL = new Set(["COMPLETED", "VOIDED", "DECLINED", "EXPIRED"]);

// ── Buyer-safe summary ───────────────────────────────────────────────────────
export interface BuyerEnvelopeSummary {
  status: string | null;
  terminal: boolean;
  documentVersionId: string | null;
  documentHash: string | null; // the buyer's own signed-document fingerprint (also on their certificate)
  consentPolicyVersion: string | null;
  viewedAt: Date | null;
  consentedAt: Date | null;
  signedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  executedContractAvailable: boolean;
  certificateAvailable: boolean;
}

export function toBuyerEnvelopeSummary(e: EvidenceLike | null | undefined): BuyerEnvelopeSummary | null {
  if (!e) return null;
  return {
    status: e.status ?? null,
    terminal: e.status ? TERMINAL.has(e.status) : false,
    documentVersionId: e.documentVersionId ?? null,
    documentHash: e.documentHash ?? null,
    consentPolicyVersion: e.consentPolicyVersion ?? null,
    viewedAt: e.viewedAt ?? null,
    consentedAt: e.consentedAt ?? null,
    signedAt: e.signedAt ?? null,
    completedAt: e.completedAt ?? null,
    expiresAt: e.expiresAt ?? null,
    executedContractAvailable: e.status === "COMPLETED" && !!e.executedDocumentKey,
    certificateAvailable: !!e.certificatePdfPath,
  };
}

// ── Dealer-safe summary (a copy recipient, not a signer) ─────────────────────
export interface DealerEnvelopeSummary {
  status: string | null;
  terminal: boolean;
  documentVersionId: string | null;
  signedAt: Date | null;
  completedAt: Date | null;
  executedContractAvailable: boolean;
}

export function toDealerEnvelopeSummary(e: EvidenceLike | null | undefined): DealerEnvelopeSummary | null {
  if (!e) return null;
  return {
    status: e.status ?? null,
    terminal: e.status ? TERMINAL.has(e.status) : false,
    documentVersionId: e.documentVersionId ?? null,
    signedAt: e.signedAt ?? null,
    completedAt: e.completedAt ?? null,
    executedContractAvailable: e.status === "COMPLETED" && !!e.executedDocumentKey,
  };
}

// ── Admin full evidence package (authz + audit protected at the route) ───────
// The complete record, including raw forensic evidence, for admin export only.
export interface AdminEvidencePackage {
  envelope: ESignEnvelope;
  history: ESignEnvelopeHistory[];
}

export function toAdminEvidencePackage(
  envelope: ESignEnvelope,
  history: ESignEnvelopeHistory[],
): AdminEvidencePackage {
  return { envelope, history };
}
