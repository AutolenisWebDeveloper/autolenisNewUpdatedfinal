// The e-sign deploy-ahead-of-migration gate (lib/services/esign/esign-schema-gate.ts).
//
// Migrations 20261014 + 20261015 are authored but deliberately UNAPPLIED, while the
// Prisma schema already declares everything they add. These tests pin the gate that
// keeps the app from asking the database for columns and tables it does not have,
// and pin the gate-CLOSED behaviour of the executed-artifact service paths.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/esign/__tests__/esign-schema-gate.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

mock.module("server-only", { namedExports: {} });

// Any read reaching Prisma while the gate is closed is a leak; these throw the way
// the real database does when a column or table is absent.
let envelopeQueries = 0;
let historyQueries = 0;
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findMany: async () => { envelopeQueries += 1; throw new Error("42703 undefined_column"); },
        findUnique: async () => { envelopeQueries += 1; throw new Error("42703 undefined_column"); },
      },
      eSignEnvelopeHistory: {
        findMany: async () => { historyQueries += 1; throw new Error("42P01 undefined_table"); },
        create: async () => { historyQueries += 1; throw new Error("42P01 undefined_table"); },
      },
    },
  },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const gate = () => import("@/lib/services/esign/esign-schema-gate");
const service = () => import("@/lib/services/esign/buyer-signing.service");

// The columns migrations 20261014 + 20261015 add — absent from production today.
const GATED = [
  "consentPolicyVersion",
  "consentSnapshot",
  "executedDocumentKey",
  "executedDocumentHash",
  "executedGeneratedAt",
  "confirmationsSentAt",
  "attemptNumber",
];

beforeEach(() => {
  delete process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED;
  envelopeQueries = 0;
  historyQueries = 0;
});

test("defaults to OFF, and only the exact string \"true\" opens it", async () => {
  const { isExecutedArtifactEnabled } = await gate();
  assert.equal(isExecutedArtifactEnabled(), false, "unset must be closed");
  for (const v of ["", "1", "TRUE", "True", "yes", "false", "on"]) {
    process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = v;
    assert.equal(isExecutedArtifactEnabled(), false, `"${v}" must not open the gate`);
  }
  process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = "true";
  assert.equal(isExecutedArtifactEnabled(), true);
});

test("the legacy projection names none of the ungated columns", async () => {
  const { LEGACY_ENVELOPE_SELECT } = await gate();
  for (const field of GATED) {
    assert.ok(!(field in LEGACY_ENVELOPE_SELECT), `${field} must not be projected while the gate is closed`);
  }
});

// Schema-drift guard. If someone adds a scalar to ESignEnvelope and does not decide
// whether it is legacy or gated, the projection silently stops matching the model
// and the next unprojected read is a production 42703 again. Fail here instead.
test("every ESignEnvelope scalar is classified as either legacy or gated", async () => {
  const { LEGACY_ENVELOPE_SELECT, GATED_ENVELOPE_DEFAULTS } = await gate();
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "ESignEnvelope");
  assert.ok(model, "ESignEnvelope model must exist in the Prisma DMMF");

  const scalars = model.fields.filter((f) => f.kind !== "object").map((f) => f.name).sort();
  const classified = [...Object.keys(LEGACY_ENVELOPE_SELECT), ...Object.keys(GATED_ENVELOPE_DEFAULTS)].sort();

  assert.deepEqual(
    scalars,
    classified,
    "every ESignEnvelope scalar must be in LEGACY_ENVELOPE_SELECT (exists in production) " +
      "or GATED_ENVELOPE_DEFAULTS (added by migrations 20261014/20261015) — never neither, never both",
  );
  assert.deepEqual(Object.keys(GATED_ENVELOPE_DEFAULTS).sort(), [...GATED].sort());
});

// Regression guard: LEGACY_ENVELOPE_SELECT is the FULL forensic record and must
// never back a buyer-facing query. esign-dto.ts states the boundary — raw forensic
// evidence is never serialized to buyer/dealer responses — and getDealForBuyer
// serializes what it selects, so the allow-list is enforced here too.
test("the buyer projection never names a forensic column, in either gate state", async () => {
  const { BUYER_SAFE_ENVELOPE_SELECT, buyerEnvelopeSelect } = await gate();
  const FORBIDDEN = [
    "ipAddress", "userAgent", "signerUserId", "signerEmail", "signerName",
    "signatureText", "voidReason", "declineReason", "docusignEnvelopeId",
    "documentKey", "consentSnapshot", "executedDocumentHash",
  ];

  for (const field of FORBIDDEN) {
    assert.ok(!(field in BUYER_SAFE_ENVELOPE_SELECT), `${field} must not be in the buyer allow-list`);
  }

  for (const value of [undefined, "true"]) {
    if (value === undefined) delete process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED;
    else process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = value;
    const sel = buyerEnvelopeSelect() as Record<string, unknown>;
    for (const field of FORBIDDEN) {
      assert.ok(!(field in sel), `${field} leaked into the buyer projection (gate=${String(value)})`);
    }
  }
});

