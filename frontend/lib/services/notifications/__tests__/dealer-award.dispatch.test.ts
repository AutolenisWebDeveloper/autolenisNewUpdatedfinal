// Integration tests for the impure dealer-award dispatcher.
//
// The pure planner is covered in dealer-award.test.ts. This file exercises
// `emitDealerAwardOutcomes` against a MOCKED prisma + resend rail to prove the
// dispatcher wiring: it sends exactly one email per notifiable dealer, writes one
// in-app Notification per registered dealer, is idempotent on the in-app channel
// (deduped on the stable metadata key), gives outside/placeholder dealers email
// only, returns quietly on a terminal missing-auction, and — because it now runs
// inside the durable dealerAwardFn worker — PROPAGATES transient load/dispatch
// failures (after attempting every recipient) so the worker retries + dead-letters
// instead of silently dropping notifications.
//
// Needs module mocking — run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/notifications/__tests__/dealer-award.dispatch.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable state + spies ───────────────────────────────────────────────
type OfferRow = {
  id: string;
  dealerId: string;
  otdPriceCents: number;
  externalDealerName: string | null;
  externalDealerEmail: string | null;
  dealer: {
    isSystemPlaceholder: boolean;
    dealershipName: string;
    user: { email: string | null } | null;
  } | null;
};

let offers: OfferRow[] = [];
let buyer: { firstName: string | null; lastName: string | null } | null = null;
let auctionRow: { buyerId: string } | null = { buyerId: "buyer_1" };
let existingNotification: { id: string } | null = null;
// Injectable failures (durable-worker retry semantics).
let offerFindManyError: Error | null = null;
let wonEmailError: Error | null = null;

let wonCalls: Array<Record<string, unknown>> = [];
let lostCalls: Array<Record<string, unknown>> = [];
let createdNotifications: Array<Record<string, unknown>> = [];
let ghlTags: Array<[string | null | undefined, string]> = [];

function registeredOffer(over: Partial<OfferRow> & { id: string }): OfferRow {
  return {
    dealerId: `d-${over.id}`,
    otdPriceCents: 3_000_000,
    externalDealerName: null,
    externalDealerEmail: null,
    dealer: {
      isSystemPlaceholder: false,
      dealershipName: `Dealer ${over.id}`,
      user: { email: `${over.id}@dealer.test` },
    },
    ...over,
  };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: { findUnique: async () => auctionRow },
      buyer: { findUnique: async () => buyer },
      offer: {
        findMany: async () => {
          if (offerFindManyError) throw offerFindManyError;
          return offers;
        },
      },
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

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerOfferWonEmail: async (p: Record<string, unknown>) => {
      wonCalls.push(p);
      if (wonEmailError) throw wonEmailError;
      return { sent: true, outcome: "SENT" };
    },
    sendDealerOfferLostEmail: async (p: Record<string, unknown>) => {
      lostCalls.push(p);
      return { sent: true, outcome: "SENT" };
    },
  },
});

mock.module("@/lib/services/ghl/tag-sync", {
  namedExports: {
    syncGhlTag: (email: string | null | undefined, tag: string) => {
      ghlTags.push([email, tag]);
    },
  },
});

async function loadDispatcher() {
  const mod = await import("@/lib/services/notifications/dealer-award");
  return mod.emitDealerAwardOutcomes;
}

beforeEach(() => {
  auctionRow = { buyerId: "buyer_1" };
  buyer = { firstName: "Sam", lastName: "Buyer" };
  offers = [
    registeredOffer({ id: "win", otdPriceCents: 3_000_000 }),
    registeredOffer({ id: "lose-a", otdPriceCents: 3_100_000 }),
    registeredOffer({ id: "lose-b", otdPriceCents: 3_250_000 }),
  ];
  existingNotification = null;
  offerFindManyError = null;
  wonEmailError = null;
  wonCalls = [];
  lostCalls = [];
  createdNotifications = [];
  ghlTags = [];
});

test("winner gets one won email + one in-app row; each other bidder gets one lost email + one in-app row", async () => {
  const emit = await loadDispatcher();
  await emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" });

  assert.equal(wonCalls.length, 1, "exactly one won email");
  assert.equal(lostCalls.length, 2, "one lost email per other bidder");
  assert.equal(createdNotifications.length, 3, "one in-app row per registered dealer");

  const wonNote = createdNotifications.find((n) => n.type === "DEAL_SELECTED");
  assert.ok(wonNote, "winner in-app notification exists");
  assert.equal(wonNote!.dealerId, "d-win");
  assert.equal(
    (wonNote!.metadata as { key: string }).key,
    "dealer-award:deal1:won:win",
  );
  const lostNotes = createdNotifications.filter((n) => n.type === "OFFER_DECLINED");
  assert.equal(lostNotes.length, 2);
});

