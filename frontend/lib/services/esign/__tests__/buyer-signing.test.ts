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
  // Program 4 e-sign completion — consent record + executed artifact + sequencing.
  consentPolicyVersion: string | null; consentSnapshot: Record<string, unknown> | null;
  executedDocumentKey: string | null; executedDocumentHash: string | null; executedGeneratedAt: Date | null;
  confirmationsSentAt: Date | null;
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
  executedPayloads: Array<Record<string, unknown>>;
  executedFails: boolean; // when true, executed-artifact generation returns null
  notifications: Array<Record<string, unknown>>;
  emits: Array<{ event: string }>;
  buyerEmails: Array<Record<string, unknown>>;
  dealerPlaceholder: boolean;
  // When set, findUnique returns this status instead of the row's actual status —
  // simulating a stale read that a concurrent write has since changed (TOCTOU).
  staleStatus?: string;
}
let ctrl: Ctrl;

function hashOf(s: string) { return createHash("sha256").update(Buffer.from(new TextEncoder().encode(s))).digest("hex"); }

const envUpdate = (data: Record<string, unknown>) => { if (ctrl.env) Object.assign(ctrl.env, data); };

// Guarded/CAS-aware updateMany used both inside and outside the transaction.
type UM = { where: Record<string, unknown>; data: Record<string, unknown> };
const NULL_GUARD_KEYS = ["certificatePdfPath", "executedDocumentKey", "confirmationsSentAt"] as const;
function envUpdateMany({ where, data }: UM): { count: number } {
  if (!ctrl.env) return { count: 0 };
  // id + status compare-and-swap (supersede, per-row sweep).
  if (where.id !== undefined && where.status !== undefined) {
    if (ctrl.env.id === where.id && ctrl.env.status === where.status) { envUpdate(data); return { count: 1 }; }
    return { count: 0 };
  }
  // status-only CAS.
  if (where.status !== undefined) {
    if (ctrl.env.status === where.status) { envUpdate(data); return { count: 1 }; }
    return { count: 0 };
  }
  // null-only guarded writes (immutability / one-way markers).
  for (const key of NULL_GUARD_KEYS) {
    if ((where as Record<string, unknown>)[key] === null) {
      if ((ctrl.env as unknown as Record<string, unknown>)[key] == null) { envUpdate(data); return { count: 1 }; }
      return { count: 0 };
    }
  }
  return { count: 0 };
}

