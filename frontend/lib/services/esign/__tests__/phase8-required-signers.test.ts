// §13-D30 — the signer derivation and the cutover it exists to survive.
//
// THE DEFECT THESE PIN. Until Phase 8, `e_sign_envelopes.deal_id` was absolutely unique, so
// "the deal is signed" was a property of ONE row and a dozen surfaces read it that way:
//
//     deal.eSignEnvelope?.status === "COMPLETED"
//
// Dropping that unique lets the co-buyer hold a second envelope, and every one of those
// reads silently becomes "SOME signer finished" rather than "EVERY required signer
// finished". The failure is a buyer signing, a required co-buyer never signing, and pickup
// being allowed — which is the exact scenario Stage 13/14c exists to prevent.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/esign/__tests__/phase8-required-signers.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

interface DealRow {
  buyer: { firstName: string; lastName: string; user: { email: string } } | null;
  coBuyer: {
    id: string; legalFirstName: string | null; legalLastName: string | null;
    email: string | null; isRequiredSigner: boolean;
  } | null;
}
let dealRow: DealRow | null = null;
let envelopes: { signerKind: string; status: string }[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => dealRow },
      eSignEnvelope: {
        findMany: async (args: { where: { signerKind: { in: string[] } } }) =>
          envelopes.filter((e) => args.where.signerKind.in.includes(e.signerKind)),
      },
    },
  },
});

const mod = () => import("../required-signers");

const BUYER_ONLY: DealRow = {
  buyer: { firstName: "Ada", lastName: "Lovelace", user: { email: "ada@example.com" } },
  coBuyer: null,
};
const WITH_REQUIRED_CO_BUYER: DealRow = {
  buyer: { firstName: "Ada", lastName: "Lovelace", user: { email: "ada@example.com" } },
  coBuyer: {
    id: "cb_1", legalFirstName: "Grace", legalLastName: "Hopper",
    email: "grace@example.com", isRequiredSigner: true,
  },
};
const WITH_NON_SIGNING_CO_BUYER: DealRow = {
  ...WITH_REQUIRED_CO_BUYER,
  coBuyer: { ...WITH_REQUIRED_CO_BUYER.coBuyer!, isRequiredSigner: false },
};

test("a deal with no co-buyer requires exactly the buyer", async () => {
  dealRow = BUYER_ONLY;
  const { requiredSignersForDeal } = await mod();
  const signers = await requiredSignersForDeal("d1");
  assert.deepEqual(signers.map((s) => s.signerKind), ["BUYER"]);
  assert.equal(signers[0].coBuyerId, null);
});

test("a co-buyer is required ONLY when isRequiredSigner is set", async () => {
  const { requiredSignersForDeal } = await mod();

  dealRow = WITH_REQUIRED_CO_BUYER;
  assert.deepEqual((await requiredSignersForDeal("d1")).map((s) => s.signerKind), ["BUYER", "CO_BUYER"]);

  // A co-buyer named on the deal as a FINANCING co-applicant is not a signatory, and
  // treating them as one would block every such contract on a signature nobody owes.
  dealRow = WITH_NON_SIGNING_CO_BUYER;
  assert.deepEqual((await requiredSignersForDeal("d1")).map((s) => s.signerKind), ["BUYER"]);
});

test("THE DEFECT: the buyer signing is NOT the deal being signed when a co-buyer is required", async () => {
  dealRow = WITH_REQUIRED_CO_BUYER;
  envelopes = [{ signerKind: "BUYER", status: "COMPLETED" }];
  const { signatureProgress, allRequiredSignaturesComplete } = await mod();

  const progress = await signatureProgress("d1");
  assert.equal(progress.allSigned, false, "one of two signatures is not all of them");
  assert.deepEqual(progress.completed, ["BUYER"]);
  assert.deepEqual(progress.outstanding, ["CO_BUYER"]);
  assert.equal(await allRequiredSignaturesComplete("d1"), false);
});

test("allSigned is true only when every required signer has COMPLETED", async () => {
  dealRow = WITH_REQUIRED_CO_BUYER;
  envelopes = [
    { signerKind: "BUYER", status: "COMPLETED" },
    { signerKind: "CO_BUYER", status: "COMPLETED" },
  ];
  const { signatureProgress } = await mod();
  const progress = await signatureProgress("d1");
  assert.equal(progress.allSigned, true);
  assert.equal(progress.outstanding.length, 0);
});

test("a DECLINED or EXPIRED envelope is blocked, never counted as complete", async () => {
  dealRow = WITH_REQUIRED_CO_BUYER;
  const { signatureProgress } = await mod();
  for (const status of ["DECLINED", "VOIDED", "EXPIRED"]) {
    envelopes = [
      { signerKind: "BUYER", status: "COMPLETED" },
      { signerKind: "CO_BUYER", status },
    ];
    const progress = await signatureProgress("d1");
    assert.equal(progress.allSigned, false, `${status} must not satisfy the gate`);
    assert.deepEqual(progress.blocked, ["CO_BUYER"]);
  }
});

test("FAIL CLOSED: a deal that cannot be read never reads as signed", async () => {
  dealRow = null;
  envelopes = [];
  const { signatureProgress } = await mod();
  const progress = await signatureProgress("d1");
  assert.equal(progress.allSigned, false, "an unreadable deal must never report as fully signed");
  assert.deepEqual(progress.required, []);
});

// ── The pure helpers the already-loaded surfaces use ─────────────────────────
// A page holding `deal.eSignEnvelopes` must reach the SAME answer as the server gate
// without a second query. These pin that they do.

test("allSignedFrom matches the queried derivation, including the fail-closed empty case", async () => {
  const { allSignedFrom, requiredKindsFrom, pickSignerEnvelope } = await mod();

  assert.deepEqual(requiredKindsFrom({ isRequiredSigner: true }), ["BUYER", "CO_BUYER"]);
  assert.deepEqual(requiredKindsFrom({ isRequiredSigner: false }), ["BUYER"]);
  assert.deepEqual(requiredKindsFrom(null), ["BUYER"]);

  const both = [
    { signerKind: "BUYER" as const, status: "COMPLETED" },
    { signerKind: "CO_BUYER" as const, status: "SENT" },
  ];
  assert.equal(allSignedFrom(both, ["BUYER", "CO_BUYER"]), false);
  assert.equal(allSignedFrom(both, ["BUYER"]), true);

  // An empty required list must NOT read as "everything is signed" — `Array.every` on an
  // empty array is true, which is precisely how a fail-open bug gets written here.
  assert.equal(allSignedFrom(both, []), false);
  assert.equal(allSignedFrom([], ["BUYER"]), false);
  assert.equal(allSignedFrom(null, ["BUYER"]), false);

  // And the surfaces must be able to tell the two apart, which is what the /admin/esign
  // hub could not do: two identical rows, same name, same date, both SENT.
  assert.equal(pickSignerEnvelope(both, "CO_BUYER")?.status, "SENT");
  assert.equal(pickSignerEnvelope(both, "BUYER")?.status, "COMPLETED");
  assert.equal(pickSignerEnvelope([], "BUYER"), null);
});
