// In-house buyer signing service — evidence, consent, tamper, idempotency,
// recovery (Program 4 correction; replaces DocuSign). Proves §20 invariants with
// mocked prisma / deal.service / document bytes. NO DocuSign, no network.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   lib/services/esign/__tests__/buyer-signing.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

interface Env {
  id: string; dealId: string; status: string; attemptNumber: number;
  documentVersionId: string | null; documentHash: string | null;
  signerUserId: string | null; signerRole: string | null; signerName: string | null; signerEmail: string | null;
  signatureText: string | null; signedAt: Date | null; consentedToElectronic: boolean;
  consentedAt: Date | null; ipAddress: string | null; userAgent: string | null;
  certificatePdfPath: string | null; certificateGeneratedAt: Date | null;
  voidedAt: Date | null; voidReason: string | null; declineReason: string | null;
  expiresAt: Date | null; viewedAt: Date | null; completedAt: Date | null; sentAt: Date | null;
}
interface Ctrl {
  env: Env | null;
  history: Array<Record<string, unknown>>; // append-only archive of superseded terminal attempts
  contract: { id: string; dealId: string; documentUrl: string; version: number; status: string } | null;
  dealStatus: string;
  bytes: string; // controllable document content (hash source)
  advanceCalls: Array<{ to: string }>;
  audits: Array<Record<string, unknown>>;
  certPayloads: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

function hashOf(s: string) { return createHash("sha256").update(Buffer.from(new TextEncoder().encode(s))).digest("hex"); }

const envUpdate = (data: Record<string, unknown>) => { if (ctrl.env) Object.assign(ctrl.env, data); };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findUnique: async () => (ctrl.env ? { ...ctrl.env } : null),
        upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          if (!ctrl.env) ctrl.env = { id: "env_1", ...defaultEnv(), ...(create as object) } as Env;
          else Object.assign(ctrl.env, update);
          return { ...ctrl.env };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => { envUpdate(data); return { ...(ctrl.env as Env) }; },
        updateMany: async ({ where, data }: { where: { status?: string; certificatePdfPath?: null }; data: Record<string, unknown> }) => {
          if (where.status !== undefined) {
            if (ctrl.env && ctrl.env.status === where.status) { envUpdate(data); return { count: 1 }; }
            return { count: 0 };
          }
          if (where.certificatePdfPath === null && ctrl.env?.certificatePdfPath == null) { envUpdate(data); return { count: 1 }; }
          return { count: 0 };
        },
      },
      contractVersion: {
        findFirst: async () => (ctrl.contract ? { ...ctrl.contract } : null),
        findUnique: async () => (ctrl.contract ? { ...ctrl.contract } : null),
      },
      deal: { findUnique: async () => ({ status: ctrl.dealStatus, buyerId: "b1" }) },
      adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); } },
      eSignEnvelopeHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.history.push(data); } },
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({
        eSignEnvelope: {
          updateMany: async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
            if (ctrl.env && ctrl.env.status === where.status) { envUpdate(data); return { count: 1 }; }
            return { count: 0 };
          },
        },
        eSignEnvelopeHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.history.push(data); } },
        adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); } },
      }),
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (_id: string, to: string) => { ctrl.advanceCalls.push({ to }); ctrl.dealStatus = to; },
  },
});

mock.module("@/lib/services/contract-shield/extract-text", {
  namedExports: { loadContractPdfBytes: async () => new TextEncoder().encode(ctrl.bytes) },
});

