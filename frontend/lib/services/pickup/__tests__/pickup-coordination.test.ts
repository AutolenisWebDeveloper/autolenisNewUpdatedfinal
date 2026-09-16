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
};

let row: Row;
// FUNDING_PENDING, not SIGNED. §13-D29 and §Stage 14 moved the rung a pickup may be
// proposed and confirmed from: the buyer's signature is no longer the last gate before a
// vehicle moves, the six-item funding clearance is. Updating the fixture rather than the
// guard is the point — the guard is the new rule.
let dealStatus = "FUNDING_PENDING";
let advanceShouldThrow = false;
const spies = {
  advance: [] as Array<{ to: string; actorRole?: string }>,
  /** Every `data` this suite writes to the pickup row, so a credential write cannot hide. */
  writes: [] as Array<Record<string, unknown>>,
  /** Every `select` the service reads the returned row with — six routes ship that row. */
  reads: [] as Array<Record<string, boolean> | undefined>,
  notifs: [] as string[],
  /** In-app rows actually created, so §8.2 defect (6)'s retry guard is asserted, not assumed. */
  inApp: [] as Array<Record<string, unknown>>,
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
          const half = (row.status === "NOT_SCHEDULED" ? create : update) as Record<string, unknown>;
          spies.writes.push(half);
          applyData(row, half);
          return { ...row };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          spies.updateManyCount += 1;
          const matches =
            where.dealId === row.dealId &&
            row.status === where.status &&
            (where.proposedAt === undefined || sameInstant(row.proposedAt, where.proposedAt as Date));
          if (!matches) return { count: 0 };
          spies.writes.push(data);
          applyData(row, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          spies.writes.push(data);
          applyData(row, data);
          return { ...row };
        },
        findUnique: async (args?: { select?: Record<string, boolean> }) => {
          spies.reads.push(args?.select);
          if (!args?.select) return { ...row };
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(args.select)) out[k] = (row as unknown as Record<string, unknown>)[k];
          return out;
        },
      },
      // PHASE 9 (§8.2 defect 6). The buyer's confirmation notice is now written through
      // `createNotificationOnce`, which reads before it writes. `findFirst` returning null means
      // "not yet sent", which is the state every test here starts from; `spies.inApp` records the
      // creates so the retry guard can be asserted rather than assumed.
      notification: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => { spies.inApp.push(data); return {}; },
      },
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

// PHASE 9. Readiness is §Stage 16's own concern and has its own suite; this one is about
// turn-taking, so the gate is mocked OPEN here and every test below exercises the turn-taking
// with readiness satisfied.
//
// THE CLOSED CASE IS NOT SKIPPED, IT IS IN ITS OWN FILE. A mock that is always open is
// indistinguishable from an absent gate, so `pickup-readiness-gate.test.ts` mocks it closed and
// asserts `confirmPickup` refuses and names the outstanding item. It lives separately because
// node:test module mocks do not observe later mutations of a flag in the test module — a shared
// `let` read `true` inside the service while the test had already set it `false`, which would
// have made a flag-driven version of that assertion pass while proving nothing.
mock.module("@/lib/services/pickup/pickup-readiness.service", {
  namedExports: {
    enterPickupReadiness: async () => ({
      evaluation: { items: [], outstanding: [], ready: true },
      entered: false,
      schedulable: true,
    }),
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
    // PHASE 9 (§8.2 defect 6). The buyer's confirmation notice goes through this guarded create
    // now. Recording the key lets the retry guard be asserted rather than assumed — and omitting
    // it from this mock made `createNotificationOnce` undefined, which threw inside the
    // confirmation side effects and compensated the whole confirm away. Four "exactly one wins"
    // tests went red for a reason that had nothing to do with turn-taking.
    createNotificationOnce: async (input: Record<string, unknown>) => {
      const key = String(input.idempotencyKey);
      if (spies.inApp.some((n) => n.idempotencyKey === key)) return false;
      spies.inApp.push(input);
      return true;
    },
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
    ...over,
  };
  dealStatus = "FUNDING_PENDING";
  advanceShouldThrow = false;
  spies.advance = [];
  spies.writes = [];
  spies.reads = [];
  spies.notifs = [];
  spies.inApp = [];
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
  assert.deepEqual(spies.advance.map((a) => a.to), ["PICKUP_SCHEDULED"], "only the winner ran the side effects");
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
  assert.deepEqual(spies.advance, [], "a lost confirm runs no side effects at all");
});

