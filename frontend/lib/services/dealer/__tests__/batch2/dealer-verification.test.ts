// Batch 2 — dealer license verification records (FS-C).
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer/__tests__/batch2/dealer-verification.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row { [k: string]: unknown }
const state = {
  license: null as Row | null,
  verification: null as Row | null,
  audit: [] as Row[],
  createdLicense: [] as Row[],
  upsertedVerification: [] as Row[],
  updatedVerification: [] as Row[],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dealerLicense: {
        findFirst: async () => state.license,
        create: async ({ data }: Row) => { state.createdLicense.push(data as Row); return { id: "lic_1" }; },
      },
      dealerVerification: {
        findUnique: async () => state.verification,
        upsert: async (a: Row) => { state.upsertedVerification.push(a); return { id: "ver_1" }; },
        update: async (a: Row) => { state.updatedVerification.push(a); return { id: "ver_1" }; },
      },
      adminAuditLog: { create: async ({ data }: Row) => { state.audit.push(data as Row); return { id: "a" }; } },
      dealer: { findUnique: async () => null, findMany: async () => [] },
      dealerAgreementSignature: { findUnique: async () => null },
    },
  },
});

async function load() { return import("@/lib/services/dealer/dealer-verification.service"); }

beforeEach(() => {
  state.license = null; state.verification = null; state.audit = [];
  state.createdLicense = []; state.upsertedVerification = []; state.updatedVerification = [];
});

test("isValidLicenseFormat accepts plausible numbers, rejects junk", async () => {
  const { isValidLicenseFormat } = await load();
  assert.equal(isValidLicenseFormat("DL-12345"), true);
  assert.equal(isValidLicenseFormat("ABC123"), true);
  assert.equal(isValidLicenseFormat("ab"), false); // too short
  assert.equal(isValidLicenseFormat(" "), false);
  assert.equal(isValidLicenseFormat("has space"), false);
});

test("recordDealerLicense rejects a malformed license (no records created)", async () => {
  const { recordDealerLicense } = await load();
  const res = await recordDealerLicense("d1", "x", "TX");
  assert.equal(res.ok, false);
  assert.equal(state.createdLicense.length, 0);
  assert.equal(state.upsertedVerification.length, 0);
});

test("recordDealerLicense requires a valid dealership state", async () => {
  const { recordDealerLicense } = await load();
  const res = await recordDealerLicense("d1", "DL-12345", null);
  assert.equal(res.ok, false);
});

test("recordDealerLicense creates a real DealerLicense + PENDING (unverified) DealerVerification", async () => {
  const { recordDealerLicense } = await load();
  const res = await recordDealerLicense("d1", "DL-12345", "TX");
  assert.equal(res.ok, true);
  assert.equal(state.createdLicense.length, 1);
  assert.equal(state.createdLicense[0]!.licenseNum, "DL-12345");
  // Verification is created UNVERIFIED — format validation is not authoritative verification.
  const create = (state.upsertedVerification[0]! as { create: Row }).create;
  assert.equal(create.verified, false);
});

test("recordDealerLicense is idempotent for the same license number (no duplicate license)", async () => {
  state.license = { id: "lic_existing" };
  const { recordDealerLicense } = await load();
  await recordDealerLicense("d1", "DL-12345", "TX");
  assert.equal(state.createdLicense.length, 0, "existing license reused, not duplicated");
});

test("re-saving the SAME already-verified license preserves verified=true", async () => {
  state.license = { id: "lic_existing" };
  state.verification = { id: "ver_1", licenseNum: "DL-12345", verified: true };
  const { recordDealerLicense } = await load();
  await recordDealerLicense("d1", "DL-12345", "TX");
  const update = (state.upsertedVerification[0]! as { update: Row }).update;
  assert.equal(update.verified, true, "same verified license stays verified");
  assert.equal("verifiedAt" in update, false, "does not clear verifiedAt when kept");
});

test("saving a DIFFERENT license resets verified=false and clears verifiedAt/verifiedBy", async () => {
  state.license = null;
  state.verification = { id: "ver_1", licenseNum: "OLD-999", verified: true };
  const { recordDealerLicense } = await load();
  await recordDealerLicense("d1", "DL-12345", "TX");
  const update = (state.upsertedVerification[0]! as { update: Row }).update;
  assert.equal(update.verified, false, "a changed license must be re-verified");
  assert.equal(update.verifiedAt, null);
  assert.equal(update.verifiedBy, null);
});

test("verifyDealerLicense is the ONLY path that sets verified=true, and audits it", async () => {
  state.verification = { id: "ver_1", licenseNum: "DL-12345", state: "TX", verified: false };
  const { verifyDealerLicense } = await load();
  const res = await verifyDealerLicense("d1", "admin_1", "admin@x.com", true, "Confirmed against TX DMV registry");
  assert.equal(res.verified, true);
  const upd = (state.updatedVerification[0]! as { data: Row }).data;
  assert.equal(upd.verified, true);
  assert.equal(upd.verifiedBy, "admin_1");
  assert.ok(upd.verifiedAt instanceof Date);
  assert.equal(state.audit[0]!.action, "DEALER_LICENSE_VERIFIED");
});

test("verifyDealerLicense throws when no license is on file", async () => {
  state.verification = null;
  const { verifyDealerLicense } = await load();
  await assert.rejects(() => verifyDealerLicense("d1", "admin_1", "admin@x.com", true, "reason here"), /No license on file/);
});