test("withGatedDefaults reports the ungated fields as absent, not as data", async () => {
  const { withGatedDefaults } = await gate();
  const legacyRow = { id: "e1", dealId: "d1", status: "COMPLETED", certificatePdfPath: "cert.pdf" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widened = withGatedDefaults(legacyRow as any) as Record<string, unknown>;

  assert.equal(widened.executedDocumentKey, null);
  assert.equal(widened.consentSnapshot, null);
  assert.equal(widened.confirmationsSentAt, null);
  assert.equal(widened.attemptNumber, 1, "mirrors the migration's own DEFAULT 1");
  assert.equal(widened.certificatePdfPath, "cert.pdf", "real columns pass through untouched");
});

test("envelopeSelect projects while closed and reads the full row while open", async () => {
  const { envelopeSelect, LEGACY_ENVELOPE_SELECT } = await gate();
  assert.deepEqual(envelopeSelect(), LEGACY_ENVELOPE_SELECT);
  process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = "true";
  assert.equal(envelopeSelect(), undefined);
});

test("reconcileSignedContracts skips truthfully without querying the missing columns", async () => {
  const { reconcileSignedContracts } = await service();
  const result = await reconcileSignedContracts();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "executed_artifact_disabled");
  assert.deepEqual(
    { scanned: result.scanned, finalized: result.finalized, pending: result.pending, stuck: result.stuck },
    { scanned: 0, finalized: 0, pending: 0, stuck: 0 },
    "a skip must never report work it did not do",
  );
  assert.equal(envelopeQueries, 0, "the gate must short-circuit before Prisma is reached");
});

test("finalizeSignedContract reports NOT ready rather than a vacuous success", async () => {
  const { finalizeSignedContract } = await service();
  const result = await finalizeSignedContract("d1");

  // Every flag false: with the columns absent nothing can be finalized, and saying
  // otherwise would let an unfinalized signature look complete.
  assert.deepEqual(result, { artifactReady: false, certificateReady: false, confirmationsSent: false });
  assert.equal(envelopeQueries, 0);
  assert.equal(historyQueries, 0);
});

test("a gate-closed read never asks for the history table", async () => {
  const { readEnvelopeForDeal } = await service();
  await readEnvelopeForDeal("d1").catch(() => {}); // the mock throws; we only assert the shape of the attempt
  assert.equal(historyQueries, 0, "e_sign_envelope_history must never be queried while the gate is closed");
});

test("signing FAILS CLOSED while the gate is closed — no signature without a consent record", async () => {
  const { prepareBuyerSigningEnvelope, recordBuyerSignature, ESignSchemaUnavailableError } = await service();

  await assert.rejects(
    () => prepareBuyerSigningEnvelope("d1"),
    (e: Error) => e instanceof ESignSchemaUnavailableError,
    "preparing a ceremony the buyer could not complete must be refused",
  );

  await assert.rejects(
    () =>
      recordBuyerSignature({
        dealId: "d1",
        signerUserId: "u1",
        signerName: "Sam Buyer",
        signerEmail: "sam@example.com",
        signatureText: "Sam Buyer",
        acknowledgments: [
          { key: "ELECTRONIC_RECORDS_AND_SIGNATURE", accepted: true },
          { key: "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE", accepted: true },
          { key: "ACCEPTANCE_AND_INTENT_TO_BE_BOUND", accepted: true },
          { key: "ELECTRONIC_COPY_AND_ACCESS", accepted: true },
        ],
        ipAddress: "1.2.3.4",
        userAgent: "test",
      }),
    (e: Error) => e instanceof ESignSchemaUnavailableError,
    "a signature whose frozen consent snapshot cannot be persisted must not be recorded",
  );

  // Refused before any database contact — never a partially written signature.
  assert.equal(envelopeQueries, 0);
  assert.equal(historyQueries, 0);
});
