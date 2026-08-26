// G2 — Contract Shield auto-approval on high-confidence PASS.
//
// Two layers, matching the repo convention:
//   • planContractAutoAdvance — PURE decision core: given the deal's current
//     status and the scan classification, what legal transitions should run and
//     should the in-house signing envelope be prepared? No DB, no network.
//   • autoAdvanceContractOnPass — IMPURE seam tested against MOCKED prisma /
//     deal.service / buyer-signing.service to prove the wiring: PASS auto-advances to
//     CONTRACT_APPROVED through the guarded (non-forced) seam and queues the
//     envelope exactly once; a re-scan of an already-approved deal is a no-op;
//     WARNING / FAIL advance nothing and never create an envelope.
//
// Needs module mocking — run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/contract-shield/__tests__/contract-auto-approve.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DealStatus } from "@prisma/client";

// ── Controllable state + spies for the impure seam ───────────────────────────
let dealRow: {
  id: string;
  status: DealStatus;
  buyerId: string;
  buyer: { firstName: string | null; lastName: string | null; user: { email: string | null } | null } | null;
  offer: { dealer: { id: string; dealershipName: string | null; user: { email: string | null } | null } | null } | null;
} | null = null;

let advanceCalls: Array<{ to: DealStatus; force: boolean | undefined }> = [];
let envelopeCalls: Array<[string, string | undefined, string | undefined]> = [];
let createdNotifications: Array<Record<string, unknown>> = [];
let existingNotification: { id: string } | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => dealRow },
      notification: {
        findFirst: async () => existingNotification,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdNotifications.push(data);
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (
      _dealId: string,
      to: DealStatus,
      opts?: { force?: boolean },
    ) => {
      advanceCalls.push({ to, force: opts?.force });
      // Reflect the transition so a subsequent step sees the new status.
      if (dealRow) dealRow.status = to;
    },
  },
});

mock.module("@/lib/services/esign/buyer-signing.service", {
  namedExports: {
    // In-house signing envelope preparation (replaces DocuSign createEnvelope).
    prepareBuyerSigningEnvelope: async (
      dealId: string,
      signer?: { signerName?: string; signerEmail?: string },
    ) => {
      envelopeCalls.push([dealId, signer?.signerEmail, signer?.signerName]);
      return { envelopeId: "env_1", documentVersionId: "cv_1", documentHash: "hash", status: "SENT" };
    },
  },
});

async function load() {
  const mod = await import("@/lib/services/contract-shield/contract-shield.service");
  return mod;
}

function baseDeal(status: DealStatus) {
  return {
    id: "deal_1",
    status,
    buyerId: "buyer_1",
    buyer: { firstName: "Sam", lastName: "Buyer", user: { email: "buyer@example.com" } },
    offer: { dealer: { id: "dealer_1", dealershipName: "Acme Motors", user: { email: "d@x.test" } } },
  };
}

beforeEach(() => {
  dealRow = baseDeal("CONTRACT_REVIEW" as DealStatus);
  advanceCalls = [];
  envelopeCalls = [];
  createdNotifications = [];
  existingNotification = null;
});

// ── Pure planner ─────────────────────────────────────────────────────────────
test("planContractAutoAdvance: PASS at CONTRACT_REVIEW → approve + fire envelope", async () => {
  const { planContractAutoAdvance } = await load();
  assert.deepEqual(planContractAutoAdvance("CONTRACT_REVIEW" as DealStatus, "PASS"), {
    transitions: ["CONTRACT_APPROVED"],
    fireEnvelope: true,
  });
});

test("planContractAutoAdvance: PASS at CONTRACT_PENDING → walk REVIEW then APPROVED + fire", async () => {
  const { planContractAutoAdvance } = await load();
  assert.deepEqual(planContractAutoAdvance("CONTRACT_PENDING" as DealStatus, "PASS"), {
    transitions: ["CONTRACT_REVIEW", "CONTRACT_APPROVED"],
    fireEnvelope: true,
  });
});

test("planContractAutoAdvance: PASS when already approved / signing is a no-op (idempotent)", async () => {
  const { planContractAutoAdvance } = await load();
  for (const s of ["CONTRACT_APPROVED", "SIGNING_PENDING", "SIGNED", "COMPLETED"] as DealStatus[]) {
    assert.deepEqual(
      planContractAutoAdvance(s, "PASS"),
      { transitions: [], fireEnvelope: false },
      `${s} should not re-advance or re-fire`,
    );
  }
});

