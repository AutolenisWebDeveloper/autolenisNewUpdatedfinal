// P0 regression: the unapplied-migration blast radius on the e-sign envelope.
//
// Root cause. Prisma's ESignEnvelope model describes SEVEN columns that do not
// exist in the production database, plus a whole table (ESignEnvelopeHistory)
// that does not exist either, because migrations
// 20261014000000_esign_envelope_history and
// 20261015000000_esign_consent_and_executed_artifact are deliberately unapplied
// pending attorney/compliance review of consent policy DRAFT_V1.
//
// Prisma selects EVERY scalar on a model unless a `select` narrows it, so a bare
// `include: { eSignEnvelope: true }` — or a bare findUnique/findMany/upsert on
// the envelope — asks Postgres for columns that are not there and throws
//   "The column e_sign_envelopes.executed_document_key does not exist in the
//    current database"
// That exact error has failed the esign-artifact-reconcile cron on 283 of 283
// runs in 24 hours, and the same pattern was latent across the buyer signing,
// pickup, and contract-download paths. Only the fact that production holds zero
// deals kept it from reaching a buyer: the FIRST real deal would have hit an
// unrecoverable error at signing and again at pickup.
//
// These prove the gate that every read and write now routes through.
//
// Run: pnpm test:esign  (globs lib/services/esign/__tests__/*.test.ts)

import test from "node:test";
import assert from "node:assert/strict";

import {
  ESIGN_ENVELOPE_BASE_SELECT,
  ESIGN_ENVELOPE_EXTENDED_SELECT,
  ESIGN_ENVELOPE_EXTENDED_FIELDS,
  ESIGN_ENVELOPE_EXTENDED_DEFAULTS,
  esignEnvelopeSelect,
  toEnvelopeView,
  gateEnvelopeWrite,
  canQueryExtendedEnvelopeFields,
  isEsignExtendedSchemaEnabled,
  EsignExtendedSchemaUnavailableError,
} from "../envelope-schema";

// env.d.ts types project env vars as required strings, so assign through the
// index signature to simulate "unset".
const env = process.env as Record<string, string | undefined>;

function withGate(value: string | undefined, fn: () => void) {
  const previous = env.ESIGN_EXTENDED_SCHEMA_ENABLED;
  env.ESIGN_EXTENDED_SCHEMA_ENABLED = value;
  try {
    fn();
  } finally {
    env.ESIGN_EXTENDED_SCHEMA_ENABLED = previous;
  }
}

/**
 * The columns e_sign_envelopes ACTUALLY has in production, read from
 * information_schema and mapped to their Prisma field names. This is the
 * physical truth the gate must never exceed.
 */
const PHYSICAL_COLUMNS = new Set([
  "id", "dealId", "docusignEnvelopeId", "status", "sentAt", "completedAt",
  "voidedAt", "voidReason", "createdAt", "updatedAt", "documentKey",
  "documentVersionId", "documentHash", "signerUserId", "signerRole",
  "signerName", "signerEmail", "consentedToElectronic", "consentedAt",
  "signatureText", "signedAt", "viewedAt", "ipAddress", "userAgent",
  "declineReason", "expiresAt", "certificatePdfPath", "certificateGeneratedAt",
]);

test("the gate defaults OFF", () => {
  withGate(undefined, () => {
    assert.equal(isEsignExtendedSchemaEnabled(), false);
  });
  // Only the exact string "true" enables it — a stray "1"/"yes" must not.
  for (const v of ["1", "yes", "TRUE", ""]) {
    withGate(v, () => assert.equal(isEsignExtendedSchemaEnabled(), false, `"${v}" must not enable`));
  }
  withGate("true", () => assert.equal(isEsignExtendedSchemaEnabled(), true));
});

test("the gated-off select names ONLY columns that physically exist", () => {
  withGate(undefined, () => {
    const selected = Object.keys(esignEnvelopeSelect());
    for (const field of selected) {
      assert.ok(
        PHYSICAL_COLUMNS.has(field),
        `select names "${field}", which does not exist in the production database`,
      );
    }
  });
});

test("the gated-off select covers EVERY column that does exist", () => {
  // A narrowed select that silently dropped a real column would be a different
  // defect — consumers would read undefined where data exists.
  const base = new Set(Object.keys(ESIGN_ENVELOPE_BASE_SELECT));
  for (const col of PHYSICAL_COLUMNS) {
    assert.ok(base.has(col), `base select is missing the real column "${col}"`);
  }
  assert.equal(base.size, PHYSICAL_COLUMNS.size, "base select and physical schema must match exactly");
});

