// END-TO-END: an abandoned $99 deposit produces touch 1 at +1h.
//
// Answers the question the producer flip raises: with the internal
// lifecycle_touch_schedule plane as the default, does an abandoned deposit
// actually reach a send attempt? This exercises the REAL code at every step —
// scheduleLifecycleWorkload → enqueueLifecycleTouch → drainDueLifecycleTouches →
// the depositConversionResolved guard → notifyContact. Only two things are faked:
// the `lifecycle_touch_schedule` table (an in-memory shim with the same filter
// semantics) and the outbound transport (spied, so nothing is actually sent).
//
// QStash is deliberately mocked to THROW: if any step still routes there, these
// tests fail loudly rather than passing on a swallowed error.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/deposit-reminder-e2e.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row {
  id: string;
  base_key: string;
  sequence: string;
  entity_id: string;
  first_name: string | null;
  email: string;
  phone: string | null;
  run_at: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

let table: Row[] = [];
let notifies: Array<{ entityId: string; sms?: string; emailSubject?: string }> = [];
let deposits: Array<{ status: string }> = [];
let buyerHalted = false;
let nextId = 1;

/** Minimal thenable query builder over the in-memory table — mirrors only the
 *  operators the drain and enqueue actually use. */
function builder(op: "select" | "upsert" | "update", payload?: Record<string, unknown>) {
  const filters: Array<(r: Row) => boolean> = [];
  let inserted: Row[] = [];
  let limit = Infinity;

  const api: Record<string, unknown> = {
    eq(col: string, val: unknown) { filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val); return api; },
    lt(col: string, val: string) { filters.push((r) => String((r as unknown as Record<string, unknown>)[col] ?? "") < val); return api; },
    lte(col: string, val: string) { filters.push((r) => String((r as unknown as Record<string, unknown>)[col] ?? "") <= val); return api; },
    in(col: string, vals: unknown[]) { filters.push((r) => vals.includes((r as unknown as Record<string, unknown>)[col])); return api; },
    order() { return api; },
    limit(n: number) { limit = n; return api; },
    select() { return api; },
    then(resolve: (v: { data: unknown; error: null }) => void) {
      let matched = table.filter((r) => filters.every((f) => f(r)));
      if (op === "select") {
        resolve({ data: matched.slice(0, limit), error: null });
        return;
      }
      if (op === "update") {
        matched = matched.slice(0, limit);
        for (const r of matched) Object.assign(r, payload);
        resolve({ data: matched.map((r) => ({ ...r })), error: null });
        return;
      }
      // upsert with onConflict(base_key,sequence) + ignoreDuplicates
      const p = payload as unknown as Row;
      const dupe = table.find((r) => r.base_key === p.base_key && r.sequence === p.sequence);
      if (!dupe) {
        const row: Row = { ...p, id: `t${nextId++}`, attempts: 0, claimed_at: null, last_error: null, updated_at: null };
        table.push(row);
        inserted = [row];
      }
      resolve({ data: inserted.map((r) => ({ id: r.id })), error: null });
    },
  };
  return api;
}

const fakeSupabase = {
  from: (name: string) => {
    if (name !== "lifecycle_touch_schedule") throw new Error(`unexpected table: ${name}`);
    return {
      select: () => builder("select"),
      upsert: (payload: Record<string, unknown>) => builder("upsert", payload),
      update: (payload: Record<string, unknown>) => builder("update", payload),
    };
  },
};

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => fakeSupabase } });

// The producer must never reach QStash. Throwing makes a regression loud.
mock.module("@/lib/qstash/dispatch", {
  namedExports: {
    dispatch: async () => { throw new Error("QStash was called — it is removed from the stack"); },
  },
});

// Real guard, faked data: an unpaid PENDING deposit on an active buyer.
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: { findMany: async () => deposits },
      buyer: {
        findUnique: async () => (buyerHalted
          ? { suspendedAt: new Date(), disabledAt: null, archivedAt: null, purgedAt: null }
          : { suspendedAt: null, disabledAt: null, archivedAt: null, purgedAt: null }),
      },
      vehicleRequest: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/qstash/notify", {
  namedExports: {
    notifyContact: async (o: { entityId: string; sms?: string; emailSubject?: string }) => {
      notifies.push({ entityId: o.entityId, sms: o.sms, emailSubject: o.emailSubject });
      return { smsSent: false, emailSent: true };
    },
    renderEmail: (o: { bodyHtml?: string }) => o.bodyHtml ?? "<p>x</p>",
    NOTIFY_APP_URL: "https://autolenis.com",
  },
});

mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: {
    // No flag row exists — production's default, and the whole point of the flip.
    isEnabled: async () => false,
    FLAGS: {
      LIFECYCLE_INTERNAL_DEPOSIT_REMINDER: "lifecycle_internal_deposit_reminder",
      LIFECYCLE_INTERNAL_AUCTION: "lifecycle_internal_auction",
      LIFECYCLE_INTERNAL_DEALER_INVITED: "lifecycle_internal_dealer_invited",
      LIFECYCLE_INTERNAL_OFFER: "lifecycle_internal_offer",
      LIFECYCLE_INTERNAL_DEAL_COMPLETE: "lifecycle_internal_deal_complete",
      LIFECYCLE_INTERNAL_FORM_SUBMITTED: "lifecycle_internal_form_submitted",
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

const BUYER = {
  workload: "deposit_reminder" as const,
  buyerId: "buyer_1",
  firstName: "Sam",
  email: "buyer@example.com",
  phone: "+15551230000",
};

/** Pull the scheduled touch forward so the drain sees it as due. */
function fastForward() {
  for (const r of table) r.run_at = new Date(Date.now() - 1000).toISOString();
}

beforeEach(() => {
  table = [];
  notifies = [];
  deposits = [{ status: "PENDING" }];
  buyerHalted = false;
  nextId = 1;
});

test("abandoned deposit → touch 1 is scheduled ~1h out, pending, and NOT yet sent", async () => {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);

  assert.equal(table.length, 1, "the producer wrote a touch row");
  assert.equal(table[0]!.sequence, "deposit_reminder_1");
  assert.equal(table[0]!.status, "pending");

  const delayMin = (new Date(table[0]!.run_at).getTime() - Date.now()) / 60_000;
  assert.ok(delayMin > 55 && delayMin <= 61, `expected ~60 minutes, got ${delayMin.toFixed(1)}`);

  const { drainDueLifecycleTouches } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
  const early = await drainDueLifecycleTouches();
  assert.equal(early.status, "NO_DUE", "nothing is due yet — the 1h grace is real");
  assert.deepEqual(notifies, [], "no buyer is chased inside the grace window");
});

test("at +1h the drain SENDS touch 1 and chains touch 2", async () => {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);
  fastForward();

  const { drainDueLifecycleTouches } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
  const summary = await drainDueLifecycleTouches();

  assert.equal(summary.sent, 1, `expected one send, got ${JSON.stringify(summary)}`);
  assert.equal(notifies.length, 1, "the send attempt reached notifyContact");
  assert.equal(notifies[0]!.entityId, "buyer_1");
  assert.match(String(notifies[0]!.emailSubject), /saved/i, "the touch-1 copy was rendered");

  assert.equal(table.find((r) => r.sequence === "deposit_reminder_1")!.status, "done");
  const next = table.find((r) => r.sequence === "deposit_reminder_2");
  assert.ok(next, "touch 2 must be chained by touch 1 — the chain is self-propelling");
  assert.equal(next!.status, "pending");
});

test("a buyer who PAID inside the grace window is never chased", async () => {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);
  deposits = [{ status: "PAID" }]; // paid before the drain runs
  fastForward();

  const { drainDueLifecycleTouches } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
  const summary = await drainDueLifecycleTouches();

  assert.equal(summary.sent, 0);
  assert.deepEqual(notifies, [], "the send-time guard is authoritative, not the schedule");
  assert.equal(summary.canceled, 1, "and the rest of the chain is canceled, not merely skipped");
});

test("an administratively halted buyer is never chased either", async () => {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);
  buyerHalted = true;
  fastForward();

  const { drainDueLifecycleTouches } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
  const summary = await drainDueLifecycleTouches();

  assert.equal(summary.sent, 0);
  assert.deepEqual(notifies, [], "a suspended buyer must not receive conversion marketing");
});

test("re-enrolling the same buyer does not duplicate the touch", async () => {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);
  await scheduleLifecycleWorkload(BUYER); // buyer restarts checkout

  assert.equal(
    table.filter((r) => r.sequence === "deposit_reminder_1").length,
    1,
    "UNIQUE(base_key, sequence) makes enrollment idempotent — no double chase",
  );
});
