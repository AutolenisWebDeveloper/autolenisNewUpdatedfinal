// D2a — pickup confirm/propose round-trip: the concurrency-safety headline.
//
// Every transition is an atomic compare-and-swap on (status, proposedAt) — the
// anti-snipe idiom. This proves two concurrent/duplicate transitions from the
// SAME (status, proposedAt) can never BOTH win: exactly one updateMany returns
// count 1, the loser gets a CONFLICT with NO side effects, and the row lands in
// exactly one consistent state (never a contradictory double-booking).
//
// A stateful fake prisma models the conditional UPDATE ... WHERE the same way
// Postgres does: updateMany mutates the in-memory row only when the where still
// matches, so a "concurrent" second call sees the mutated state and matches 0
// rows — the real single-winner guarantee, exercised through the real service.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/pickup/__tests__/pickup-coordination.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── stateful fake prisma (models the CAS UPDATE ... WHERE) ───────────────────
type Row = {
  dealId: string;
  status: string;
  proposedAt: Date | null;
  proposedTime: Date | null;
  proposedBy: string | null;
  counterCount: number;
  scheduledAt: Date | null;
  qrCodeData: string | null;
};

let row: Row;
let dealStatus = "SIGNED";
let advanceShouldThrow = false;
const spies = {
  advance: [] as Array<{ to: string; actorRole?: string }>,
  qr: 0,
  notifs: [] as string[],
  updateManyCount: 0,
};

function applyData(target: Row, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) {
      (target as Record<string, unknown>)[k] =
        ((target as unknown as Record<string, number>)[k] ?? 0) + (v as { increment: number }).increment;
    } else {
      (target as Record<string, unknown>)[k] = v;
    }
  }
}

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && +a === +b);

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async () => ({
          id: "deal_1",
          buyerId: "buyer_1",
          status: dealStatus,
          offer: { dealerId: "dealer_1" },
          pickup: { ...row },
        }),
      },
      pickup: {
        upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          // Initial propose path — treat as create-or-set.
          applyData(row, (row.status === "NOT_SCHEDULED" ? create : update) as Record<string, unknown>);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          spies.updateManyCount += 1;
          const matches =
            where.dealId === row.dealId &&
            row.status === where.status &&
            (where.proposedAt === undefined || sameInstant(row.proposedAt, where.proposedAt as Date));
          if (!matches) return { count: 0 };
          applyData(row, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          applyData(row, data);
          return { ...row };
        },
        findUnique: async () => ({ ...row }),
      },
      notification: { create: async () => ({}) },
      buyerActivityEvent: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (_dealId: string, to: string, opts?: { actorRole?: string }) => {
      if (advanceShouldThrow) throw new Error("DealTransitionError: illegal transition (deal cancelled)");
      spies.advance.push({ to, actorRole: opts?.actorRole });
    },
  },
});

mock.module("@/lib/services/pickup/qr.service", {
  namedExports: {
    generatePickupQr: async () => {
      spies.qr += 1;
      return { data: "qr-data", image: "data:image/png;base64,xxx" };
    },
  },
});

mock.module("@/lib/services/pickup/availability.service", {
  namedExports: {
    // Availability is validated at propose/counter; keep it OK to isolate the CAS.
    checkPickupTime: async () => ({ ok: true }),
  },
});

mock.module("@/lib/services/pickup/pickup-notifications.service", {
  namedExports: {
    notifyDealerProposed: async () => { spies.notifs.push("dealer-proposed"); },
    notifyBuyerCountered: async () => { spies.notifs.push("buyer-countered"); },
    notifyDealerConfirmed: async () => { spies.notifs.push("dealer-confirmed"); },
    notifyPickupEscalated: async () => { spies.notifs.push("escalated"); },
  },
});

async function load() {
  return import("@/lib/services/pickup/pickup-coordination.service");
}

const X = new Date("2026-02-10T18:00:00Z"); // the observed proposedAt token
const T1 = new Date("2026-02-14T18:00:00Z"); // buyer's proposed slot
const T2 = new Date("2026-02-15T18:00:00Z"); // dealer's / buyer's alternative

function resetRow(over: Partial<Row> = {}) {
  row = {
    dealId: "deal_1",
    status: "PROPOSED",
    proposedAt: X,
    proposedTime: T1,
    proposedBy: "BUYER",
    counterCount: 0,
    scheduledAt: null,
    qrCodeData: null,
    ...over,
  };
  dealStatus = "SIGNED";
  advanceShouldThrow = false;
  spies.advance = [];
  spies.qr = 0;
  spies.notifs = [];
  spies.updateManyCount = 0;
}