test("planContractAutoAdvance: WARNING and FAIL never advance or fire", async () => {
  const { planContractAutoAdvance } = await load();
  for (const status of ["WARNING", "FAIL"]) {
    assert.deepEqual(planContractAutoAdvance("CONTRACT_REVIEW" as DealStatus, status), {
      transitions: [],
      fireEnvelope: false,
    });
    assert.deepEqual(planContractAutoAdvance("CONTRACT_PENDING" as DealStatus, status), {
      transitions: [],
      fireEnvelope: false,
    });
  }
});

test("planContractAutoAdvance: a deal not yet in the contract stage is not auto-advanced", async () => {
  const { planContractAutoAdvance } = await load();
  for (const s of ["INSURANCE_PENDING", "FEE_PAID", "ACTIVE", "CANCELLED"] as DealStatus[]) {
    assert.deepEqual(
      planContractAutoAdvance(s, "PASS"),
      { transitions: [], fireEnvelope: false },
      `${s} is not a contract-review state → no auto-advance`,
    );
  }
});

// ── Impure seam ──────────────────────────────────────────────────────────────
test("autoAdvanceContractOnPass: PASS at CONTRACT_PENDING advances twice and fires envelope once", async () => {
  dealRow = baseDeal("CONTRACT_PENDING" as DealStatus);
  const { autoAdvanceContractOnPass } = await load();
  await autoAdvanceContractOnPass("deal_1", "PASS");

  assert.deepEqual(
    advanceCalls.map((c) => c.to),
    ["CONTRACT_REVIEW", "CONTRACT_APPROVED"],
    "walks the legal path CONTRACT_PENDING → REVIEW → APPROVED",
  );
  assert.equal(advanceCalls.every((c) => c.force !== true), true, "uses the GUARDED (non-forced) seam");
  assert.equal(envelopeCalls.length, 1, "envelope queued exactly once");
  assert.deepEqual(envelopeCalls[0], ["deal_1", "buyer@example.com", "Sam Buyer"]);
});

test("autoAdvanceContractOnPass: PASS at CONTRACT_REVIEW advances once and fires envelope once", async () => {
  dealRow = baseDeal("CONTRACT_REVIEW" as DealStatus);
  const { autoAdvanceContractOnPass } = await load();
  await autoAdvanceContractOnPass("deal_1", "PASS");

  assert.deepEqual(advanceCalls.map((c) => c.to), ["CONTRACT_APPROVED"]);
  assert.equal(envelopeCalls.length, 1);
});

test("autoAdvanceContractOnPass: re-scan of an already-approved deal does nothing (idempotent)", async () => {
  dealRow = baseDeal("CONTRACT_APPROVED" as DealStatus);
  const { autoAdvanceContractOnPass } = await load();
  await autoAdvanceContractOnPass("deal_1", "PASS");

  assert.equal(advanceCalls.length, 0, "no transition on re-scan");
  assert.equal(envelopeCalls.length, 0, "no second envelope on re-scan");
});

test("autoAdvanceContractOnPass: WARNING and FAIL advance nothing and never create an envelope", async () => {
  for (const status of ["WARNING", "FAIL"]) {
    dealRow = baseDeal("CONTRACT_REVIEW" as DealStatus);
    advanceCalls = [];
    envelopeCalls = [];
    const { autoAdvanceContractOnPass } = await load();
    await autoAdvanceContractOnPass("deal_1", status);
    assert.equal(advanceCalls.length, 0, `${status} must not advance`);
    assert.equal(envelopeCalls.length, 0, `${status} must not create an envelope`);
  }
});

test("autoAdvanceContractOnPass: PASS creates the caller-owned buyer CONTRACT_APPROVED in-app row", async () => {
  dealRow = baseDeal("CONTRACT_REVIEW" as DealStatus);
  const { autoAdvanceContractOnPass } = await load();
  await autoAdvanceContractOnPass("deal_1", "PASS");

  const buyerNote = createdNotifications.find(
    (n) => n.buyerId === "buyer_1" && n.type === "CONTRACT_APPROVED",
  );
  assert.ok(buyerNote, "buyer must receive the CONTRACT_APPROVED in-app notification");
});

test("autoAdvanceContractOnPass: never throws when the envelope send fails (self-contained)", async () => {
  dealRow = baseDeal("CONTRACT_REVIEW" as DealStatus);
  const mod = await load();
  // Prove the seam is self-contained and never throws on a PASS.
  envelopeCalls = [];
  await assert.doesNotReject(() => mod.autoAdvanceContractOnPass("deal_1", "PASS"));
});
