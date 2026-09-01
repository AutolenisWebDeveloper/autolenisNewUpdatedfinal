// What the buyer is TOLD while a deal sits at CONTRACT_PENDING.
//
// Regression target: two messages asserted things that were not true.
//
//  1. nudge.service.ts fired every 24h at CONTRACT_PENDING with
//     "Your contract is ready to review — Review your purchase contract to
//     continue your deal" → /buyer/contracts. CONTRACT_PENDING means the contract
//     has NOT been produced yet; that is the definition of the stage. So the claim
//     was false on every track, and there is no buyer action to take. On a
//     concierge deal it was false indefinitely, because no ContractVersion could
//     ever be created (Finding 2) — the buyer was sent, every day, to a page that
//     could not show a contract.
//
//  2. acquisition-comms.ts told every buyer at CONTRACT_PENDING that "The dealer
//     is preparing your contract." A concierge deal has no dealer at all — Deal.offerId
//     is null and VehicleRequestOffer carries no dealer identity.
//
// Making contracts obtainable does not retire these: CONTRACT_PENDING remains a
// legitimate waiting stage on both tracks, so the copy itself has to be true.
// These tests pin the claim, not the wording — they assert what may NOT be said.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/notifications/__tests__/contract-stage-messaging.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Notif { buyerId: string; title: string; body: string; actionUrl?: string | null; type?: string }

let notifications: Notif[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // No pre-deposit buyers — this test is only about the deal-stage nudges.
      buyer: { findMany: async () => [] },
      nudgeConfiguration: { findUnique: async () => null },
      nudgeEvent: {
        count: async () => 0,
        findFirst: async () => null,
        create: async () => ({ id: "ne_1" }),
      },
      // One concierge deal parked at CONTRACT_PENDING past the nudge threshold.
      deal: {
        findMany: async ({ where }: { where: { status: string } }) =>
          where.status === "CONTRACT_PENDING" ? [{ id: "deal_1", buyerId: "buyer_1" }] : [],
      },
      notification: {
        create: async ({ data }: { data: Notif }) => {
          notifications.push(data);
          return data;
        },
      },
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => { notifications = []; });

// Claims that are false while a contract does not yet exist.
const FALSE_READINESS = [
  /ready to review/i,
  /your contract is ready/i,
  /review your purchase contract/i,
  /sign/i,
];

test("the CONTRACT_PENDING nudge never claims a contract is ready to review", async () => {
  const { runNudgeEngine } = await import("@/lib/services/nudge/nudge.service");
  await runNudgeEngine();

  const sent = notifications.filter((n) => n.buyerId === "buyer_1");
  assert.ok(sent.length > 0, "a stalled deal should still surface something to the buyer");

  for (const n of sent) {
    const text = `${n.title} ${n.body}`;
    for (const claim of FALSE_READINESS) {
      assert.doesNotMatch(
        text,
        claim,
        `CONTRACT_PENDING means no contract exists yet — must not claim "${claim.source}": ${JSON.stringify(text)}`,
      );
    }
  }
});

test("the CONTRACT_PENDING nudge does not send the buyer to a contract page that has nothing to show", async () => {
  const { runNudgeEngine } = await import("@/lib/services/nudge/nudge.service");
  await runNudgeEngine();

  const sent = notifications.filter((n) => n.buyerId === "buyer_1");
  for (const n of sent) {
    assert.notEqual(
      n.actionUrl,
      "/buyer/contracts",
      "there is no contract to review at this stage — pointing there is the deceptive part",
    );
  }
});

test("the CONTRACT_PENDING stage message does not assert a dealer is preparing the contract", async () => {
  // Concierge deals have no dealer; the copy must hold for both tracks.
  const { dealStatusCommsPlan } = await import("@/lib/services/notifications/acquisition-comms");
  const msg = dealStatusCommsPlan("CONTRACT_PENDING");
  assert.ok(msg, "CONTRACT_PENDING must still produce a buyer message");
  const text = `${msg!.title} ${msg!.body}`;
  assert.doesNotMatch(
    text,
    /\bthe dealer\b/i,
    `a concierge deal has no dealer — this copy is false for that track: ${JSON.stringify(text)}`,
  );
  for (const claim of FALSE_READINESS) {
    assert.doesNotMatch(text, claim, `must not claim readiness at CONTRACT_PENDING: ${JSON.stringify(text)}`);
  }
});