mock.module("@/lib/services/esign/buyer-contract-certificate.service", {
  namedExports: {
    generateAndUploadBuyerContractCertificate: async (payload: Record<string, unknown>) => { ctrl.certPayloads.push(payload); return "buyer-contracts/d1/env_1.pdf"; },
    getBuyerContractCertificateUrl: async () => "https://signed/cert",
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

function defaultEnv(): Omit<Env, "id"> {
  return {
    dealId: "d1", status: "PENDING", attemptNumber: 1, documentVersionId: null, documentHash: null,
    signerUserId: null, signerRole: null, signerName: null, signerEmail: null, signatureText: null, signedAt: null,
    consentedToElectronic: false, consentedAt: null, ipAddress: null, userAgent: null,
    certificatePdfPath: null, certificateGeneratedAt: null, voidedAt: null, voidReason: null,
    declineReason: null, expiresAt: null, viewedAt: null, completedAt: null, sentAt: null,
  };
}

async function load() { return import("@/lib/services/esign/buyer-signing.service"); }

const goodSig = {
  dealId: "d1", signerUserId: "b1", signerName: "Sam Buyer", signerEmail: "sam@example.com",
  signatureText: "Sam Buyer", consentedToElectronic: true, ipAddress: "1.2.3.4", userAgent: "Mozilla/5.0",
};

beforeEach(() => {
  ctrl = {
    env: null,
    history: [],
    contract: { id: "cv_1", dealId: "d1", documentUrl: "path/contract.pdf", version: 1, status: "APPROVED" },
    dealStatus: "CONTRACT_APPROVED",
    bytes: "THE CONTRACT BYTES",
    advanceCalls: [], audits: [], certPayloads: [],
  };
});

test("prepare binds the approved contract by hash and marks SENT (view ≠ sign)", async () => {
  const { prepareBuyerSigningEnvelope } = await load();
  const r = await prepareBuyerSigningEnvelope("d1", { signerUserId: "b1", signerName: "Sam", signerEmail: "sam@example.com" });
  assert.equal(r.status, "SENT");
  assert.equal(r.documentVersionId, "cv_1");
  assert.equal(r.documentHash, hashOf("THE CONTRACT BYTES"));
  assert.equal(ctrl.env?.status, "SENT");
  assert.equal(ctrl.env?.signedAt, null, "preparing/viewing must not sign");
  assert.equal(ctrl.advanceCalls.length, 0, "prepare does not advance to SIGNED");
});

test("prepare fails closed when no approved contract exists", async () => {
  ctrl.contract = null;
  const { prepareBuyerSigningEnvelope, NoSignableDocumentError } = await load();
  await assert.rejects(() => prepareBuyerSigningEnvelope("d1"), (e: unknown) => e instanceof NoSignableDocumentError);
});

test("consent is required — no consent throws and records no signature", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES") };
  const { recordBuyerSignature, ConsentRequiredError } = await load();
  await assert.rejects(() => recordBuyerSignature({ ...goodSig, consentedToElectronic: false }), (e: unknown) => e instanceof ConsentRequiredError);
  assert.equal(ctrl.env?.status, "SENT", "unsigned");
});

test("a valid signature captures full evidence server-side and drives SIGNED", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES") };
  ctrl.dealStatus = "SIGNING_PENDING";
  const { recordBuyerSignature } = await load();
  const r = await recordBuyerSignature(goodSig);
  assert.equal(r.status, "COMPLETED");
  assert.equal(ctrl.env?.status, "COMPLETED");
  assert.equal(ctrl.env?.signerUserId, "b1", "signer identity bound");
  assert.equal(ctrl.env?.signerRole ?? "BUYER", "BUYER");
  assert.equal(ctrl.env?.signatureText, "Sam Buyer", "adoption evidence captured");
  assert.equal(ctrl.env?.ipAddress, "1.2.3.4");
  assert.equal(ctrl.env?.userAgent, "Mozilla/5.0");
  assert.ok(ctrl.env?.signedAt, "server timestamp set");
  assert.ok(ctrl.env?.consentedAt, "consent timestamp set");
  assert.equal(ctrl.env?.documentHash, hashOf("THE CONTRACT BYTES"), "exact document hash stored");
  assert.deepEqual(ctrl.advanceCalls.map(c => c.to), ["SIGNED"]);
  assert.equal(ctrl.audits[0]?.action, "ESIGN_SIGNED");
});

test("from CONTRACT_APPROVED the record walks SIGNING_PENDING → SIGNED", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES") };
  ctrl.dealStatus = "CONTRACT_APPROVED";
  const { recordBuyerSignature } = await load();
  await recordBuyerSignature(goodSig);
  assert.deepEqual(ctrl.advanceCalls.map(c => c.to), ["SIGNING_PENDING", "SIGNED"]);
});

test("document mutation after prepare invalidates: VOIDED + DocumentChangedError (no false signature)", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("ORIGINAL BYTES") };
  ctrl.bytes = "TAMPERED BYTES"; // contract changed since prepare
  const { recordBuyerSignature, DocumentChangedError } = await load();
  await assert.rejects(() => recordBuyerSignature(goodSig), (e: unknown) => e instanceof DocumentChangedError);
  assert.equal(ctrl.env?.status, "VOIDED", "the stale signing session is voided, not signed");
  assert.notEqual(ctrl.env?.status, "COMPLETED");
});

test("duplicate submission is idempotent (already COMPLETED → no-op, single completion)", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES"), signedAt: new Date() };
  ctrl.dealStatus = "SIGNED";
  const { recordBuyerSignature } = await load();
  const r = await recordBuyerSignature(goodSig);
  assert.equal(r.alreadySigned, true);
  assert.equal(ctrl.audits.length, 0, "no second audit / no re-sign");
});