test("the seven extended fields are exactly the unapplied migration's columns", () => {
  assert.deepEqual(
    [...ESIGN_ENVELOPE_EXTENDED_FIELDS].sort(),
    [
      "attemptNumber",
      "confirmationsSentAt",
      "consentPolicyVersion",
      "consentSnapshot",
      "executedDocumentHash",
      "executedDocumentKey",
      "executedGeneratedAt",
    ],
  );
  // None of them may appear in the base select.
  for (const f of ESIGN_ENVELOPE_EXTENDED_FIELDS) {
    assert.ok(
      !(f in ESIGN_ENVELOPE_BASE_SELECT),
      `"${f}" must not be in the base select — it does not exist in the database`,
    );
    assert.ok(f in ESIGN_ENVELOPE_EXTENDED_SELECT, `"${f}" must be in the extended select`);
  }
});

test("turning the gate ON selects the extended columns too", () => {
  withGate("true", () => {
    const selected = Object.keys(esignEnvelopeSelect());
    for (const f of ESIGN_ENVELOPE_EXTENDED_FIELDS) {
      assert.ok(selected.includes(f), `gate on must select "${f}"`);
    }
  });
});

test("a narrowed row is normalized to the full shape with truthful absences", () => {
  withGate(undefined, () => {
    const row = { id: "env_1", dealId: "deal_1", status: "COMPLETED", certificatePdfPath: null };
    const view = toEnvelopeView(row);
    assert.ok(view);
    // Absent means absent — not a placeholder for data that exists elsewhere.
    assert.equal(view.executedDocumentKey, null);
    assert.equal(view.consentSnapshot, null);
    assert.equal(view.consentPolicyVersion, null);
    assert.equal(view.confirmationsSentAt, null);
    assert.equal(view.attemptNumber, 1, "the schema can only express one attempt");
    // Real values survive.
    assert.equal(view.id, "env_1");
    assert.equal(view.status, "COMPLETED");
  });
});

test("normalizing never overwrites a real value when the gate is on", () => {
  withGate("true", () => {
    const row = { id: "env_1", executedDocumentKey: "contracts/executed/deal_1.pdf", attemptNumber: 3 };
    const view = toEnvelopeView(row);
    assert.equal(view?.executedDocumentKey, "contracts/executed/deal_1.pdf");
    assert.equal(view?.attemptNumber, 3);
  });
});

test("normalizing a null row stays null", () => {
  assert.equal(toEnvelopeView(null), null);
  assert.equal(toEnvelopeView(undefined), null);
});

test("writes are stripped of gated columns when the gate is off", () => {
  withGate(undefined, () => {
    const written = gateEnvelopeWrite({
      status: "COMPLETED",
      completedAt: new Date(0),
      consentPolicyVersion: "DRAFT_V1",
      consentSnapshot: { acknowledgments: [] },
      executedDocumentKey: "k",
      executedDocumentHash: "h",
      executedGeneratedAt: new Date(0),
      confirmationsSentAt: new Date(0),
      attemptNumber: 2,
    });
    for (const f of ESIGN_ENVELOPE_EXTENDED_FIELDS) {
      assert.ok(!(f in written), `write must not name "${f}"`);
    }
    // Everything real is preserved — the write still records the signature.
    assert.equal(written.status, "COMPLETED");
    assert.ok(written.completedAt instanceof Date);
  });
});

test("writes pass through untouched when the gate is on", () => {
  withGate("true", () => {
    const payload = { status: "COMPLETED", consentPolicyVersion: "DRAFT_V1", attemptNumber: 2 };
    assert.deepEqual(gateEnvelopeWrite(payload), payload);
  });
});

test("extended-field queries are refused while the gate is off", () => {
  // The reconcile sweep filters on executedDocumentKey/confirmationsSentAt.
  // Running that filter is precisely what failed the cron 283/283 times.
  withGate(undefined, () => assert.equal(canQueryExtendedEnvelopeFields(), false));
  withGate("true", () => assert.equal(canQueryExtendedEnvelopeFields(), true));
});

test("the fail-closed error names the migrations and the switch", () => {
  const err = new EsignExtendedSchemaUnavailableError("Re-issuing a signing envelope");
  assert.equal(err.code, "ESIGN_EXTENDED_SCHEMA_UNAVAILABLE");
  assert.match(err.message, /20261014000000/);
  assert.match(err.message, /20261015000000/);
  assert.match(err.message, /ESIGN_EXTENDED_SCHEMA_ENABLED/);
});

test("the defaults table covers every extended field", () => {
  for (const f of ESIGN_ENVELOPE_EXTENDED_FIELDS) {
    assert.ok(f in ESIGN_ENVELOPE_EXTENDED_DEFAULTS, `no default for "${f}"`);
  }
});
