// Batch 2 — dealer activation verification gate (flag-gated, grandfather-safe).
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer/__tests__/batch2/dealer-activation.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const cfg = {
  status: "PENDING" as string,
  hasSignature: false,
  verified: false,
  marketplaceSignedAt: null as Date | null,
  gateEnforced: false,
};
const calls = { update: [] as unknown[], audit: [] as unknown[], emit: [] as unknown[] };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: {
        findUnique: async () => ({
          status: cfg.status,
          dealershipName: "Test Motors",
          user: { email: "d@x.com" },
          marketplaceAgreementSignedAt: cfg.marketplaceSignedAt,
        }),
        update: async (a: unknown) => { calls.update.push(a); return { id: "d1", status: "ACTIVE", dealershipName: "Test Motors", user: { email: "d@x.com" } }; },
        findMany: async () => [],
      },
      dealerAgreementSignature: { findUnique: async () => (cfg.hasSignature ? { id: "sig" } : null) },
      dealerVerification: { findUnique: async () => ({ verified: cfg.verified }) },
      adminAuditLog: { create: async (a: unknown) => { calls.audit.push(a); return { id: "a" }; } },
    },
  },
});
mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: {
    FLAGS: { DEALER_ACTIVATION_GATE: "dealer_activation_gate" },
    isEnabled: async () => cfg.gateEnforced,
  },
});
mock.module("@/lib/events/emit", {
  namedExports: { emitDomainEvent: async (...a: unknown[]) => { calls.emit.push(a); } },
});

async function load() { return import("@/lib/services/dealer/dealer-activation.service"); }
const actor = { adminId: "system", adminEmail: "system@autolenis.com", reason: "test" };

beforeEach(() => {
  cfg.status = "PENDING"; cfg.hasSignature = false; cfg.verified = false; cfg.marketplaceSignedAt = null; cfg.gateEnforced = false;
  calls.update = []; calls.audit = []; calls.emit = [];
});

test("gate OFF: a PENDING dealer activates even without verification (current behavior preserved)", async () => {
  const { activateDealerIfEligible } = await load();
  const res = await activateDealerIfEligible("d1", actor);
  assert.equal(res.activated, true);
  assert.equal(res.status, "ACTIVE");
  assert.equal(calls.update.length, 1);
});

test("gate ON + not eligible: activation is WITHHELD, dealer stays PENDING (not an error)", async () => {
  cfg.gateEnforced = true; // no signature, not verified
  const { activateDealerIfEligible } = await load();
  const res = await activateDealerIfEligible("d1", actor);
  assert.equal(res.activated, false);
  assert.equal(res.blocked, true);
  assert.equal(res.status, "PENDING");
  assert.equal(calls.update.length, 0, "must not flip to ACTIVE");
});

test("gate ON + eligible (signed + license verified): activates", async () => {
  cfg.gateEnforced = true; cfg.hasSignature = true; cfg.verified = true;
  const { activateDealerIfEligible } = await load();
  const res = await activateDealerIfEligible("d1", actor);
  assert.equal(res.activated, true);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.emit.length, 1, "emits dealer_activated");
});

test("grandfather: an already-ACTIVE dealer is never re-evaluated or changed", async () => {
  cfg.status = "ACTIVE"; cfg.gateEnforced = true; // enforced + would be ineligible
  const { activateDealerIfEligible } = await load();
  const res = await activateDealerIfEligible("d1", actor);
  assert.equal(res.activated, false);
  assert.equal(res.status, "ACTIVE");
  assert.equal(calls.update.length, 0, "must not touch an existing ACTIVE dealer");
});

test("getDealerActivationEligibility reports precise reasons", async () => {
  const { getDealerActivationEligibility } = await load();
  const e = await getDealerActivationEligibility("d1");
  assert.equal(e.eligible, false);
  assert.deepEqual(e.reasons, ["agreement_not_signed", "license_not_verified"]);
});

test("marketplace DocuSign signature counts as a signature", async () => {
  cfg.marketplaceSignedAt = new Date(); cfg.verified = true;
  const { getDealerActivationEligibility } = await load();
  const e = await getDealerActivationEligibility("d1");
  assert.equal(e.eligible, true);
});

test("assertDealerCanActivate throws when enforced + ineligible, no-op when off", async () => {
  const { assertDealerCanActivate, DealerActivationBlockedError } = await load();
  cfg.gateEnforced = true;
  await assert.rejects(() => assertDealerCanActivate("d1"), (err: unknown) => err instanceof DealerActivationBlockedError);
  cfg.gateEnforced = false;
  const e = await assertDealerCanActivate("d1"); // must not throw
  assert.equal(e.eligible, false);
});