beforeEach(() => resetRow());

// ── the headline: two transitions from the same (PROPOSED, X) can't both win ──

test("HEADLINE: dealer confirm vs dealer counter from the same (PROPOSED, proposedAt) — exactly one wins", async () => {
  const { confirmPickup, counterAsDealer } = await load();

  // Both observe the same proposedAt = X. Confirm runs first (wins → SCHEDULED),
  // then the counter's CAS no longer matches (status is now SCHEDULED).
  const rConfirm = await confirmPickup("deal_1", "dealer_1", X);
  const rCounter = await counterAsDealer("deal_1", "dealer_1", T2, X);

  assert.equal(rConfirm.ok, true, "confirm wins");
  assert.equal(rCounter.ok, false, "counter loses the race");
  assert.equal((rCounter as { code: string }).code, "CONFLICT");
  assert.equal(row.status, "SCHEDULED", "single consistent terminal state");
  assert.equal(row.scheduledAt && +row.scheduledAt, +T1, "confirmed the proposed time");
  assert.equal(spies.advance.length, 1, "deal advanced exactly once");
  assert.equal(spies.advance[0]!.to, "PICKUP_SCHEDULED");
  assert.equal(spies.qr, 1, "QR generated exactly once (only the winner)");
});

test("reverse order: counter wins first → a later confirm loses, no double-booking", async () => {
  const { confirmPickup, counterAsDealer } = await load();

  const rCounter = await counterAsDealer("deal_1", "dealer_1", T2, X); // wins → DEALER_COUNTERED
  const rConfirm = await confirmPickup("deal_1", "dealer_1", X);       // stale token → loses

  assert.equal(rCounter.ok, true);
  assert.equal(rConfirm.ok, false);
  assert.equal((rConfirm as { code: string }).code, "CONFLICT");
  assert.equal(row.status, "DEALER_COUNTERED");
  assert.equal(spies.advance.length, 0, "no advance — nothing was confirmed");
  assert.equal(spies.qr, 0, "no QR minted on a lost confirm");
});

test("dealer confirming twice: the duplicate is a no-op (idempotent single winner)", async () => {
  const { confirmPickup } = await load();
  const r1 = await confirmPickup("deal_1", "dealer_1", X);
  const r2 = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, "second confirm cannot re-fire");
  assert.equal(spies.advance.length, 1, "deal advanced only once");
  assert.equal(spies.qr, 1, "QR minted only once");
});

test("buyer accept vs buyer counter from the same (DEALER_COUNTERED, proposedAt) — exactly one wins", async () => {
  resetRow({ status: "DEALER_COUNTERED", proposedBy: "DEALER", proposedTime: T2, counterCount: 1 });
  const { acceptCounter, counterAsBuyer } = await load();

  const rAccept = await acceptCounter("deal_1", "buyer_1", X);            // wins → SCHEDULED @ T2
  const rCounter = await counterAsBuyer("deal_1", "buyer_1", T1, X);      // loses

  assert.equal(rAccept.ok, true);
  assert.equal(rCounter.ok, false);
  assert.equal((rCounter as { code: string }).code, "CONFLICT");
  assert.equal(row.status, "SCHEDULED");
  assert.equal(row.scheduledAt && +row.scheduledAt, +T2, "accepted the dealer's countered time");
  assert.equal(spies.advance.length, 1);
});

// ── round-trip behaviour + notifications + cap ───────────────────────────────

test("initial propose sets PROPOSED, notifies the dealer, and does NOT advance the deal", async () => {
  resetRow({ status: "NOT_SCHEDULED", proposedAt: null, proposedTime: null, proposedBy: null });
  const { proposePickup } = await load();
  const r = await proposePickup("deal_1", "buyer_1", T1, "123 Dealer Dr");
  assert.equal(r.ok, true);
  assert.equal(row.status, "PROPOSED");
  assert.equal(row.proposedBy, "BUYER");
  assert.equal(row.scheduledAt, null, "deal not scheduled on a proposal");
  assert.equal(spies.advance.length, 0, "the deal must NOT advance on a proposal");
  assert.ok(spies.notifs.includes("dealer-proposed"), "dealer notified via the rail");
});

