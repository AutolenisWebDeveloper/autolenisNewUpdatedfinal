// §27.1 ROWS 3-4 AND 9-11 — the guest's claim link and its three verification reminders.
//
// Four registered template keys with registered state rechecks and, until Phase 10, NO
// ENQUEUE SITE. These pin the sequence, and above all the two things that make it safe to
// call from an UNAUTHENTICATED public route: it refuses anything that is not a guest
// capture, and the live write credential appears in exactly one message.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/acquisition/__tests__/guest-verification.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

interface BuyerRow { id: string; isGuest: boolean; firstName: string | null; supabaseId: string }

let buyer: BuyerRow | null;
let enqueued: Rec[];
let cancelled: Array<{ key: string; reason: string }>;
let liveToken: { expiresAt: Date } | null;
let issued: number;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findUnique: async () =>
          buyer ? { id: buyer.id, isGuest: buyer.isGuest, firstName: buyer.firstName, user: { supabaseId: buyer.supabaseId } } : null,
      },
    },
  },
});

mock.module("@/lib/services/buyer/request-resume-token.service", {
  namedExports: {
    TOKEN_PURPOSE: { CLAIM: "CLAIM", RESUME: "RESUME", LEGACY: "LEGACY" },
    findLiveClaimToken: async () => liveToken,
    issueResumeToken: async () => { issued++; return { rawToken: "raw-secret-token", tokenId: "tok_1" }; },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => { enqueued.push(input); return { enqueued: true }; },
    cancelByKey: async (key: string, reason: string) => { cancelled.push({ key, reason }); return { cancelled: 4 }; },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  buyer = { id: "b1", isGuest: true, firstName: "Ada", supabaseId: "guest_abc" };
  enqueued = [];
  cancelled = [];
  liveToken = null;
  issued = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://autolenis.test";
});

async function svc() {
  return import("../guest-verification.service");
}

const input = { buyerId: "b1", email: "ada@example.invalid", firstName: "Ada", vehicleRequestId: "vr_1" };

test("a guest capture gets the claim link and all three reminders, under one cancel key", async () => {
  const { enqueueGuestVerification, guestVerificationCancelKey } = await svc();
  const result = await enqueueGuestVerification(input);

  assert.equal(result.claimSent, true);
  assert.equal(result.remindersEnqueued, 3);
  assert.equal(enqueued.length, 4);

  assert.deepEqual(
    enqueued.map((e) => e.templateKey),
    ["guest_capture_claim", "verification_reminder_1h", "verification_reminder_24h", "verification_reminder_72h"],
  );
  for (const row of enqueued) {
    assert.equal(row.cancelKey, guestVerificationCancelKey("b1"), "one handle stops the whole sequence");
    assert.equal(row.recipientId, "b1", "an exception from this sequence must be able to name the buyer");
    assert.equal(row.vehicleRequestId, "vr_1");
  }
});

test("the reminders are scheduled at 1h, 24h and 72h — not sent at once", async () => {
  const from = new Date("2026-09-17T12:00:00.000Z");
  const { enqueueGuestVerification } = await svc();
  await enqueueGuestVerification({ ...input, from });

  assert.equal(enqueued[0]!.runAt, undefined, "the claim link goes now");
  const at = (i: number) => (enqueued[i]!.runAt as Date).toISOString();
  assert.equal(at(1), "2026-09-17T13:00:00.000Z");
  assert.equal(at(2), "2026-09-18T12:00:00.000Z");
  assert.equal(at(3), "2026-09-20T12:00:00.000Z");
});

test("THE CREDENTIAL APPEARS IN EXACTLY ONE MESSAGE", async () => {
  const { enqueueGuestVerification } = await svc();
  await enqueueGuestVerification(input);

  const carrying = enqueued.filter((row) => JSON.stringify(row.payload).includes("raw-secret-token"));
  assert.equal(
    carrying.length,
    1,
    "the claim token is a live write credential with a days-long life, and the three reminders sit " +
      "in the outbox for up to 72 hours before they are sent. One copy at rest, not four.",
  );
  assert.equal(carrying[0]!.templateKey, "guest_capture_claim");
});

test("REFUSES a claimed account — a public form must not mint a claim credential for one", async () => {
  buyer = { id: "b1", isGuest: false, firstName: "Ada", supabaseId: "sb_real" };
  const { enqueueGuestVerification } = await svc();
  const result = await enqueueGuestVerification(input);

  assert.deepEqual(result.reason, "not_a_guest");
  assert.equal(result.claimSent, false);
  assert.equal(issued, 0, "no token is minted");
  assert.deepEqual(enqueued, []);
});

test("both halves of 'guest' must agree — the flag alone is not enough", async () => {
  // `isGuest` is the intake flag; the `guest_` prefix is the identity fact `skipIfVerified`
  // reads. A row where they disagree has been half-claimed, and minting against it is the
  // takeover primitive this guard exists to refuse.
  buyer = { id: "b1", isGuest: true, firstName: "Ada", supabaseId: "sb_real" };
  const { enqueueGuestVerification } = await svc();
  assert.equal((await enqueueGuestVerification(input)).reason, "not_a_guest");
  assert.equal(issued, 0);
});

test("a live claim link is not reissued — one credential per inbox", async () => {
  liveToken = { expiresAt: new Date(Date.now() + 86_400_000) };
  const { enqueueGuestVerification } = await svc();
  const result = await enqueueGuestVerification(input);

  assert.equal(result.reason, "claim_link_already_live");
  assert.equal(issued, 0);
  assert.deepEqual(enqueued, [], "the link is already in that inbox; a second is a second live credential");
});

test("an unknown buyer is refused rather than guessed at", async () => {
  buyer = null;
  const { enqueueGuestVerification } = await svc();
  assert.equal((await enqueueGuestVerification(input)).reason, "buyer_not_found");
  assert.equal(issued, 0);
});

test("claiming cancels the whole sequence by the same handle", async () => {
  const { cancelGuestVerification, guestVerificationCancelKey } = await svc();
  const out = await cancelGuestVerification("b1", "guest claimed their account");

  assert.equal(out.cancelled, 4);
  assert.deepEqual(cancelled, [
    { key: guestVerificationCancelKey("b1"), reason: "guest claimed their account" },
  ]);
});