test("dealer confirming twice: the duplicate is a no-op (idempotent single winner)", async () => {
  const { confirmPickup } = await load();
  const r1 = await confirmPickup("deal_1", "dealer_1", X);
  const r2 = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false, "second confirm cannot re-fire");
  assert.equal(spies.advance.length, 1, "deal advanced only once");
  assert.equal(spies.updateManyCount, 2, "both confirms attempted the CAS; only one matched");
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
  // The revert no longer clears a QR column, because there is no longer one to clear. What makes
  // a code minted before this revert unusable is the STATUS it restores: `resolveReleaseToken`
  // re-checks the pickup's own state and refuses anything outside SCHEDULED / RESCHEDULED /
  // CHECKED_IN, so a PROPOSED row resolves as `pickup_not_releasable`. Stamping `token_revoked_at`
  // here instead would record a revocation on pickups that never had a code.
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

// ── The credential this flow no longer writes ────────────────────────────────
//
// `runConfirmSideEffects` used to generate a QR payload and store it, plus its rendered PNG, on
// the pickup row. That is the plaintext-at-rest defect Phase 9 closes, and an absence needs a
// test or the next reader "restores the missing field". A release token is only useful to
// whoever holds the RAW value, and a confirmation has nobody to hand it to: the buyer reveals
// theirs from the pickup page, which mints at that moment and retires whatever came before.

const CREDENTIAL_COLUMNS = ["qrCodeData", "qrCodeImage", "qrExpiresAt", "tokenHash"];

test("NO credential column is written anywhere in the propose → confirm round-trip", async () => {
  const { proposePickup, confirmPickup } = await load();
  resetRow({ status: "NOT_SCHEDULED", proposedAt: null, proposedTime: null, proposedBy: null });
  await proposePickup("deal_1", "buyer_1", T1, "123 Dealer Dr, Dallas TX");
  await confirmPickup("deal_1", "dealer_1", row.proposedAt!);

  // ANTI-VACUITY: if nothing was written at all, this test proves nothing about what was not.
  assert.ok(spies.writes.length >= 2, `only ${spies.writes.length} writes captured — the spy is broken, not the service`);
  for (const data of spies.writes) {
    for (const col of CREDENTIAL_COLUMNS) {
      assert.equal(col in data, false, `${col} must never be written by the coordination flow`);
    }
  }
});

test("a compensated confirm writes no credential column either", async () => {
  advanceShouldThrow = true;
  const { confirmPickup } = await load();
  await confirmPickup("deal_1", "dealer_1", X);
  assert.ok(spies.writes.length >= 2, "the CAS and its compensating revert must both have been captured");
  for (const data of spies.writes) {
    for (const col of CREDENTIAL_COLUMNS) {
      assert.equal(col in data, false, `${col} must not appear in the revert either`);
    }
  }
});

test("every pickup row this service RETURNS is projected, never the raw model", async () => {
  // Six routes hand `result.pickup` straight to a browser (`successResponse({ pickup })` in the
  // buyer schedule/reschedule/accept/counter and the dealer propose/confirm routes).
  // `prisma.pickup.findUnique` WITHOUT a select returns `token_hash` with it, and a hash on the
  // wire is an offline oracle for whoever reads it there (see pickup-select.ts).
  const { PICKUP_SAFE_SELECT } = await import("../pickup-select");
  const { confirmPickup } = await load();

  const r = await confirmPickup("deal_1", "dealer_1", X);
  assert.equal(r.ok, true);

  // ANTI-VACUITY: no reads captured means the spy missed them, not that they were safe.
  assert.ok(spies.reads.length >= 1, `only ${spies.reads.length} row reads captured — the spy is broken`);
  for (const select of spies.reads) {
    assert.ok(select, "the returned row must be read WITH a select; an omitted one returns every column");
    assert.equal("tokenHash" in select, false);
    assert.deepEqual(Object.keys(select), Object.keys(PICKUP_SAFE_SELECT), "and it must be THE projection, not an ad-hoc one");
  }
});
