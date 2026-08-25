// Dealer-sourcing-spine SLA invariants (checkSLAs extension).
//
// Proves the two spine-health signals emit through the EXISTING SYSTEM_ALERT
// channel: (a) a completed opportunity that discovered dealers but contacted none,
// and (b) a prospect with a verified email never contacted — both past SLA. Also
// proves the 24h dedup so a persistent backlog doesn't flood the alert channel
// (sla-check runs every 30m).
//
// checkSLAs uses the top-level prisma import, so we mock.module it.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Where = Record<string, unknown>;
const state = {
  opportunitiesUncontacted: 0,
  prospectsUncontacted: 0,
  recentAlertPrefixes: [] as string[], // title prefixes that already alerted <24h ago
  created: [] as Array<{ title: string; type: string }>,
  countCalls: [] as Array<{ model: string; where: Where }>,
};

function alertRecentlyExists(where: Where): boolean {
  const title = where.title as { startsWith?: string } | undefined;
  const prefix = title?.startsWith ?? "";
  return state.recentAlertPrefixes.some((p) => prefix.startsWith(p) || p.startsWith(prefix));
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // Provider-evidence invariant (checkSLAs also calls checkDepositProviderEvidence):
      // no PAID-without-evidence deposits in this test → clean no-op, gaps=0.
      $queryRaw: async () => [] as unknown[],
      auction: { findMany: async () => [] }, // no urgent auctions
      deal: { count: async () => 0 }, // no stuck deals
      buyerOpportunity: {
        count: async ({ where }: { where: Where }) => {
          state.countCalls.push({ model: "buyerOpportunity", where });
          return state.opportunitiesUncontacted;
        },
      },
      dealerProspect: {
        count: async ({ where }: { where: Where }) => {
          state.countCalls.push({ model: "dealerProspect", where });
          return state.prospectsUncontacted;
        },
      },
      notification: {
        findFirst: async ({ where }: { where: Where }) =>
          alertRecentlyExists(where) ? { id: "n_recent" } : null,
        create: async ({ data }: { data: { title: string; type: string } }) => {
          state.created.push(data);
          return { id: `n_${state.created.length}` };
        },
      },
    },
  },
});

beforeEach(() => {
  state.opportunitiesUncontacted = 0;
  state.prospectsUncontacted = 0;
  state.recentAlertPrefixes = [];
  state.created = [];
  state.countCalls = [];
});

async function loadCheckSLAs() {
  const mod = await import("@/lib/services/monitoring/health.service");
  return mod.checkSLAs;
}

test("returns the two sourcing counts and folds them into `breached`", async () => {
  state.opportunitiesUncontacted = 3;
  state.prospectsUncontacted = 12;
  const checkSLAs = await loadCheckSLAs();

  const r = await checkSLAs();

  assert.equal(r.opportunitiesUncontacted, 3);
  assert.equal(r.prospectsUncontacted, 12);
  // breached folds both sourcing breaches (no stuck deals in this mock).
  assert.equal(r.breached, 15);
});

test("emits a SYSTEM_ALERT for each sourcing breach when none alerted recently", async () => {
  state.opportunitiesUncontacted = 2;
  state.prospectsUncontacted = 5;
  const checkSLAs = await loadCheckSLAs();

  await checkSLAs();

  assert.equal(state.created.length, 2);
  assert.ok(
    state.created.every((n) => n.type === "SYSTEM_ALERT"),
    "sourcing breaches use the existing SYSTEM_ALERT channel",
  );
  assert.ok(
    state.created.some((n) => /discovered but no dealer contacted/i.test(n.title)),
    "opportunity breach alert present",
  );
  assert.ok(
    state.created.some((n) => /email but were never contacted/i.test(n.title)),
    "prospect breach alert present",
  );
});

test("dedup: does NOT re-alert when a same-prefix alert fired within 24h", async () => {
  state.opportunitiesUncontacted = 2;
  state.prospectsUncontacted = 5;
  // Both categories already alerted recently.
  state.recentAlertPrefixes = [
    "SLA Breach: opportunities discovered but no dealer contacted",
    "SLA Breach: prospects have an email but were never contacted",
  ];
  const checkSLAs = await loadCheckSLAs();

  const r = await checkSLAs();

  assert.equal(state.created.length, 0, "no duplicate alerts within the dedup window");
  // Counts + breached are still reported truthfully even when the alert is suppressed.
  assert.equal(r.breached, 7);
});

test("no breach → no sourcing alert", async () => {
  const checkSLAs = await loadCheckSLAs();
  const r = await checkSLAs();
  assert.equal(r.opportunitiesUncontacted, 0);
  assert.equal(r.prospectsUncontacted, 0);
  assert.equal(state.created.length, 0);
});