test("decline is truthful — DECLINED, deal not advanced", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT" };
  const { declineBuyerSignature } = await load();
  await declineBuyerSignature("d1", "changed my mind");
  assert.equal(ctrl.env?.status, "DECLINED");
  assert.equal(ctrl.env?.declineReason, "changed my mind");
  assert.equal(ctrl.advanceCalls.length, 0);
});

test("void is truthful — VOIDED with reason, deal not advanced", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT" };
  const { voidEnvelopeInternal } = await load();
  await voidEnvelopeInternal("d1", "superseded");
  assert.equal(ctrl.env?.status, "VOIDED");
  assert.ok(ctrl.env?.voidedAt);
  assert.equal(ctrl.advanceCalls.length, 0);
});

test("expiry is lazy and truthful — a stale SENT envelope becomes EXPIRED", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", expiresAt: new Date(Date.now() - 1000) };
  const { expireIfElapsed } = await load();
  const expired = await expireIfElapsed("d1");
  assert.equal(expired, true);
  assert.equal(ctrl.env?.status, "EXPIRED");
});

test("expiry does not touch a COMPLETED envelope", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", expiresAt: new Date(Date.now() - 1000) };
  const { expireIfElapsed } = await load();
  assert.equal(await expireIfElapsed("d1"), false);
  assert.equal(ctrl.env?.status, "COMPLETED");
});

test("certificate is generated once, corresponds to the signed document hash, and is idempotent", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES"), signedAt: new Date(), signerName: "Sam", signerEmail: "sam@example.com", signerUserId: "b1", consentedAt: new Date(), ipAddress: "1.2.3.4", userAgent: "UA" };
  const { finalizeBuyerSignatureCertificate } = await load();
  const path = await finalizeBuyerSignatureCertificate("d1");
  assert.equal(path, "buyer-contracts/d1/env_1.pdf");
  assert.equal(ctrl.certPayloads.length, 1);
  assert.equal(ctrl.certPayloads[0]?.documentHash, hashOf("THE CONTRACT BYTES"), "certificate matches the signed hash");
  assert.equal(ctrl.env?.certificatePdfPath, "buyer-contracts/d1/env_1.pdf");
  // Idempotent: second call does not regenerate.
  ctrl.certPayloads = [];
  await finalizeBuyerSignatureCertificate("d1");
  assert.equal(ctrl.certPayloads.length, 0, "already-generated certificate is not re-created");
});

test("self-heal: a COMPLETED envelope with a lagging deal is driven to SIGNED (recovery, no cron)", async () => {
  ctrl.dealStatus = "SIGNING_PENDING";
  const { ensureDealSigned } = await load();
  await ensureDealSigned("d1", "b1");
  assert.deepEqual(ctrl.advanceCalls.map(c => c.to), ["SIGNED"]);
});

// ── Terminal-record immutability & distinct-attempt archival ────────────────

function terminalEnv(status: string, extra: Partial<Env> = {}): Env {
  return {
    id: "env_1", ...defaultEnv(), status, attemptNumber: 1,
    documentVersionId: "cv_1", documentHash: hashOf("ORIGINAL BYTES"),
    ...extra,
  } as Env;
}

test("prepare NEVER resets/archives a COMPLETED envelope (final signed evidence is immutable)", async () => {
  ctrl.env = terminalEnv("COMPLETED", { signedAt: new Date(), signatureText: "Sam Buyer", signerUserId: "b1" });
  const before = { ...ctrl.env };
  const { prepareBuyerSigningEnvelope } = await load();
  const r = await prepareBuyerSigningEnvelope("d1", { signerUserId: "b1" });
  assert.equal(r.status, "COMPLETED");
  assert.equal(ctrl.history.length, 0, "a COMPLETED envelope is never archived");
  assert.deepEqual(ctrl.env, before, "the COMPLETED row is returned untouched (not reset)");
});

