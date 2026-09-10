// §23.2b and §23.3 — whether AutoLenis may ASK, and what happens when a buyer says no.
//
// TWO SERVICES, TWO QUESTIONS, and they are deliberately not one:
//
//   `isUpgradeWindowOpen`        may the buyer BUY?
//   `isUpgradePromptSuppressed`  may AutoLenis ASK?
//
// Conflating them breaks both directions. A buyer who comes to the upgrade page of their
// own accord must not be refused because we are forbidden to email them; a buyer we are
// forbidden to email must not get a prompt merely because their window is open.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/plan/__tests__/plan-change-and-suppression.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  request: Record<string, unknown> | null;
  buyer: Record<string, unknown> | null;
  settledDeposit: Record<string, unknown> | null;
  entitled: { plan: string; elected: string; settledPremiumCents: number; reason: string };
  contact: { do_not_contact: boolean } | null;
  contactThrows: boolean;
  elections: Array<Record<string, unknown>>;
  requestUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  requestUpdateCount: number;
  exceptions: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findUnique: async () => ctrl.request,
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          ctrl.requestUpdates.push(args);
          return { count: ctrl.requestUpdateCount };
        },
      },
      buyer: { findUnique: async () => ctrl.buyer },
      deposit: { findFirst: async () => ctrl.settledDeposit },
    },
  },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/services/buyer/plan-snapshot.service", {
  namedExports: {
    entitledPlanForRequest: async () => ctrl.entitled,
    recordRequestPlanElection: async (input: Record<string, unknown>) => {
      ctrl.elections.push(input);
      return { snapshot: null, boundSnapshotId: "snap_1" };
    },
  },
});
mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => {
      ctrl.exceptions.push(input);
      return { item: { id: "q1" }, created: true };
    },
  },
});
mock.module("@/lib/crm/resolve-contact", {
  namedExports: {
    resolveDispatchContact: async () => {
      if (ctrl.contactThrows) throw new Error("supabase down");
      return ctrl.contact;
    },
  },
});
mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => ({}) } });

async function suppression() {
  return import("@/lib/services/plan/upgrade-suppression.service");
}
async function planChange() {
  return import("@/lib/services/plan/plan-change.service");
}

const INPUT = { vehicleRequestId: "vr_1", buyerId: "buyer_1", touchpoint: "receipt" as const };

beforeEach(() => {
  ctrl = {
    request: { status: "ACTIVE_SOURCING", cancelledAt: null },
    buyer: { suspendedAt: null, disabledAt: null, archivedAt: null, purgedAt: null, user: { email: "b@x.com" } },
    settledDeposit: { id: "dep_1" },
    entitled: { plan: "STANDARD", elected: "STANDARD", settledPremiumCents: 0, reason: "" },
    contact: { do_not_contact: false },
    contactThrows: false,
    elections: [],
    requestUpdates: [],
    requestUpdateCount: 1,
    exceptions: [],
  };
});

// ── §23.2b — suppression ─────────────────────────────────────────────────────

test("an ordinary paid Standard buyer may be asked", async () => {
  const { isUpgradePromptSuppressed } = await suppression();
  assert.deepEqual(await isUpgradePromptSuppressed(INPUT), { suppressed: false });
});

test("a do-not-contact flag suppresses the ask", async () => {
  ctrl.contact = { do_not_contact: true };
  const { isUpgradePromptSuppressed } = await suppression();
  const d = await isUpgradePromptSuppressed(INPUT);
  assert.equal(d.suppressed, true);
  assert.equal((d as { reason: string }).reason, "do_not_contact");
});

test("an unreadable do-not-contact flag FAILS CLOSED", async () => {
  ctrl.contactThrows = true;
  const { isUpgradePromptSuppressed } = await suppression();
  const d = await isUpgradePromptSuppressed(INPUT);
  assert.equal(d.suppressed, true, "a prompt is never urgent; sending one under DNC is a compliance event");
  assert.match((d as { detail: string }).detail, /could not be read/);
});

test("an administrative hold on the buyer suppresses it", async () => {
  ctrl.buyer = { ...ctrl.buyer, suspendedAt: new Date() };
  const { isUpgradePromptSuppressed } = await suppression();
  assert.equal((await isUpgradePromptSuppressed(INPUT)).suppressed, true);
});

test("a cancellation in progress suppresses it", async () => {
  ctrl.request = { status: "ACTIVE_SOURCING", cancelledAt: new Date() };
  const { isUpgradePromptSuppressed } = await suppression();
  const d = await isUpgradePromptSuppressed(INPUT);
  assert.equal((d as { reason: string }).reason, "cancellation_in_progress");
});

test("a disputed or charged-back $99 suppresses it — the credit is under dispute", async () => {
  ctrl.settledDeposit = null;
  const { isUpgradePromptSuppressed } = await suppression();
  const d = await isUpgradePromptSuppressed(INPUT);
  assert.equal((d as { reason: string }).reason, "payment_disputed");
});

test("an existing PAID Premium plan suppresses it — read from the ledger, not the flag", async () => {
  ctrl.entitled = { plan: "PREMIUM", elected: "PREMIUM", settledPremiumCents: 40000, reason: "settled" };
  const { isUpgradePromptSuppressed } = await suppression();
  assert.equal((await isUpgradePromptSuppressed(INPUT)).suppressed, true);
});

