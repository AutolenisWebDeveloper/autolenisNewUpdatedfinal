// lib/services/esign/envelope-schema.ts
//
// The e-sign schema gate. Prisma's ESignEnvelope model describes SEVEN columns
// that do not exist in the production database, and one whole table
// (ESignEnvelopeHistory) that does not exist either, because migrations
// 20261014000000_esign_envelope_history and
// 20261015000000_esign_consent_and_executed_artifact are deliberately unapplied
// pending attorney/compliance review of consent policy DRAFT_V1.
//
// Missing columns on e_sign_envelopes:
//   consent_policy_version, consent_snapshot, executed_document_key,
//   executed_document_hash, executed_generated_at, confirmations_sent_at,
//   attempt_number
//
// Prisma selects EVERY scalar on a model unless a `select` narrows it, so a bare
// `include: { eSignEnvelope: true }` — or a bare findUnique/findMany on the
// envelope — asks Postgres for columns that are not there and throws
// "The column e_sign_envelopes.executed_document_key does not exist in the
// current database". That is the exact error that has failed the
// esign-artifact-reconcile cron on 283 of 283 runs in the last 24 hours, and it
// is latent across the buyer signing, pickup, and contract-download paths. Only
// the fact that production holds zero deals has kept it from surfacing to a
// buyer: the FIRST real deal would hit an unrecoverable error at signing and
// again at pickup.
//
// This module is the single place that knows which shape is real. Every read
// narrows through `esignEnvelopeSelect()`, and every write strips the gated
// fields through `gateEnvelopeWrite()`, so no call site has to remember.
//
// The gate is a kill-switch that DEFAULTS OFF, matching the existing
// CRM_INAPP_ENGINE_ENABLED pattern (app/api/cron/lead-magnet-sequence). Turning
// it on is only correct AFTER the owner applies the two migrations; until then
// "off" is the truthful description of the database.
//
// This file imports only Prisma's TYPES (erased at runtime) — it stays pure
// shape/flag logic usable from services, routes, and tests alike.

import type { Prisma } from "@prisma/client";

/**
 * True only when the extended e-sign columns/table physically exist.
 *
 * DEFAULT OFF. Enable with ESIGN_EXTENDED_SCHEMA_ENABLED=true, and only once
 * migrations 20261014000000 and 20261015000000 are applied.
 */
export function isEsignExtendedSchemaEnabled(): boolean {
  return process.env.ESIGN_EXTENDED_SCHEMA_ENABLED === "true";
}

/**
 * Every ESignEnvelope column that is physically present in production today.
 * Kept as an explicit literal (not a derived omission) so adding a field to the
 * Prisma model can never silently widen a query back into a missing column.
 */
export const ESIGN_ENVELOPE_BASE_SELECT = {
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
} as const;

/** The seven columns the unapplied migration would add. */
export const ESIGN_ENVELOPE_EXTENDED_FIELDS = [
  "consentPolicyVersion",
  "consentSnapshot",
  "executedDocumentKey",
  "executedDocumentHash",
  "executedGeneratedAt",
  "confirmationsSentAt",
  "attemptNumber",
] as const;

export type EsignEnvelopeExtendedField = (typeof ESIGN_ENVELOPE_EXTENDED_FIELDS)[number];

export const ESIGN_ENVELOPE_EXTENDED_SELECT = {
  ...ESIGN_ENVELOPE_BASE_SELECT,
  consentPolicyVersion: true,
  consentSnapshot: true,
  executedDocumentKey: true,
  executedDocumentHash: true,
  executedGeneratedAt: true,
  confirmationsSentAt: true,
  attemptNumber: true,
} as const;

/**
 * The `select` every ESignEnvelope read must use. Never issue a bare
 * `include: { eSignEnvelope: true }` or an unnarrowed envelope query.
 */
export function esignEnvelopeSelect() {
  return isEsignExtendedSchemaEnabled()
    ? ESIGN_ENVELOPE_EXTENDED_SELECT
    : ESIGN_ENVELOPE_BASE_SELECT;
}