for (const terminal of ["VOIDED", "DECLINED", "EXPIRED"]) {
  test(`prepare on a ${terminal} record archives it immutably and starts a DISTINCT new attempt`, async () => {
    const stamp = new Date("2026-01-01T00:00:00Z");
    ctrl.env = terminalEnv(terminal, {
      voidedAt: terminal === "VOIDED" ? stamp : null,
      voidReason: terminal === "VOIDED" ? "admin void" : null,
      declineReason: terminal === "DECLINED" ? "buyer declined" : null,
      signerName: "Sam Buyer",
    });
    const { prepareBuyerSigningEnvelope } = await load();
    const r = await prepareBuyerSigningEnvelope("d1", { signerUserId: "b1", signerName: "Sam Buyer", signerEmail: "sam@example.com" });

    // (1) the previous terminal record is preserved as a distinct immutable archive row
    assert.equal(ctrl.history.length, 1, "the terminal record is archived exactly once");
    const archived = ctrl.history[0]!;
    assert.equal(archived.status, terminal, "archived with its terminal status");
    assert.equal(archived.attemptNumber, 1, "archived as attempt 1");
    assert.equal(archived.envelopeId, "env_1");
    assert.equal(archived.documentHash, hashOf("ORIGINAL BYTES"), "archived with its own bound hash");
    if (terminal === "VOIDED") { assert.equal(archived.voidReason, "admin void"); assert.deepEqual(archived.voidedAt, stamp); }
    if (terminal === "DECLINED") assert.equal(archived.declineReason, "buyer declined");

    // (2) the working row is a fresh, distinct attempt (not the terminal record)
    assert.equal(r.status, "SENT");
    assert.equal(ctrl.env?.status, "SENT");
    assert.equal(ctrl.env?.attemptNumber, 2, "a distinct new attempt");
    assert.equal(ctrl.env?.documentHash, hashOf("THE CONTRACT BYTES"), "re-bound to the current approved document");
    // (3) no stale terminal evidence carried onto the new attempt
    assert.equal(ctrl.env?.voidedAt, null);
    assert.equal(ctrl.env?.voidReason, null);
    assert.equal(ctrl.env?.declineReason, null);
    assert.equal(ctrl.env?.signedAt, null);
    assert.equal(ctrl.env?.consentedToElectronic, false);
  });
}

test("tamper VOID → new signing attempt preserves BOTH records (voided archive + completed new attempt)", async () => {
  // Attempt 1: SENT, bound to ORIGINAL BYTES; the contract then changes.
  ctrl.env = terminalEnv("SENT", { documentHash: hashOf("ORIGINAL BYTES") });
  ctrl.bytes = "TAMPERED BYTES";
  const mod = await load();
  await assert.rejects(() => mod.recordBuyerSignature(goodSig), (e: unknown) => e instanceof mod.DocumentChangedError);
  assert.equal(ctrl.env?.status, "VOIDED", "the tampered attempt is voided");

  // A new authorized attempt against the (now current) document.
  ctrl.contract = { id: "cv_2", dealId: "d1", documentUrl: "path/contract-v2.pdf", version: 2, status: "APPROVED" };
  await mod.prepareBuyerSigningEnvelope("d1", { signerUserId: "b1", signerName: "Sam Buyer", signerEmail: "sam@example.com" });
  assert.equal(ctrl.history.length, 1, "the VOIDED attempt is archived");
  assert.equal(ctrl.history[0]!.status, "VOIDED");
  assert.equal(ctrl.env?.status, "SENT");
  assert.equal(ctrl.env?.attemptNumber, 2);
  assert.equal(ctrl.env?.documentVersionId, "cv_2", "new attempt bound to the current version");

  // Attempt 2 completes; the archived VOIDED record is untouched, both preserved.
  ctrl.dealStatus = "SIGNING_PENDING";
  const r = await mod.recordBuyerSignature(goodSig);
  assert.equal(r.status, "COMPLETED");
  assert.equal(ctrl.env?.status, "COMPLETED", "the new attempt is the signed record");
  assert.equal(ctrl.history.length, 1, "the VOIDED archive is still exactly one, untouched");
  assert.equal(ctrl.history[0]!.status, "VOIDED");
});

test("decline is a no-op on an already-terminal record (no cross-terminal mutation)", async () => {
  ctrl.env = terminalEnv("VOIDED", { voidReason: "admin void", voidedAt: new Date() });
  const { declineBuyerSignature } = await load();
  await declineBuyerSignature("d1", "late decline");
  assert.equal(ctrl.env?.status, "VOIDED", "a VOIDED record is not overwritten to DECLINED");
  assert.equal(ctrl.env?.voidReason, "admin void");
  assert.equal(ctrl.audits.length, 0);
});

test("void is a no-op on an already-terminal record (no cross-terminal mutation)", async () => {
  ctrl.env = terminalEnv("DECLINED", { declineReason: "buyer declined" });
  const { voidEnvelopeInternal } = await load();
  await voidEnvelopeInternal("d1", "late void");
  assert.equal(ctrl.env?.status, "DECLINED", "a DECLINED record is not overwritten to VOIDED");
  assert.equal(ctrl.env?.declineReason, "buyer declined");
});