test("an ELECTED but unpaid Premium is exactly who §23.2a exists to ask", async () => {
  ctrl.entitled = { plan: "STANDARD", elected: "PREMIUM", settledPremiumCents: 0, reason: "unpaid" };
  const { isUpgradePromptSuppressed } = await suppression();
  assert.equal((await isUpgradePromptSuppressed(INPUT)).suppressed, false);
});

// PAY-71 — two emails, then silence.
test("a third EMAIL is never sent", async () => {
  const { isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS } = await suppression();
  const email = { ...INPUT, touchpoint: UPGRADE_TOUCHPOINTS.REAFFIRMATION_EMAIL, emailsSent: 2 };
  const d = await isUpgradePromptSuppressed(email);
  assert.equal((d as { reason: string }).reason, "asked_enough");
});

// An email touchpoint with no count would make the ceiling unreachable — a predicate
// that always passes, which is worse than one that is not there because the next reader
// cannot tell which it is. The first email caller is told so by a throw rather than
// discovering it in production.
test("an email touchpoint that omits the count is REFUSED, not defaulted to zero", async () => {
  const { isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS } = await suppression();
  await assert.rejects(
    () => isUpgradePromptSuppressed({ ...INPUT, touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE_EMAIL }),
    /must supply emailsSent/,
  );
});

test("the ceiling is on EMAILS — the in-app option stays quietly available", async () => {
  const { isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS } = await suppression();
  const inApp = { ...INPUT, touchpoint: UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE, emailsSent: 2 };
  assert.equal(
    (await isUpgradePromptSuppressed(inApp)).suppressed,
    false,
    "§23.2b: 'the in-app option remains available without further prompting'",
  );
});

test("declining twice ends every touchpoint, not just the emails", async () => {
  const { isUpgradePromptSuppressed } = await suppression();
  const d = await isUpgradePromptSuppressed({ ...INPUT, declines: 2 });
  assert.equal((d as { reason: string }).reason, "asked_enough");
});

// ── §23.3 — downgrade ────────────────────────────────────────────────────────

test("before the balance settles a downgrade is ONLY a change of election", async () => {
  const { downgradeToStandard } = await planChange();
  const out = await downgradeToStandard({
    buyerId: "buyer_1", vehicleRequestId: "vr_1", actor: "buyer_1", reason: "changed my mind",
  });

  assert.equal(out.kind, "ELECTION_ONLY");
  assert.equal(ctrl.elections[0]!.plan, "STANDARD");
  assert.equal(ctrl.elections[0]!.touchpoint, "downgrade");
  assert.equal(ctrl.exceptions.length, 0, "no money moved, so there is nothing for Finance to review");
});

test("the concierge is released and ownership returns to the pool", async () => {
  const { downgradeToStandard } = await planChange();
  const out = await downgradeToStandard({
    buyerId: "buyer_1", vehicleRequestId: "vr_1", actor: "admin_1", reason: "buyer request",
  });

  assert.equal((out as { conciergeReleased: boolean }).conciergeReleased, true);
  const release = ctrl.requestUpdates.find((u) => "assignedAdminId" in u.data)!;
  assert.equal(release.data.assignedAdminId, null, "null IS the Operations pool (PAY-78, PAY-92)");
});

test("after the balance settles it is a refund REQUEST, never a refund", async () => {
  ctrl.entitled = { plan: "PREMIUM", elected: "PREMIUM", settledPremiumCents: 40000, reason: "settled" };
  const { downgradeToStandard } = await planChange();
  const out = await downgradeToStandard({
    buyerId: "buyer_1", vehicleRequestId: "vr_1", actor: "admin_1", reason: "service not delivered",
  });

  assert.equal(out.kind, "REFUND_REVIEW_RAISED");
  assert.equal(ctrl.exceptions.length, 1);
  assert.equal(ctrl.exceptions[0]!.code, "DOWNGRADE_AFTER_PREMIUM_SETTLED");
  assert.match(String(ctrl.exceptions[0]!.detail), /NOTHING was refunded automatically/);
  assert.match(String(ctrl.exceptions[0]!.detail), /\$99 is never refunded/);
  assert.equal(ctrl.elections[0]!.plan, "STANDARD", "§23.3: the plan reverts and the refund is decided separately");
});

test("a downgrade with no reason is refused — a decision with none is not reviewable", async () => {
  const { downgradeToStandard } = await planChange();
  await assert.rejects(() =>
    downgradeToStandard({ buyerId: "buyer_1", vehicleRequestId: "vr_1", actor: "admin_1", reason: "   " }),
  );
  assert.equal(ctrl.elections.length, 0);
});

// §23.2 "On settlement" / PAY-62 / PAY-92.
test("assigning a concierge moves ownership, and re-assigning the same one is a no-op", async () => {
  const { assignConcierge } = await planChange();
  const first = await assignConcierge({
    vehicleRequestId: "vr_1", buyerId: "buyer_1", adminId: "admin_7", actor: "system",
  });
  assert.equal(first.changed, true);
  assert.equal(ctrl.requestUpdates[0]!.data.assignedAdminId, "admin_7");

  ctrl.requestUpdateCount = 0; // the guarded write matches nothing the second time
  const again = await assignConcierge({
    vehicleRequestId: "vr_1", buyerId: "buyer_1", adminId: "admin_7", actor: "system",
  });
  assert.equal(again.changed, false);
});
