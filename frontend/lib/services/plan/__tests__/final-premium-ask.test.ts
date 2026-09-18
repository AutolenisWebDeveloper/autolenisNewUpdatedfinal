// §23.2a TOUCHPOINT 5 — the second and final Premium ask, and the rules that stop it.
//
// PHASE 10 found `PHASE_7_TEMPLATES.PREMIUM_FOLLOW_UP_FINAL` registered, rendered, and
// enqueued by nothing: §23.2a's last ask was never made, and §23.2b's `MAX_UPGRADE_EMAILS = 2`
// was a ceiling one ask below the floor. These pin the caller that closes that, and — more
// importantly — the three ways it must decline to fire.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/plan/__tests__/final-premium-ask.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let events: Rec[];
let enqueued: Rec[];
let suppressed: { suppressed: boolean; reason: string };
let dueCents: number;
let buyerEmail: string | null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerActivityEvent: {
        create: async (a: Rec) => { events.push((a as { data: Rec }).data); return {}; },
        findMany: async ({ where }: { where: Rec }) =>
          events
            .filter((e) => e.buyerId === where.buyerId && e.eventType === where.eventType)
            .map((e) => ({ metadata: e.metadata, createdAt: new Date() })),
        findFirst: async ({ where }: { where: Rec }) =>
          events.find((e) => e.buyerId === where.buyerId && e.eventType === where.eventType) ?? null,
      },
      buyer: {
        findUnique: async () => ({ firstName: "Ada", user: buyerEmail ? { email: buyerEmail } : null }),
      },
    },
  },
});

mock.module("@/lib/services/plan/upgrade-suppression.service", {
  namedExports: { isUpgradePromptSuppressed: async () => suppressed },
});
mock.module("@/lib/services/plan/upgrade-window.service", {
  namedExports: { quotePremiumBalance: async () => ({ dueCents }) },
});
/** Flipped by the crash test; the module namespace itself is frozen and cannot be patched. */
let enqueueThrows = false;

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Rec) => {
      if (enqueueThrows) throw new Error("outbox unavailable");
      enqueued.push(input);
      return { enqueued: true };
    },
  },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  events = [];
  enqueued = [];
  suppressed = { suppressed: false, reason: "not_suppressed" };
  dueCents = 40_000;
  buyerEmail = "ada@example.invalid";
  enqueueThrows = false;
});

const ask = { buyerId: "b1", vehicleRequestId: "vr_1", dealId: "d1" };

async function svc() {
  return import("../upgrade-touchpoint.service");
}

test("the final ask is enqueued on the §27 rail, request-scoped, when nothing suppresses it", async () => {
  const { sendFinalPremiumAsk } = await svc();
  const result = await sendFinalPremiumAsk(ask);

  assert.deepEqual(result, { sent: true, reason: "enqueued" });
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.templateKey, "premium_follow_up_final");
  assert.equal(enqueued[0]!.recipientKind, "buyer");
  assert.equal(
    enqueued[0]!.idempotencyKey,
    "premium_follow_up_final:email:vr_1",
    "§23.4 gives a SECOND vehicle request its own fresh plan election, so the key is request-scoped",
  );
});

test("§23.2b — a suppressed decision means no ask, and no impression either", async () => {
  suppressed = { suppressed: true, reason: "cancellation_in_progress" };
  const { sendFinalPremiumAsk } = await svc();
  const result = await sendFinalPremiumAsk(ask);

  assert.deepEqual(result, { sent: false, reason: "cancellation_in_progress" });
  assert.deepEqual(enqueued, [], "a suppressed touchpoint must not enqueue");
  assert.deepEqual(
    events,
    [],
    "and must not record an impression — an ask that was never made must not consume one of the two",
  );
});

test("asked ONCE per request, even if the recap is republished", async () => {
  const { sendFinalPremiumAsk } = await svc();
  assert.equal((await sendFinalPremiumAsk(ask)).sent, true);
  const second = await sendFinalPremiumAsk(ask);

  assert.deepEqual(second, { sent: false, reason: "already_asked" });
  assert.equal(enqueued.length, 1, "a recap revision is the same transaction and the same ask");
});

test("the impression is recorded BEFORE the enqueue — the ceiling must not be lost to a crash", async () => {
  // Ordering matters and cannot be observed from the outside, so it is proved by its
  // consequence: an enqueue that THROWS still leaves the impression behind, so the next call
  // sees the ask as already made rather than making a second one under a blind ceiling.
  const { sendFinalPremiumAsk } = await svc();
  enqueueThrows = true;
  await assert.rejects(() => sendFinalPremiumAsk(ask));
  enqueueThrows = false;

  assert.equal(events.length, 1, "the impression survives the failed enqueue");
  assert.deepEqual(
    await sendFinalPremiumAsk(ask),
    { sent: false, reason: "already_asked" },
    "so the retry does not become a THIRD ask under a ceiling that cannot see the first",
  );
});

test("a zero balance is not an upsell", async () => {
  dueCents = 0;
  const { sendFinalPremiumAsk } = await svc();
  assert.deepEqual(await sendFinalPremiumAsk(ask), { sent: false, reason: "nothing_due" });
  assert.deepEqual(enqueued, [], 'quoting "$0 for a concierge" is nonsense, not an offer');
});

test("no address means no ask, reported rather than silent", async () => {
  buyerEmail = null;
  const { sendFinalPremiumAsk } = await svc();
  assert.deepEqual(await sendFinalPremiumAsk(ask), { sent: false, reason: "no_email" });
  assert.deepEqual(enqueued, []);
});