test("winner email carries only first name + last initial — no other buyer PII", async () => {
  const emit = await loadDispatcher();
  await emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" });

  const won = wonCalls[0]!;
  assert.equal(won.buyerFirstName, "Sam");
  assert.equal(won.buyerLastInitial, "B");
  // recipient is the DEALER's address, never the buyer's; no full last name field
  assert.equal(won.to, "win@dealer.test");
  assert.equal("buyerLastName" in won, false, "full buyer last name must not be passed");
  // winner GHL tag preserved
  assert.deepEqual(ghlTags, [["win@dealer.test", "dealer-won"]]);
});

test("in-app channel is idempotent: an existing row for the dedupe key suppresses re-create", async () => {
  existingNotification = { id: "already-there" }; // findFirst finds the prior row
  const emit = await loadDispatcher();
  await emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" });

  assert.equal(createdNotifications.length, 0, "no duplicate in-app rows on re-invoke");
  // Emails still go through the idempotent resend rail (its own EmailSendLog dedupe).
  assert.equal(wonCalls.length, 1);
  assert.equal(lostCalls.length, 2);
});

test("outside/placeholder dealer gets an email but no in-app row", async () => {
  offers = [
    registeredOffer({ id: "win", otdPriceCents: 3_000_000 }),
    {
      id: "outside",
      dealerId: "system-placeholder",
      otdPriceCents: 3_400_000,
      externalDealerName: "Outside Motors",
      externalDealerEmail: "outside@dealer.test",
      dealer: { isSystemPlaceholder: true, dealershipName: "Outside Dealer", user: null },
    },
  ];
  const emit = await loadDispatcher();
  await emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" });

  assert.equal(wonCalls.length, 1);
  assert.equal(lostCalls.length, 1, "outside dealer still receives the non-award email");
  const lostRecipient = lostCalls[0]!.to;
  assert.equal(lostRecipient, "outside@dealer.test");
  // only the registered winner gets an in-app row
  assert.equal(createdNotifications.length, 1);
  assert.equal(createdNotifications[0]!.dealerId, "d-win");
});

test("a terminal missing-auction returns quietly (no retry storm)", async () => {
  auctionRow = null;
  const emit = await loadDispatcher();
  await assert.doesNotReject(() =>
    emit({ auctionId: "gone", winningOfferId: "win", dealId: "deal1" }),
  );
  assert.equal(wonCalls.length, 0);
  assert.equal(createdNotifications.length, 0);
});

// ── Finding #1 regression: durability was illusory when the dispatcher swallowed
// its own errors — the worker marked the guard `completed`, blocking re-drive and
// silently dropping every dealer notification. The dispatcher must now PROPAGATE
// transient failures so dealerAwardFn retries + dead-letters. ──────────────────

test("a load-phase DB failure PROPAGATES (worker will retry, not silently complete)", async () => {
  offerFindManyError = new Error("db connection reset");
  const emit = await loadDispatcher();
  await assert.rejects(
    () => emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" }),
    /db connection reset/,
  );
  // nothing dispatched — the whole batch retries from the top
  assert.equal(wonCalls.length, 0);
  assert.equal(lostCalls.length, 0);
  assert.equal(createdNotifications.length, 0);
});

test("a recipient dispatch failure is raised AFTER every recipient is attempted", async () => {
  wonEmailError = new Error("resend enqueue failed");
  const emit = await loadDispatcher();
  await assert.rejects(
    () => emit({ auctionId: "a1", winningOfferId: "win", dealId: "deal1" }),
    /1\/3 dispatch\(es\) failed/,
  );
  // the winner's email was attempted and failed…
  assert.equal(wonCalls.length, 1);
  // …but the two losing dealers were STILL notified on this run (batch isolation)
  assert.equal(lostCalls.length, 2, "one bad recipient must not starve the rest");
  // the winner's in-app row is skipped this run (its iteration threw before it);
  // only the two losers' in-app rows are written — retry re-runs the winner.
  assert.equal(createdNotifications.length, 2);
  assert.ok(
    createdNotifications.every((n) => n.type === "OFFER_DECLINED"),
    "only losing dealers' in-app rows on the failing run",
  );
});
