// Batch 2 — dealer verification gate at AUCTION ELIGIBILITY (flag-gated, default OFF).
// The gate governs who may be invited to compete — NOT portal login — so it is
// satisfiable and grandfather-shaped: existing ACTIVE dealers keep access but,
// once enforced, are excluded from invitations until signed + license-verified.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer/__tests__/batch2/dealer-auction-eligibility.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface St { sig: boolean; verified: boolean; marketplace: Date | null }
const states: Record<string, St> = {};
let gateEnforced = false;

function idOf(args: { where?: { id?: string; dealerId?: string } }): string {
  return String(args.where?.id ?? args.where?.dealerId ?? "");
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealer: { findUnique: async (a: { where?: { id?: string } }) => ({ marketplaceAgreementSignedAt: states[idOf(a)]?.marketplace ?? null }) },
      dealerAgreementSignature: { findUnique: async (a: { where?: { dealerId?: string } }) => (states[idOf(a)]?.sig ? { id: "sig" } : null) },
      dealerVerification: { findUnique: async (a: { where?: { dealerId?: string } }) => ({ verified: states[idOf(a)]?.verified ?? false }) },
    },
  },
});
mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: { FLAGS: { DEALER_VERIFICATION_GATE: "dealer_verification_gate" }, isEnabled: async () => gateEnforced },
});

async function load() { return import("@/lib/services/dealer/dealer-auction-eligibility.service"); }

beforeEach(() => {
  gateEnforced = false;
  states.d1 = { sig: true, verified: true, marketplace: null };   // fully verified
  states.d2 = { sig: true, verified: false, marketplace: null };  // signed, license not verified
  states.d3 = { sig: false, verified: false, marketplace: null }; // nothing
});

test("gate OFF: all candidate dealers pass unchanged (no new blocking)", async () => {
  const { filterAuctionEligibleDealerIds } = await load();
  const set = await filterAuctionEligibleDealerIds(["d1", "d2", "d3"]);
  assert.deepEqual([...set].sort(), ["d1", "d2", "d3"]);
});

test("gate ON: only signed + license-verified dealers are invite-eligible", async () => {
  gateEnforced = true;
  const { filterAuctionEligibleDealerIds } = await load();
  const set = await filterAuctionEligibleDealerIds(["d1", "d2", "d3"]);
  assert.deepEqual([...set], ["d1"]);
});

test("grandfather: an unverified ACTIVE dealer is simply excluded from invitations (never deactivated here)", async () => {
  gateEnforced = true;
  const { filterAuctionEligibleDealerIds } = await load();
  const set = await filterAuctionEligibleDealerIds(["d2"]);
  assert.equal(set.has("d2"), false); // excluded from competing, not touched
});

test("getDealerVerificationEligibility reports precise reasons", async () => {
  const { getDealerVerificationEligibility } = await load();
  const e = await getDealerVerificationEligibility("d3");
  assert.equal(e.eligible, false);
  assert.deepEqual(e.reasons, ["agreement_not_signed", "license_not_verified"]);
});

test("legacy marketplace agreement signature satisfies the signature requirement", async () => {
  states.d4 = { sig: false, verified: true, marketplace: new Date() };
  const { getDealerVerificationEligibility } = await load();
  const e = await getDealerVerificationEligibility("d4");
  assert.equal(e.eligible, true);
});
