// §23.2a — THE IMPRESSION, DISMISSAL AND CONVERSION RECORD, and the counts §23.2b's ceilings need.
//
// Phase 3 shipped `isUpgradePromptSuppressed` taking `declines` and `emailsSent` as INPUTS, with a
// throw if an email touchpoint arrives without a count — and nothing in the repository counted
// them, because the only touchpoint that phase shipped was touchpoint 1. So "two emails, then
// silence" and "a buyer who declines twice is not asked again" were ceilings that could not be
// reached. Phase 6 ships touchpoints 2, 3 and 4; this is what makes those rules real.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/plan/__tests__/upgrade-touchpoint.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;
let events: Rec[];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerActivityEvent: {
        create: async (a: Rec) => { events.push((a as { data: Rec }).data); return {}; },
        // Honours `buyerId` and `eventType`, the two columns the real query narrows on.
        findMany: async ({ where }: { where: Rec }) =>
          events
            .filter((e) => e.buyerId === where.buyerId && e.eventType === where.eventType)
            .map((e) => ({ metadata: e.metadata, createdAt: new Date() })),
        findFirst: async ({ where }: { where: Rec }) =>
          events.find((e) => e.buyerId === where.buyerId && e.eventType === where.eventType) ?? null,
      },
    },
  },
});
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => { events = []; });

const base = { buyerId: "b1", vehicleRequestId: "vr_1" as string | null };

async function svc() {
  return import("../upgrade-touchpoint.service");
}

test("an impression is recorded once per touchpoint per request — §23.2a's 'once'", async () => {
  const { recordImpression, hasBeenShown } = await svc();
  assert.equal(await recordImpression({ ...base, touchpoint: "post_acceptance" }), true);
  assert.equal(await recordImpression({ ...base, touchpoint: "post_acceptance" }), false, "the once-invitation fired twice");
  assert.equal(events.length, 1);
  assert.equal(await hasBeenShown("b1", "vr_1", "post_acceptance"), true);
});

test("a DIFFERENT touchpoint on the same request is its own 'once'", async () => {
  const { recordImpression } = await svc();
  await recordImpression({ ...base, touchpoint: "post_acceptance" });
  assert.equal(await recordImpression({ ...base, touchpoint: "best_price_report" }), true);
  assert.equal(events.length, 2);
});

test("the SAME touchpoint on a SECOND request is shown again — §23.4", async () => {
  // "A buyer starts a second Vehicle Request → new request, new $99, fresh plan election." Carrying
  // the first transaction's impression forward would silence an ask the buyer never saw.
  const { recordImpression } = await svc();
  await recordImpression({ ...base, touchpoint: "post_acceptance" });
  assert.equal(await recordImpression({ buyerId: "b1", vehicleRequestId: "vr_2", touchpoint: "post_acceptance" }), true);
});

test("declines are counted, and scoped to the request", async () => {
  const { recordDismissal, upgradeAskCounts } = await svc();
  await recordDismissal({ ...base, touchpoint: "post_acceptance" });
  await recordDismissal({ ...base, touchpoint: "best_price_report" });
  await recordDismissal({ buyerId: "b1", vehicleRequestId: "vr_2", touchpoint: "post_acceptance" });

  assert.equal((await upgradeAskCounts("b1", "vr_1")).declines, 2);
  assert.equal((await upgradeAskCounts("b1", "vr_2")).declines, 1, "a decline from another transaction leaked in");
});

test("emailsSent counts only the EMAIL touchpoints", async () => {
  // §23.2b's ceiling is on emails. An in-app impression is not an email and must not consume it.
  const { recordImpression, upgradeAskCounts } = await svc();
  await recordImpression({ ...base, touchpoint: "post_acceptance" });
  await recordImpression({ ...base, touchpoint: "best_price_report" });
  await recordImpression({ ...base, touchpoint: "receipt" });
  assert.equal((await upgradeAskCounts("b1", "vr_1")).emailsSent, 0);

  await recordImpression({ ...base, touchpoint: "post_acceptance_email" });
  await recordImpression({ ...base, touchpoint: "reaffirmation_email" });
  assert.equal((await upgradeAskCounts("b1", "vr_1")).emailsSent, 2, "the two-email ceiling cannot be reached");
});

test("the counts feed the real predicate's ceilings", async () => {
  // The whole point: with these numbers `isUpgradePromptSuppressed` refuses. Without a counter it
  // would either throw (email touchpoint) or pass forever (declines).
  const { recordDismissal, upgradeAskCounts } = await svc();
  await recordDismissal({ ...base, touchpoint: "post_acceptance" });
  await recordDismissal({ ...base, touchpoint: "best_price_report" });
  const counts = await upgradeAskCounts("b1", "vr_1");
  const { MAX_UPGRADE_DECLINES } = await import("../upgrade-suppression.service");
  assert.ok(counts.declines >= MAX_UPGRADE_DECLINES, "two dismissals must reach §23.2b's decline ceiling");
});

test("a conversion is recorded, and a failure to record it never fails the upgrade", async () => {
  const { recordConversion } = await svc();
  await recordConversion({ ...base, touchpoint: "post_acceptance" });
  assert.equal(events.filter((e) => e.eventType === "PREMIUM_PROMPT_CONVERTED").length, 1);

  const { prisma } = await import("@/lib/prisma");
  const orig = (prisma as unknown as { buyerActivityEvent: { create: unknown } }).buyerActivityEvent.create;
  (prisma as unknown as { buyerActivityEvent: { create: unknown } }).buyerActivityEvent.create = async () => {
    throw new Error("insert failed");
  };
  // The buyer has paid; losing the funnel row must not undo that.
  await assert.doesNotReject(() => recordConversion({ ...base, touchpoint: "post_acceptance" }));
  (prisma as unknown as { buyerActivityEvent: { create: unknown } }).buyerActivityEvent.create = orig;
});

test("every event carries the touchpoint and the request it belongs to", async () => {
  const { recordImpression } = await svc();
  await recordImpression({ ...base, touchpoint: "best_price_report", detail: { auctionId: "auc_1" } });
  const m = events[0].metadata as Rec;
  assert.equal(m.touchpoint, "best_price_report");
  assert.equal(m.vehicleRequestId, "vr_1");
  assert.equal(m.auctionId, "auc_1", "the caller's context must survive — a funnel query needs it");
});
