// Batch 2 — shared dealer agreement signature recording (FS-B).
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/agreement/__tests__/dealer-agreement.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let existingSig: Record<string, unknown> | null = null;
const calls = { sigCreate: [] as Record<string, unknown>[], dealerUpdate: [] as Record<string, unknown>[], audit: [] as Record<string, unknown>[] };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealerAgreementSignature: {
        findUnique: async () => existingSig,
      },
      dealer: {
        findUnique: async () => ({ agreedToTermsAt: null }),
        update: async (a: Record<string, unknown>) => { calls.dealerUpdate.push(a); return { id: "d1" }; },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        dealerAgreementSignature: { create: async ({ data }: Record<string, unknown>) => { calls.sigCreate.push(data as Record<string, unknown>); return { id: "sig_1", signedAt: new Date("2026-08-24T00:00:00Z") }; } },
        dealer: { update: async (a: Record<string, unknown>) => { calls.dealerUpdate.push(a); return { id: "d1" }; } },
        adminAuditLog: { create: async ({ data }: Record<string, unknown>) => { calls.audit.push(data as Record<string, unknown>); return { id: "a" }; } },
      }),
    },
  },
});
// Cert + email are exercised only inside after(); stub so the module loads cleanly.
mock.module("@/lib/services/agreement/certificate.service", {
  namedExports: { generateAndUploadCertificate: async () => "path/cert.pdf", getSignedCertificateUrl: async () => "https://x/cert" },
});
mock.module("@/lib/services/email/dealer-agreement-confirmation.service", {
  namedExports: { sendDealerAgreementConfirmation: async () => ({ success: true, messageId: "m1" }) },
});

async function load() { return import("@/lib/services/agreement/dealer-agreement.service"); }

beforeEach(() => { existingSig = null; calls.sigCreate = []; calls.dealerUpdate = []; calls.audit = []; });

test("computeAgreementHash is a deterministic 64-char sha256 hex", async () => {
  const { computeAgreementHash } = await load();
  const h1 = computeAgreementHash();
  const h2 = computeAgreementHash();
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("records a REAL signature (hash + ip + ua), completes onboarding, audits — never a bare timestamp", async () => {
  const { recordDealerAgreementSignature } = await load();
  const res = await recordDealerAgreementSignature({
    dealerId: "d1", dealershipName: "Test Motors", signerEmail: "d@x.com",
    ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0",
  });
  assert.equal(res.alreadySigned, false);
  assert.match(res.agreementHash, /^[0-9a-f]{64}$/);
  const sig = calls.sigCreate[0]!;
  assert.equal(sig.ipAddress, "203.0.113.7");
  assert.equal(sig.userAgent, "Mozilla/5.0");
  assert.equal(sig.consentedToElectronic, true);
  assert.match(String(sig.agreementHash), /^[0-9a-f]{64}$/);
  // onboarding completed + audit written
  assert.ok(calls.dealerUpdate.some((u) => (u as { data?: { onboardingStep?: string } }).data?.onboardingStep === "COMPLETE"));
  assert.equal(calls.audit[0]!.action, "DEALER_AGREEMENT_SIGNED");
});

test("idempotent: an existing signature is not recreated", async () => {
  existingSig = { id: "sig_prev", signedAt: new Date("2026-08-01T00:00:00Z"), agreementHash: "abc" };
  const { recordDealerAgreementSignature } = await load();
  const res = await recordDealerAgreementSignature({
    dealerId: "d1", dealershipName: "Test Motors", signerEmail: "d@x.com", ipAddress: "1.1.1.1", userAgent: "UA",
  });
  assert.equal(res.alreadySigned, true);
  assert.equal(res.signatureId, "sig_prev");
  assert.equal(calls.sigCreate.length, 0, "no new signature created");
});
