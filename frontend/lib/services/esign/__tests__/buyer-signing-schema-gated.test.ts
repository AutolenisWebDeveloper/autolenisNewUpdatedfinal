// P0 regression: the in-house signing service against the PHYSICAL production
// schema, i.e. with migrations 20261014000000_esign_envelope_history and
// 20261015000000_esign_consent_and_executed_artifact UNAPPLIED.
//
// buyer-signing.test.ts covers the applied-migration world (it switches the gate
// ON and mocks a database that has every column). This file covers the world
// production is actually in, and does it the strict way: the mocked Prisma
// behaves like the real Postgres — it THROWS the exact error the live database
// throws if a query names a column that is not there:
//
//   The column `e_sign_envelopes.executed_document_key` does not exist in the
//   current database.
//
// So these tests fail if ANY read selects, or ANY write names, one of the seven
// missing columns — which is precisely the defect that has failed the
// esign-artifact-reconcile cron on 283 of 283 runs and sat latent on the buyer
// signing, pickup, and contract-download paths.
//
// Run: pnpm test:esign  (globs lib/services/esign/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

// The gate is OFF here — the production configuration. Unset before the service
// module loads so it reads the same value the routes would.
//
// `delete`, not `= undefined`: assigning undefined to process.env stores the
// STRING "undefined".
delete (process.env as Record<string, string | undefined>).ESIGN_EXTENDED_SCHEMA_ENABLED;

/** The seven columns the unapplied migrations would add. */
const MISSING_COLUMNS = [
  "consentPolicyVersion",
  "consentSnapshot",
  "executedDocumentKey",
  "executedDocumentHash",
  "executedGeneratedAt",
  "confirmationsSentAt",
  "attemptNumber",
] as const;

const SNAKE: Record<string, string> = {
  consentPolicyVersion: "consent_policy_version",
  consentSnapshot: "consent_snapshot",
  executedDocumentKey: "executed_document_key",
  executedDocumentHash: "executed_document_hash",
  executedGeneratedAt: "executed_generated_at",
  confirmationsSentAt: "confirmations_sent_at",
  attemptNumber: "attempt_number",
};

class MissingColumnError extends Error {
  constructor(field: string) {
    super(
      `\nInvalid \`prisma.eSignEnvelope\` invocation:\n\n\nThe column ` +
        `\`e_sign_envelopes.${SNAKE[field]}\` does not exist in the current database.`,
    );
    this.name = "PrismaClientKnownRequestError";
  }
}

/** Reject any object that names a missing column — mirrors real Postgres. */
function assertNoMissingColumns(obj: unknown, seen = new Set<unknown>()): void {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const v of obj) assertNoMissingColumns(v, seen);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if ((MISSING_COLUMNS as readonly string[]).includes(k)) throw new MissingColumnError(k);
    assertNoMissingColumns(v, seen);
  }
}