// Minimal Prisma-where matcher for findMany (sweeps + reconcile queries).
function matchesWhere(e: Env, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      const clauses = v as Array<Record<string, unknown>>;
      if (!clauses.some((c) => matchesWhere(e, c))) return false;
      continue;
    }
    const actual = (e as unknown as Record<string, unknown>)[k];
    if (v && typeof v === "object") {
      const cond = v as Record<string, unknown>;
      if ("in" in cond && !(cond.in as unknown[]).includes(actual)) return false;
      if ("lt" in cond) {
        const lt = cond.lt as Date;
        if (!(actual instanceof Date) || !(actual.getTime() < lt.getTime())) return false;
      }
      if ("not" in cond) {
        if (cond.not === null && actual == null) return false;
        else if (cond.not !== null && actual === cond.not) return false;
      }
    } else if (v === null) {
      if (actual != null) return false;
    } else if (actual !== v) {
      return false;
    }
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findUnique: async () => (ctrl.env ? { ...ctrl.env, ...(ctrl.staleStatus ? { status: ctrl.staleStatus } : {}) } : null),
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          const list = ctrl.env ? [ctrl.env] : [];
          return list.filter((e) => matchesWhere(e, where ?? {})).map((e) => ({ ...e }));
        },
        upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          if (!ctrl.env) ctrl.env = { id: "env_1", ...defaultEnv(), ...(create as object) } as Env;
          else Object.assign(ctrl.env, update);
          return { ...ctrl.env };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => { envUpdate(data); return { ...(ctrl.env as Env) }; },
        updateMany: async (args: UM) => envUpdateMany(args),
      },
      contractVersion: {
        findFirst: async () => (ctrl.contract ? { ...ctrl.contract } : null),
        findUnique: async () => (ctrl.contract ? { ...ctrl.contract } : null),
      },
      deal: {
        findUnique: async () => ({
          status: ctrl.dealStatus,
          buyerId: "b1",
          buyer: { firstName: "Sam", lastName: "Buyer", phone: null, user: { email: "sam@example.com" } },
          offer: { dealerId: "dealer_1", dealer: { isSystemPlaceholder: ctrl.dealerPlaceholder } },
        }),
      },
      notification: {
        findFirst: async ({ where }: { where: { metadata?: { equals?: string } } }) => {
          const key = where?.metadata?.equals;
          return ctrl.notifications.find((n) => (n.metadata as { key?: string })?.key === key) ?? null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); return data; },
      },
      adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); } },
      eSignEnvelopeHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.history.push(data); } },
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({
        eSignEnvelope: { updateMany: async (args: UM) => envUpdateMany(args) },
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

mock.module("@/lib/services/esign/executed-contract.service", {
  namedExports: {
    generateAndUploadExecutedContract: async (payload: Record<string, unknown>) => {
      ctrl.executedPayloads.push(payload);
      if (ctrl.executedFails) return null;
      return { key: `executed/d1/${payload.envelopeId}.pdf`, hash: "executed-sha256" };
    },
    getExecutedContractUrl: async () => "https://signed/executed",
  },
});

mock.module("@/lib/events/emit", {
  namedExports: { emitDomainEvent: async (event: string) => { ctrl.emits.push({ event }); } },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendContractSignedEmail: async (p: Record<string, unknown>) => { ctrl.buyerEmails.push(p); } },
});

function defaultEnv(): Omit<Env, "id"> {
  return {
    dealId: "d1", status: "PENDING", attemptNumber: 1, documentVersionId: null, documentHash: null,
    signerUserId: null, signerRole: null, signerName: null, signerEmail: null, signatureText: null, signedAt: null,
    consentedToElectronic: false, consentedAt: null, ipAddress: null, userAgent: null,
    certificatePdfPath: null, certificateGeneratedAt: null, voidedAt: null, voidReason: null,
    declineReason: null, expiresAt: null, viewedAt: null, completedAt: null, sentAt: null,
    consentPolicyVersion: null, consentSnapshot: null,
    executedDocumentKey: null, executedDocumentHash: null, executedGeneratedAt: null, confirmationsSentAt: null,
  };
}

async function load() { return import("@/lib/services/esign/buyer-signing.service"); }

// The four required consent acknowledgments (DRAFT_V1), all affirmatively accepted.
const ACK_KEYS = [
  "ELECTRONIC_RECORDS_AND_SIGNATURE",
  "CONTRACT_REVIEW_AND_INDEPENDENT_ADVICE",
  "ACCEPTANCE_AND_INTENT_TO_BE_BOUND",
  "ELECTRONIC_COPY_AND_ACCESS",
] as const;
const allAcks = () => ACK_KEYS.map((key) => ({ key, accepted: true }));
const missingOneAck = () => ACK_KEYS.slice(0, 3).map((key) => ({ key, accepted: true }));
const oneUnchecked = () => ACK_KEYS.map((key, i) => ({ key, accepted: i !== 1 }));

const goodSig = {
  dealId: "d1", signerUserId: "b1", signerName: "Sam Buyer", signerEmail: "sam@example.com",
  signatureText: "Sam Buyer", acknowledgments: allAcks(), ipAddress: "1.2.3.4", userAgent: "Mozilla/5.0",
};

beforeEach(() => {
  ctrl = {
    env: null,
    history: [],
    contract: { id: "cv_1", dealId: "d1", documentUrl: "path/contract.pdf", version: 1, status: "APPROVED" },
    dealStatus: "CONTRACT_APPROVED",
    bytes: "THE CONTRACT BYTES",
    advanceCalls: [], audits: [], certPayloads: [],
    executedPayloads: [], executedFails: false, notifications: [], emits: [], buyerEmails: [],
    dealerPlaceholder: false,
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

test("consent is required — missing an acknowledgment throws and records no signature", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES") };
  const { recordBuyerSignature, ConsentRequiredError } = await load();
  await assert.rejects(() => recordBuyerSignature({ ...goodSig, acknowledgments: missingOneAck() }), (e: unknown) => e instanceof ConsentRequiredError);
  await assert.rejects(() => recordBuyerSignature({ ...goodSig, acknowledgments: oneUnchecked() }), (e: unknown) => e instanceof ConsentRequiredError);
  await assert.rejects(() => recordBuyerSignature({ ...goodSig, acknowledgments: [] }), (e: unknown) => e instanceof ConsentRequiredError);
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
  const actions = ctrl.audits.map((a) => a.action);
  assert.ok(actions.includes("CONSENT_ACCEPTED"), "append-only CONSENT_ACCEPTED audit written");
  assert.ok(actions.includes("ESIGN_SIGNED"), "ESIGN_SIGNED audit written");
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

test("expiry is CAS-guarded — a concurrent completion between read and write is never overwritten to EXPIRED", async () => {
  // The row has actually COMPLETED, but expireIfElapsed observed a stale SENT read.
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", signedAt: new Date(), expiresAt: new Date(Date.now() - 1000) };
  ctrl.staleStatus = "SENT"; // findUnique returns SENT; the CAS then fails against the real COMPLETED
  const { expireIfElapsed } = await load();
  const result = await expireIfElapsed("d1");
  assert.equal(result, false, "the stale expiry loses the CAS");
  assert.equal(ctrl.env?.status, "COMPLETED", "the completed signed record is NOT overwritten to EXPIRED");
});

test("signing a lapsed-but-unswept envelope is rejected (TTL enforced) and records no signature", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES"), expiresAt: new Date(Date.now() - 1000) };
  const { recordBuyerSignature, EnvelopeNotSignableError } = await load();
  await assert.rejects(() => recordBuyerSignature(goodSig), (e: unknown) => e instanceof EnvelopeNotSignableError);
  assert.equal(ctrl.env?.status, "EXPIRED", "the lapsed envelope is expired, not signed");
  assert.equal(ctrl.env?.consentSnapshot, null, "no consent/signature recorded on a lapsed envelope");
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

// ── §1/§2/§3 Consent record ──────────────────────────────────────────────────

test("all four acknowledgments are captured as a frozen snapshot bound to the document + a CONSENT_ACCEPTED audit", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("THE CONTRACT BYTES") };
  ctrl.dealStatus = "SIGNING_PENDING";
  const { recordBuyerSignature } = await load();
  await recordBuyerSignature(goodSig);

  // consent snapshot persisted with policy version + exact acknowledgments
  const snap = ctrl.env?.consentSnapshot as Record<string, unknown> | null;
  assert.ok(snap, "consent snapshot persisted");
  assert.equal(ctrl.env?.consentPolicyVersion, "DRAFT_V1");
  assert.equal(snap!.policyVersion, "DRAFT_V1");
  const acks = snap!.acknowledgments as Array<{ key: string; accepted: boolean; text: string }>;
  assert.equal(acks.length, 4, "all four acknowledgments recorded");
  assert.ok(acks.every((a) => a.accepted === true), "every acknowledgment marked accepted");
  assert.ok(acks.every((a) => typeof a.text === "string" && a.text.length > 0), "exact consent text captured per acknowledgment");
  // bound to the exact document version + hash
  assert.equal(snap!.documentVersionId, "cv_1");
  assert.equal(snap!.documentHash, hashOf("THE CONTRACT BYTES"));
  // full attribution
  assert.equal(snap!.signerUserId, "b1");
  assert.equal(snap!.signerRole, "BUYER");
  assert.equal(snap!.ipAddress, "1.2.3.4");
  assert.equal(snap!.userAgent, "Mozilla/5.0");
  assert.ok(snap!.consentedAt, "consent timestamp captured");
  // append-only CONSENT_ACCEPTED audit with the acknowledgments + binding
  const consentAudit = ctrl.audits.find((a) => a.action === "CONSENT_ACCEPTED");
  assert.ok(consentAudit, "CONSENT_ACCEPTED audit written");
  const meta = consentAudit!.metadata as Record<string, unknown>;
  assert.equal(meta.consentPolicyVersion, "DRAFT_V1");
  assert.equal(meta.documentHash, hashOf("THE CONTRACT BYTES"));
});

test("a changed document blocks signing before any consent is recorded (fails closed)", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", documentVersionId: "cv_1", documentHash: hashOf("ORIGINAL BYTES") };
  ctrl.bytes = "CHANGED BYTES";
  const { recordBuyerSignature, DocumentChangedError } = await load();
  await assert.rejects(() => recordBuyerSignature(goodSig), (e: unknown) => e instanceof DocumentChangedError);
  assert.equal(ctrl.env?.consentSnapshot, null, "no consent snapshot on a changed document");
  assert.equal(ctrl.env?.status, "VOIDED");
});

// ── §4/§5 Executed contract artifact ─────────────────────────────────────────

function completedEnv(extra: Partial<Env> = {}): Env {
  return {
    id: "env_1", ...defaultEnv(), status: "COMPLETED", documentVersionId: "cv_1",
    documentHash: hashOf("THE CONTRACT BYTES"), signedAt: new Date(), consentedAt: new Date(),
    signatureText: "Sam Buyer", signerName: "Sam Buyer", signerEmail: "sam@example.com", signerUserId: "b1",
    signerRole: "BUYER", consentPolicyVersion: "DRAFT_V1",
    consentSnapshot: { policyVersion: "DRAFT_V1", acknowledgments: allAcks().map((a) => ({ ...a, text: "x" })) },
    ...extra,
  } as Env;
}

test("finalize generates the executed artifact from FROZEN evidence and records its key + hash", async () => {
  ctrl.env = completedEnv();
  ctrl.dealStatus = "SIGNED";
  const { finalizeSignedContract } = await load();
  const r = await finalizeSignedContract("d1");
  assert.equal(r.artifactReady, true);
  assert.equal(ctrl.executedPayloads.length, 1, "executed artifact generated once");
  const p = ctrl.executedPayloads[0]!;
  assert.equal(p.documentHash, hashOf("THE CONTRACT BYTES"), "generated from the pinned signed hash");
  assert.equal(p.documentVersionId, "cv_1");
  assert.equal(p.signatureText, "Sam Buyer", "adopted signature embedded");
  assert.ok(p.consentSnapshot, "consent snapshot embedded");
  assert.equal(ctrl.env?.executedDocumentKey, "executed/d1/env_1.pdf");
  assert.equal(ctrl.env?.executedDocumentHash, "executed-sha256");
});

test("an existing executed artifact is IMMUTABLE — later finalize never regenerates or overwrites it", async () => {
  ctrl.env = completedEnv({ executedDocumentKey: "executed/d1/env_1.pdf", executedDocumentHash: "frozen-hash", certificatePdfPath: "cert.pdf", confirmationsSentAt: new Date() });
  const { finalizeSignedContract } = await load();
  await finalizeSignedContract("d1");
  assert.equal(ctrl.executedPayloads.length, 0, "no regeneration when an executed artifact already exists");
  assert.equal(ctrl.env?.executedDocumentHash, "frozen-hash", "the recorded artifact hash is never overwritten");
});

// ── §7 Confirmation sequencing ───────────────────────────────────────────────

test("confirmations NEVER precede the executed artifact — a failed generation sends nothing", async () => {
  ctrl.env = completedEnv();
  ctrl.executedFails = true;
  const { finalizeSignedContract } = await load();
  const r = await finalizeSignedContract("d1");
  assert.equal(r.artifactReady, false);
  assert.equal(r.confirmationsSent, false);
  assert.equal(ctrl.buyerEmails.length, 0, "no buyer confirmation before the artifact exists");
  assert.equal(ctrl.notifications.length, 0, "no dealer notification before the artifact exists");
  assert.equal(ctrl.env?.confirmationsSentAt, null);
});

test("on success: artifact → certificate → confirmations, emitted exactly once; dealer notified", async () => {
  ctrl.env = completedEnv();
  ctrl.dealStatus = "SIGNED";
  const { finalizeSignedContract } = await load();
  const r = await finalizeSignedContract("d1");
  assert.equal(r.artifactReady, true);
  assert.equal(r.certificateReady, true);
  assert.equal(r.confirmationsSent, true);
  assert.equal(ctrl.env?.certificatePdfPath, "buyer-contracts/d1/env_1.pdf");
  assert.equal(ctrl.buyerEmails.length, 1, "buyer confirmation sent once");
  assert.equal(ctrl.emits.filter((e) => e.event === "contract_signed").length, 1);
  const dealerNote = ctrl.notifications.find((n) => (n.metadata as { kind?: string })?.kind === "ESIGN_EXECUTED");
  assert.ok(dealerNote, "dealer notified the contract was executed");
  assert.ok(ctrl.env?.confirmationsSentAt, "confirmations marker set");

  // Idempotent re-run: no duplicate confirmations / notifications.
  ctrl.buyerEmails = []; ctrl.emits = [];
  await finalizeSignedContract("d1");
  assert.equal(ctrl.buyerEmails.length, 0, "no duplicate buyer confirmation");
  assert.equal(ctrl.notifications.filter((n) => (n.metadata as { kind?: string })?.kind === "ESIGN_EXECUTED").length, 1, "dealer notified only once");
});

test("a placeholder (outside) dealer receives no in-app execution notification", async () => {
  ctrl.env = completedEnv();
  ctrl.dealerPlaceholder = true;
  const { finalizeSignedContract } = await load();
  await finalizeSignedContract("d1");
  assert.equal(ctrl.notifications.length, 0, "no in-app notification for a placeholder dealer");
});

// ── §8 Durability reconciliation ─────────────────────────────────────────────

test("reconcile re-drives a COMPLETED envelope missing its artifact/cert/confirmations", async () => {
  ctrl.env = completedEnv();
  ctrl.dealStatus = "SIGNED";
  const { reconcileSignedContracts } = await load();
  const r = await reconcileSignedContracts();
  assert.equal(r.finalized, 1, "the pending envelope was finalized");
  assert.equal(ctrl.env?.executedDocumentKey, "executed/d1/env_1.pdf");
  assert.ok(ctrl.env?.confirmationsSentAt);
});

test("reconcile is idempotent — a fully finalized envelope is not re-processed", async () => {
  ctrl.env = completedEnv({ executedDocumentKey: "executed/d1/env_1.pdf", executedDocumentHash: "h", certificatePdfPath: "cert.pdf", confirmationsSentAt: new Date() });
  const { reconcileSignedContracts } = await load();
  const r = await reconcileSignedContracts();
  assert.equal(r.scanned, 0, "no fully-finalized envelope is scanned");
  assert.equal(ctrl.executedPayloads.length, 0);
});

test("reconcile ignores a legacy DocuSign-completed envelope (no documentVersionId)", async () => {
  // Legacy: COMPLETED with a documentKey but NO in-house documentVersionId.
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", documentVersionId: null, completedAt: new Date() };
  const { reconcileSignedContracts } = await load();
  const r = await reconcileSignedContracts();
  assert.equal(r.scanned, 0, "a legacy envelope is never reconciled");
  assert.equal(ctrl.executedPayloads.length, 0);
});

// ── §9 Expiry sweep ──────────────────────────────────────────────────────────

test("sweep expires stale SENT/DELIVERED/PENDING envelopes and audits each", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "SENT", expiresAt: new Date(Date.now() - 1000) };
  const { sweepExpiredEnvelopes } = await load();
  const r = await sweepExpiredEnvelopes();
  assert.equal(r.expired, 1);
  assert.equal(ctrl.env?.status, "EXPIRED");
  assert.ok(ctrl.audits.some((a) => a.action === "ESIGN_ENVELOPE_EXPIRED"));
});

test("sweep NEVER expires a COMPLETED envelope (terminal, not expirable)", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "COMPLETED", expiresAt: new Date(Date.now() - 1000) };
  const { sweepExpiredEnvelopes } = await load();
  const r = await sweepExpiredEnvelopes();
  assert.equal(r.expired, 0);
  assert.equal(ctrl.env?.status, "COMPLETED");
});