test("dealer counter notifies the buyer and does NOT advance the deal", async () => {
  const { counterAsDealer } = await load();
  const r = await counterAsDealer("deal_1", "dealer_1", T2, X);
  assert.equal(r.ok, true);
  assert.equal(row.status, "DEALER_COUNTERED");
  assert.equal(row.proposedBy, "DEALER");
  assert.equal(row.counterCount, 1);
  assert.equal(spies.advance.length, 0, "a counter never advances the deal");
  assert.ok(spies.notifs.includes("buyer-countered"));
});

test("buyer accept advances the deal and notifies the dealer it's confirmed", async () => {
  resetRow({ status: "DEALER_COUNTERED", proposedBy: "DEALER", proposedTime: T2, counterCount: 1 });
  const { acceptCounter } = await load();
  const r = await acceptCounter("deal_1", "buyer_1", X);
  assert.equal(r.ok, true);
  assert.equal(spies.advance.length, 1);
  assert.equal(spies.advance[0]!.actorRole, "BUYER");
  assert.ok(spies.notifs.includes("dealer-confirmed"));
});

test("counter cap: the 3rd counter escalates to EXCEPTION for admin, no advance", async () => {
  resetRow({ status: "PROPOSED", proposedAt: X, proposedTime: T1, counterCount: 2 }); // cap already reached
  const { counterAsDealer } = await load();
  const r = await counterAsDealer("deal_1", "dealer_1", T2, X);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "CAP");
  assert.equal(row.status, "EXCEPTION", "escalated to admin");
  assert.equal(spies.advance.length, 0);
  assert.ok(spies.notifs.includes("escalated"));
});

test("isolation: a foreign dealer id cannot confirm the pickup", async () => {
  const { confirmPickup } = await load();
  const r = await confirmPickup("deal_1", "dealer_OTHER", X);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "NOT_FOUND");
  assert.equal(row.status, "PROPOSED", "no state change for a foreign dealer");
  assert.equal(spies.advance.length, 0);
});

// ── the proposedAt CAS token is load-bearing (not just status) ───────────────

test("TOKEN: a stale proposedAt loses even when the status still matches", async () => {
  // Buyer re-proposes: status flips DEALER_COUNTERED→PROPOSED with a NEW proposedAt (Y).
  resetRow({ status: "DEALER_COUNTERED", proposedBy: "DEALER", proposedTime: T2, counterCount: 1 });
  const { counterAsBuyer, confirmPickup } = await load();
  const Y = new Date("2026-02-11T10:00:00Z");
  const r1 = await counterAsBuyer("deal_1", "buyer_1", T1, X, { now: Y });
  assert.equal(r1.ok, true);
  assert.equal(row.status, "PROPOSED");
  assert.equal(row.proposedAt && +row.proposedAt, +Y, "token advanced to Y");

  // Dealer confirms with the OLD token X. Status is PROPOSED (matches!) but the
  // token is stale → must lose. This fails if the CAS `where` drops proposedAt.
  const r2 = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r2.ok, false);
  assert.equal((r2 as { code: string }).code, "CONFLICT");
  assert.equal(row.status, "PROPOSED", "no confirm on a stale token");
  assert.equal(spies.advance.length, 0);
});

// ── M1: side effects after the CAS are compensated on failure ────────────────

test("COMPENSATION: if the deal advance throws after the CAS, the pickup reverts (no stranded SCHEDULED)", async () => {
  advanceShouldThrow = true; // e.g. the deal was cancelled between propose and confirm
  const { confirmPickup } = await load();
  const r = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "STATE");
  assert.equal(row.status, "PROPOSED", "pickup reverted — never left SCHEDULED on a non-advanced deal");
  assert.equal(row.scheduledAt, null, "scheduledAt cleared on revert");
  assert.equal(row.qrCodeData, null, "QR cleared on revert");
  assert.equal(row.proposedAt && +row.proposedAt, +X, "CAS token restored so a retry works");
});

test("a confirm against a no-longer-confirmable deal (e.g. CANCELLED) is rejected before the CAS", async () => {
  dealStatus = "CANCELLED";
  const { confirmPickup } = await load();
  const r = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "STATE");
  assert.equal(row.status, "PROPOSED", "no CAS attempted on a dead deal");
  assert.equal(spies.updateManyCount, 0);
});