/** The columns that DO exist, as returned by a narrowed read. */
function physicalRow(over: Record<string, unknown> = {}) {
  return {
    id: "env_1",
    dealId: "deal_1",
    docusignEnvelopeId: null,
    status: "SENT",
    documentKey: null,
    sentAt: new Date(0),
    completedAt: null,
    voidedAt: null,
    voidReason: null,
    documentVersionId: "cv_1",
    documentHash: null,
    signerUserId: null,
    signerRole: "BUYER",
    signerName: null,
    signerEmail: null,
    consentedToElectronic: false,
    consentedAt: null,
    signatureText: null,
    signedAt: null,
    viewedAt: null,
    ipAddress: null,
    userAgent: null,
    declineReason: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    certificatePdfPath: null,
    certificateGeneratedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

interface Ctrl {
  row: Record<string, unknown> | null;
  bytes: string;
  contractStatus: string;
  audits: Array<Record<string, unknown>>;
  historyCreates: number;
  advanceCalls: string[];
  certPaths: string[];
}
let ctrl: Ctrl;

function hashOf(s: string) {
  return createHash("sha256").update(Buffer.from(new TextEncoder().encode(s))).digest("hex");
}

function applyUpdate(data: Record<string, unknown>) {
  assertNoMissingColumns(data);
  if (ctrl.row) Object.assign(ctrl.row, data);
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findUnique: async (args: Record<string, unknown>) => {
          assertNoMissingColumns(args.where);
          assertNoMissingColumns(args.select);
          return ctrl.row ? { ...ctrl.row } : null;
        },
        findMany: async (args: Record<string, unknown>) => {
          assertNoMissingColumns(args.where);
          assertNoMissingColumns(args.select);
          return ctrl.row ? [{ ...ctrl.row }] : [];
        },
        upsert: async (args: Record<string, unknown>) => {
          assertNoMissingColumns(args.create);
          assertNoMissingColumns(args.update);
          assertNoMissingColumns(args.select);
          if (!ctrl.row) ctrl.row = physicalRow(args.create as Record<string, unknown>);
          else Object.assign(ctrl.row, args.update as Record<string, unknown>);
          return { ...ctrl.row };
        },
        update: async (args: Record<string, unknown>) => {
          applyUpdate(args.data as Record<string, unknown>);
          return { ...(ctrl.row as Record<string, unknown>) };
        },
        updateMany: async (args: Record<string, unknown>) => {
          assertNoMissingColumns(args.where);
          assertNoMissingColumns(args.data);
          const where = args.where as Record<string, unknown>;
          if (!ctrl.row) return { count: 0 };
          if (where.status !== undefined && ctrl.row.status !== where.status) return { count: 0 };
          applyUpdate(args.data as Record<string, unknown>);
          return { count: 1 };
        },
      },
      eSignEnvelopeHistory: {
        create: async () => {
          ctrl.historyCreates += 1;
          throw new Error('relation "e_sign_envelope_history" does not exist');
        },
        findMany: async () => {
          throw new Error('relation "e_sign_envelope_history" does not exist');
        },
      },
      contractVersion: {
        findFirst: async () => ({ id: "cv_1", dealId: "deal_1", documentUrl: "u", version: 1, status: ctrl.contractStatus }),
        findUnique: async () => ({ id: "cv_1", dealId: "deal_1", documentUrl: "u", version: 1, status: ctrl.contractStatus }),
      },
      deal: {
        findUnique: async () => ({
          status: "CONTRACT_APPROVED",
          buyerId: "b1",
          buyer: { firstName: "Sam", lastName: "Buyer", phone: null, user: { email: "sam@example.com" } },
          offer: { dealerId: "dealer_1", dealer: { isSystemPlaceholder: false } },
        }),
      },
      notification: { findFirst: async () => null, create: async () => ({}) },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); },
      },
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          eSignEnvelope: {
            updateMany: async (args: Record<string, unknown>) => {
              assertNoMissingColumns(args.where);
              assertNoMissingColumns(args.data);
              applyUpdate(args.data as Record<string, unknown>);
              return { count: 1 };
            },
          },
          eSignEnvelopeHistory: {
            create: async () => { throw new Error('relation "e_sign_envelope_history" does not exist'); },
          },
          adminAuditLog: {
            create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); },
          },
        }),
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (_id: string, to: string) => { ctrl.advanceCalls.push(to); },
    DealTransitionError: class extends Error {},
  },
});

mock.module("@/lib/services/contract-shield/extract-text", {
  namedExports: { loadContractPdfBytes: async () => new TextEncoder().encode(ctrl.bytes) },
});

mock.module("@/lib/services/esign/buyer-contract-certificate.service", {
  namedExports: {
    generateAndUploadBuyerContractCertificate: async () => {
      const p = "certs/deal_1.pdf";
      ctrl.certPaths.push(p);
      return p;
    },
  },
});

mock.module("@/lib/services/esign/executed-contract.service", {
  namedExports: {
    generateAndUploadExecutedContract: async () => ({ key: "executed/deal_1.pdf", hash: "abc" }),
    getExecutedContractUrl: async () => "https://example.test/x",
  },
});

async function load() {
  return import("../buyer-signing.service");
}

beforeEach(() => {
  ctrl = {
    row: null,
    bytes: "CONTRACT",
    contractStatus: "APPROVED",
    audits: [],
    historyCreates: 0,
    advanceCalls: [],
    certPaths: [],
  };
});

// The four required acknowledgment keys from the active consent policy
// (lib/services/esign/consent-policy). Consent is validated against these
// regardless of whether the snapshot column exists to store them.
const ACKS = [
  { key: "ELECTRONIC_RECORDS_AND_SIGNATURE", accepted: true },
  { key: "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE", accepted: true },
  { key: "ACCEPTANCE_AND_INTENT_TO_BE_BOUND", accepted: true },
  { key: "ELECTRONIC_COPY_AND_ACCESS", accepted: true },
];

test("preparing a first envelope never names a missing column", async () => {
  const { prepareBuyerSigningEnvelope } = await load();
  const result = await prepareBuyerSigningEnvelope("deal_1", { signerUserId: "b1" });
  assert.equal(result.status, "SENT");
  assert.equal(result.documentVersionId, "cv_1");
});

test("recording a signature succeeds against the physical schema", async () => {
  // The whole point: the FIRST real deal must be able to sign. Before the gate,
  // this path selected executed_document_key and threw.
  ctrl.row = physicalRow({ status: "SENT", documentHash: hashOf("CONTRACT") });
  const { recordBuyerSignature } = await load();
  const res = await recordBuyerSignature({
    dealId: "deal_1",
    signerUserId: "b1",
    signerName: "Sam Buyer",
    signerEmail: "sam@example.com",
    signatureText: "Sam Buyer",
    acknowledgments: ACKS,
    ipAddress: "1.2.3.4",
    userAgent: "UA",
  });
  assert.equal(res.status, "COMPLETED");
  assert.equal(ctrl.row?.status, "COMPLETED");
  assert.equal(ctrl.row?.consentedToElectronic, true, "consent flag is a real column and must persist");
  assert.ok(ctrl.row?.signedAt, "the signature timestamp must persist");
});