test("sweep NEVER mutates another terminal state (VOIDED stays VOIDED)", async () => {
  ctrl.env = { id: "env_1", ...defaultEnv(), status: "VOIDED", expiresAt: new Date(Date.now() - 1000) };
  const { sweepExpiredEnvelopes } = await load();
  const r = await sweepExpiredEnvelopes();
  assert.equal(r.expired, 0);
  assert.equal(ctrl.env?.status, "VOIDED");
});

// ── §10 Consent + executed refs survive archival ─────────────────────────────

test("consent snapshot + executed-artifact refs are preserved on archival of a superseded terminal attempt", async () => {
  ctrl.env = terminalEnv("EXPIRED", {
    consentPolicyVersion: "DRAFT_V1",
    consentSnapshot: { policyVersion: "DRAFT_V1", acknowledgments: [] },
    executedDocumentKey: "executed/d1/env_1.pdf",
    executedDocumentHash: "executed-sha256",
    executedGeneratedAt: new Date(),
  });
  const { prepareBuyerSigningEnvelope } = await load();
  await prepareBuyerSigningEnvelope("d1", { signerUserId: "b1", signerName: "Sam Buyer", signerEmail: "sam@example.com" });
  assert.equal(ctrl.history.length, 1);
  const archived = ctrl.history[0]!;
  assert.equal(archived.consentPolicyVersion, "DRAFT_V1", "consent policy version survives archival");
  assert.ok(archived.consentSnapshot, "consent snapshot survives archival");
  assert.equal(archived.executedDocumentKey, "executed/d1/env_1.pdf", "executed key stays with the archived attempt");
  assert.equal(archived.executedDocumentHash, "executed-sha256");
  // and the new attempt clears them (never carried forward). consentSnapshot is a
  // JSON column, so it is cleared via Prisma.DbNull rather than a bare null.
  const cleared = ctrl.env?.consentSnapshot as { acknowledgments?: unknown } | null;
  assert.ok(!cleared?.acknowledgments, "the prior consent snapshot is not carried onto the new attempt");
  assert.equal(ctrl.env?.consentPolicyVersion, null);
  assert.equal(ctrl.env?.executedDocumentKey, null);
  assert.equal(ctrl.env?.attemptNumber, 2, "monotonic attempt number");
});
