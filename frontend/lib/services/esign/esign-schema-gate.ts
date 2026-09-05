// lib/services/esign/esign-schema-gate.ts
//
// THE single switch for the deploy-ahead-of-migration boundary on the e-sign
// schema.
//
// Migrations 20261014000000_esign_envelope_history and
// 20261015000000_esign_consent_and_executed_artifact are owner-gated:
// ESIGN/UETA legal sufficiency is NOT VERIFIED and the consent policy is
// blocked pending attorney/compliance review. The Prisma schema already
// declares everything those migrations add. Prisma always emits an EXPLICIT
// column list in its generated SQL, so against a database that LACKS those
// objects any unprojected read, any write naming one of those columns, and any
// query against e_sign_envelope_history fails with 42703 (undefined_column) /
// 42P01 (undefined_table).
//
// PRODUCTION SCHEMA STATUS — CORRECTED 2026-09-05. An earlier version of this
// comment asserted that production had 28 columns on e_sign_envelopes and no
// e_sign_envelope_history table. That assertion is STALE and was wrong. An
// owner-run read-only probe on 2026-09-05 measured production as:
// e_sign_envelopes 35 columns, e_sign_envelope_history PRESENT with 32 columns.
// The objects both migrations add ARE physically present; what was missing was
// only the _prisma_migrations ledger record, reconciled under
// docs/transaction-flow/IMPLEMENTATION-WORKFLOW.md §6.2 / §13-D1.
//
// So this module is NO LONGER a schema-compatibility gate. Its live purpose is
// the COMPLIANCE gate (§13-D4): the executed-artifact / consent-snapshot
// behaviour stays off until attorney/compliance sign-off, independently of the
// schema. It answers exactly one question — "may this process touch the columns
// and tables those two migrations add?" — and every e-sign caller routes its
// reads and writes through the helpers here instead of asking Prisma for the
// full row. The projection helpers below are retained deliberately: they are
// what makes the flag safe to leave off against a fully migrated database.
//
// Defaults to OFF, and STAYS OFF until the compliance sign-off recorded in
// §13-D4 exists. The default is a compliance decision, not a schema one — do
// not flip it because the schema check now passes.
//
// Follows the established CRM_INAPP_ENGINE_ENABLED cutover-flag pattern
// (app/api/cron/lead-magnet-sequence/route.ts): strict === "true", default off.

import { Prisma } from "@prisma/client";
import type { ESignEnvelope } from "@prisma/client";

/** Env var name — exported so tests and operational docs reference one string. */
export const ESIGN_EXECUTED_ARTIFACT_FLAG = "ESIGN_EXECUTED_ARTIFACT_ENABLED";

/**
 * True only when the owner has explicitly activated the executed-artifact /
 * consent-record schema AFTER applying migrations 20261014 + 20261015.
 * Default OFF — an unset, empty, "1", or "TRUE" value all read as disabled, so
 * the gate can only be opened deliberately.
 */
export function isExecutedArtifactEnabled(): boolean {
  return process.env[ESIGN_EXECUTED_ARTIFACT_FLAG] === "true";
}

/**
 * The columns the two unapplied migrations add to e_sign_envelopes, with the
 * value each read must report while the gate is closed. These are not
 * placeholders standing in for real data: with the migration unapplied no
 * consent snapshot and no executed artifact can exist, so null/1 IS the truth.
 * `attemptNumber` mirrors the migration's own `DEFAULT 1`.
 */
export const GATED_ENVELOPE_DEFAULTS = {
  consentPolicyVersion: null,
  consentSnapshot: null,
  executedDocumentKey: null,
  executedDocumentHash: null,
  executedGeneratedAt: null,
  confirmationsSentAt: null,
  attemptNumber: 1,
} as const;

/**
 * Explicit projection of ONLY the 28 columns that exist in production before the
 * migrations are applied. Every gated read uses this instead of letting Prisma
 * expand the model's full scalar list.
 */
export const LEGACY_ENVELOPE_SELECT = {
  id: true,
  dealId: true,
  docusignEnvelopeId: true,
  status: true,
  documentKey: true,
  sentAt: true,
  completedAt: true,
  voidedAt: true,
  voidReason: true,
  documentVersionId: true,
  documentHash: true,
  signerUserId: true,
  signerRole: true,
  signerName: true,
  signerEmail: true,
  consentedToElectronic: true,
  consentedAt: true,
  signatureText: true,
  signedAt: true,
  viewedAt: true,
  ipAddress: true,
  userAgent: true,
  declineReason: true,
  expiresAt: true,
  certificatePdfPath: true,
  certificateGeneratedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ESignEnvelopeSelect;

type LegacyEnvelopeRow = Prisma.ESignEnvelopeGetPayload<{ select: typeof LEGACY_ENVELOPE_SELECT }>;

/**
 * The envelope columns a BUYER-facing surface may read. LEGACY_ENVELOPE_SELECT is
 * the full forensic record (ipAddress, userAgent, signerEmail, signatureText,
 * voidReason, declineReason, internal identifiers) and must never back a buyer or
 * dealer response — see the allow-list rule at the top of ./esign-dto.ts. This is
 * the buyer allow-list: exactly what BuyerEnvelopeSummary exposes, and nothing more.
 */
export const BUYER_SAFE_ENVELOPE_SELECT = {
  status: true,
  documentVersionId: true,
  documentHash: true,
  sentAt: true,
  viewedAt: true,
  consentedAt: true,
  signedAt: true,
  completedAt: true,
  expiresAt: true,
  certificatePdfPath: true,
} satisfies Prisma.ESignEnvelopeSelect;

/**
 * The buyer allow-list, plus the two gated columns BuyerEnvelopeSummary reports on
 * — but only once the migrations are applied and the gate is open.
 */
export function buyerEnvelopeSelect() {
  return isExecutedArtifactEnabled()
    ? { ...BUYER_SAFE_ENVELOPE_SELECT, consentPolicyVersion: true, executedDocumentKey: true }
    : BUYER_SAFE_ENVELOPE_SELECT;
}

/**
 * Fill in the gated fields a buyer projection omits while the gate is closed, so
 * the row satisfies the DTO shaper. Real values (gate open) always win.
 */
export function withBuyerGatedDefaults<T extends object>(row: T) {
  return { consentPolicyVersion: null, executedDocumentKey: null, ...row };
}

/**
 * Widen a legacy (28-column) row back to the full ESignEnvelope shape by filling
 * the gated fields with their truthful "not available" values. Keeping the type
 * stable in both gate states means callers and DTOs need no conditional typing.
 */
export function withGatedDefaults(row: LegacyEnvelopeRow): ESignEnvelope {
  return { ...row, ...GATED_ENVELOPE_DEFAULTS } as ESignEnvelope;
}

/**
 * The `select` an envelope read should use: undefined (full row) when the gate is
 * open, the legacy projection when it is closed.
 */
export function envelopeSelect(): typeof LEGACY_ENVELOPE_SELECT | undefined {
  return isExecutedArtifactEnabled() ? undefined : LEGACY_ENVELOPE_SELECT;
}

/**
 * Normalize whatever a gated read returned into a full ESignEnvelope. A row read
 * with the gate open is already complete; one read with the gate closed is
 * widened with the gated defaults.
 */
export function normalizeEnvelope<T extends LegacyEnvelopeRow | ESignEnvelope | null>(
  row: T,
): ESignEnvelope | null {
  if (!row) return null;
  if (isExecutedArtifactEnabled()) return row as ESignEnvelope;
  return withGatedDefaults(row as LegacyEnvelopeRow);
}