test("consent evidence is NOT lost when the snapshot column is absent", async () => {
  // The denormalized snapshot column is skipped, but the CONSENT_ACCEPTED audit
  // event still carries the full attribution and the exact acknowledgments bound
  // to the document version + hash. Losing the evidence would be unacceptable;
  // skipping a duplicate copy of it is not.
  ctrl.row = physicalRow({ status: "SENT", documentHash: hashOf("CONTRACT") });
  const { recordBuyerSignature } = await load();
  await recordBuyerSignature({
    dealId: "deal_1",
    signerUserId: "b1",
    signerName: "Sam Buyer",
    signerEmail: "sam@example.com",
    signatureText: "Sam Buyer",
    acknowledgments: ACKS,
    ipAddress: "1.2.3.4",
    userAgent: "UA",
  });
  const consent = ctrl.audits.find((a) => a.action === "CONSENT_ACCEPTED");
  assert.ok(consent, "a CONSENT_ACCEPTED audit event must still be written");
  const meta = consent!.metadata as Record<string, unknown>;
  assert.equal(meta.signerUserId, "b1");
  assert.equal(meta.documentVersionId, "cv_1");
  assert.equal(meta.documentHash, hashOf("CONTRACT"));
  assert.equal((meta.acknowledgments as unknown[]).length, 4);
  assert.ok(ctrl.audits.some((a) => a.action === "ESIGN_SIGNED"));
});

test("superseding a TERMINAL attempt FAILS CLOSED rather than destroying evidence", async () => {
  // Re-issuing over a terminal attempt requires archiving it into
  // ESignEnvelopeHistory, and that table does not exist. Proceeding would
  // overwrite immutable terminal signing evidence in place, so the path must
  // refuse — and must not have attempted the archive either.
  ctrl.row = physicalRow({ status: "VOIDED", voidedAt: new Date(0), voidReason: "tamper" });
  const { prepareBuyerSigningEnvelope } = await load();
  await assert.rejects(
    () => prepareBuyerSigningEnvelope("deal_1", { signerUserId: "b1" }),
    (err: Error & { code?: string }) => {
      assert.equal(err.code, "ESIGN_EXTENDED_SCHEMA_UNAVAILABLE");
      assert.match(err.message, /20261014000000/);
      return true;
    },
  );
  assert.equal(ctrl.row?.status, "VOIDED", "the terminal record must be untouched");
  assert.equal(ctrl.historyCreates, 0, "no archive attempt should have been made");
});

test("the reconcile sweep reports an honest skip instead of throwing", async () => {
  // This is the cron that has FAILED 283/283 times. Its WHERE filtered on
  // executed_document_key and confirmations_sent_at.
  const { reconcileSignedContracts } = await load();
  const result = await reconcileSignedContracts();
  assert.equal(result.skipped, "esign_extended_schema_disabled");
  assert.deepEqual(
    { scanned: result.scanned, finalized: result.finalized, pending: result.pending, stuck: result.stuck },
    { scanned: 0, finalized: 0, pending: 0, stuck: 0 },
    "an honest empty sweep — nothing scanned, nothing claimed",
  );
});

test("finalize skips the artifact and confirmations but still produces the certificate", async () => {
  // certificate_pdf_path DOES exist, so the evidence certificate is still
  // generated. The executed artifact and the confirmation marker do not, so they
  // are reported as not ready rather than silently re-sent on every re-drive.
  ctrl.row = physicalRow({ status: "COMPLETED", documentHash: hashOf("CONTRACT"), signedAt: new Date(0) });
  const { finalizeSignedContract } = await load();
  const res = await finalizeSignedContract("deal_1");
  assert.equal(res.artifactReady, false);
  assert.equal(res.confirmationsSent, false, "confirmations must not fire without a de-dup marker");
  assert.equal(res.certificateReady, true);
  assert.equal(ctrl.certPaths.length, 1);
});

test("the expiry sweep still works — it only touches real columns", async () => {
  ctrl.row = physicalRow({ status: "SENT", expiresAt: new Date(Date.now() - 1000) });
  const { sweepExpiredEnvelopes } = await load();
  const res = await sweepExpiredEnvelopes();
  assert.equal(res.expired, 1);
  assert.equal(ctrl.row?.status, "EXPIRED");
});

test("decline and void still work against the physical schema", async () => {
  ctrl.row = physicalRow({ status: "SENT" });
  const { declineBuyerSignature } = await load();
  await declineBuyerSignature("deal_1", "changed my mind");
  assert.equal(ctrl.row?.status, "DECLINED");
  assert.equal(ctrl.row?.declineReason, "changed my mind");
});