/** The shape a narrowed read returns when the gate is off. */
export type EsignEnvelopeBaseRow = {
  -readonly [K in keyof typeof ESIGN_ENVELOPE_BASE_SELECT]: unknown;
};

/**
 * The values the gated-off columns take. These are not placeholders standing in
 * for data that exists — with the migration unapplied there IS no consent
 * snapshot, no executed artifact and no confirmation marker, so "absent" is the
 * truthful reading, and attempt 1 is the only attempt the schema can express.
 */
/**
 * The value types of the gated columns. Declared explicitly (rather than
 * inferred from the defaults literal) so a normalized row keeps a usable type:
 * an `as const` literal would intersect to `never` for any caller whose row
 * already carries a real value for one of these fields — i.e. every caller in
 * the gate-ON world.
 */
export interface EsignEnvelopeExtendedValues {
  consentPolicyVersion: string | null;
  // Matches Prisma's Json? column type so a normalized row stays assignable to
  // the generated ESignEnvelope shape (the admin evidence export needs that).
  consentSnapshot: Prisma.JsonValue | null;
  executedDocumentKey: string | null;
  executedDocumentHash: string | null;
  executedGeneratedAt: Date | null;
  confirmationsSentAt: Date | null;
  attemptNumber: number;
}

export const ESIGN_ENVELOPE_EXTENDED_DEFAULTS: EsignEnvelopeExtendedValues = {
  consentPolicyVersion: null,
  consentSnapshot: null,
  executedDocumentKey: null,
  executedDocumentHash: null,
  executedGeneratedAt: null,
  confirmationsSentAt: null,
  attemptNumber: 1,
};

/** A narrowed row normalized to the full envelope shape. */
export type EsignEnvelopeView<T> = Omit<T, keyof EsignEnvelopeExtendedValues> &
  EsignEnvelopeExtendedValues;

/**
 * Normalize a narrowed row to the full envelope shape so consumers read one
 * type whether or not the gate is on. Returns null for a null row.
 */
export function toEnvelopeView<T extends object>(
  row: T | null | undefined,
): EsignEnvelopeView<T> | null {
  if (!row) return null;
  if (isEsignExtendedSchemaEnabled()) {
    return row as unknown as EsignEnvelopeView<T>;
  }
  return { ...ESIGN_ENVELOPE_EXTENDED_DEFAULTS, ...row } as unknown as EsignEnvelopeView<T>;
}

/**
 * Strip the gated columns out of a write payload when the gate is off, so an
 * update/create never names a column Postgres does not have. Returns the payload
 * unchanged when the gate is on.
 */
export function gateEnvelopeWrite<T extends Record<string, unknown>>(data: T): Partial<T> {
  if (isEsignExtendedSchemaEnabled()) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if ((ESIGN_ENVELOPE_EXTENDED_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * A `where` fragment that filters on gated columns is equally unsafe. When the
 * gate is off the extended columns are all conceptually null/absent, so a filter
 * for "missing artifact / missing confirmations" matches everything and a filter
 * for "has an artifact" matches nothing — callers should not run those sweeps at
 * all. This predicate exists so they can say so explicitly rather than silently
 * querying a column that is not there.
 */
export function canQueryExtendedEnvelopeFields(): boolean {
  return isEsignExtendedSchemaEnabled();
}

/**
 * Raised when a code path genuinely cannot degrade — specifically, superseding a
 * TERMINAL signing attempt requires archiving it into ESignEnvelopeHistory, and
 * that table does not exist. Proceeding without the archive would MUTATE
 * immutable terminal signing evidence, so the path fails closed instead.
 */
export class EsignExtendedSchemaUnavailableError extends Error {
  code = "ESIGN_EXTENDED_SCHEMA_UNAVAILABLE";
  constructor(what: string) {
    super(
      `${what} requires the e-sign consent/history schema, which is not applied in this database. ` +
        `Set ESIGN_EXTENDED_SCHEMA_ENABLED=true only after migrations 20261014000000 and ` +
        `20261015000000 are applied.`,
    );
    this.name = "EsignExtendedSchemaUnavailableError";
  }
}
