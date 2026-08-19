// D2b — pickup confirmation SLA nudges (cron-scan). If the dealer hasn't
// confirmed a PROPOSED pickup within 24h, nudge the dealer; if the buyer hasn't
// accepted a DEALER_COUNTERED pickup within 24h, nudge the buyer. One nudge per
// side per round (a `*ReminderSentAt` marker, reset on each new proposal).
//
// Uses dependency injection (no module mocking) — a fake prisma + spy notifiers.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/pickup/__tests__/pickup-sla.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { runPickupConfirmationNudges, PICKUP_CONFIRM_SLA_HOURS } from "../pickup-sla.service";

function harness() {
  const capturedWhere: Record<string, unknown>[] = [];
  const updates: Array<{ dealId: string; data: Record<string, unknown> }> = [];
  const dealerReminders: string[] = [];
  const buyerReminders: string[] = [];

  const prisma = {
    pickup: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere.push(where);
        if (where.status === "PROPOSED") return [{ dealId: "deal_A" }, { dealId: "deal_B" }];
        if (where.status === "DEALER_COUNTERED") return [{ dealId: "deal_C" }];
        return [];
      },
      update: async ({ where, data }: { where: { dealId: string }; data: Record<string, unknown> }) => {
        updates.push({ dealId: where.dealId, data });
        return {};
      },
    },
  };

  const deps = {
    prisma: prisma as never,
    notifyDealerProposalReminder: async (dealId: string) => { dealerReminders.push(dealId); },
    notifyBuyerCounterReminder: async (dealId: string) => { buyerReminders.push(dealId); },
  };

  return { deps, capturedWhere, updates, dealerReminders, buyerReminders };
}

const NOW = new Date("2026-03-01T12:00:00Z");

test("nudges aged PROPOSED (dealer) and DEALER_COUNTERED (buyer) pickups and records the marker", async () => {
  const h = harness();
  const res = await runPickupConfirmationNudges(NOW, h.deps);

  assert.deepEqual(res, { dealerNudged: 2, buyerNudged: 1 });
  assert.deepEqual(h.dealerReminders, ["deal_A", "deal_B"]);
  assert.deepEqual(h.buyerReminders, ["deal_C"]);

  // Each nudged pickup gets its side's marker stamped.
  const dealerMarks = h.updates.filter((u) => "proposedReminderSentAt" in u.data);
  const buyerMarks = h.updates.filter((u) => "counterReminderSentAt" in u.data);
  assert.deepEqual(dealerMarks.map((u) => u.dealId).sort(), ["deal_A", "deal_B"]);
  assert.deepEqual(buyerMarks.map((u) => u.dealId), ["deal_C"]);
  assert.equal(dealerMarks[0]!.data.proposedReminderSentAt, NOW);
});

test("only scans past the SLA cutoff and only un-nudged rows", async () => {
  const h = harness();
  await runPickupConfirmationNudges(NOW, h.deps);

  const proposedScan = h.capturedWhere.find((w) => w.status === "PROPOSED")!;
  const cutoff = (proposedScan.proposedAt as { lt: Date }).lt;
  // cutoff is exactly SLA hours before now
  assert.equal(+cutoff, +new Date(NOW.getTime() - PICKUP_CONFIRM_SLA_HOURS * 3600_000));
  // must exclude already-nudged rows
  assert.equal(proposedScan.proposedReminderSentAt, null);

  const counterScan = h.capturedWhere.find((w) => w.status === "DEALER_COUNTERED")!;
  assert.equal(counterScan.counterReminderSentAt, null);
});
