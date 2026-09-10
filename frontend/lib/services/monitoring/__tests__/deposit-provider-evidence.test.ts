// Program 1 — provider-evidence reconciliation invariant.
//
// A deposit linked to a real Stripe PaymentIntent must have provider evidence in
// payment_provider_events. checkDepositProviderEvidence() surfaces the ones that
// don't as an operational exception — and, critically, does it TRUTHFULLY: it
// raises an alert, it NEVER fabricates a PaymentProviderEvent from a deposit row.
//
// Two shapes of the same invariant:
//   • PAID + real PI + no provider event  → the deposit was flipped outside the
//     webhook (admin override) or a real event was never recorded.
//   • PENDING + real PI + no provider event past the window → possible webhook
//     NON-DELIVERY. Because an abandoned checkout looks identical from inside the
//     platform, this branch reconciles READ-ONLY against Stripe and alerts only
//     when Stripe says the money actually moved. That is the signal that went
//     unnoticed for weeks: a live charge the platform never learned about.
//
// Run: pnpm test:monitoring

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Row = { id: string; pi: string; status: string };

const state = {
  gapRows: [] as Row[],
  queryThrows: false,
  recentTitles: new Set<string>(),
  createdNotifications: [] as Array<Record<string, unknown>>,
  providerEventWrites: 0, // must stay 0 — reconciliation may never fabricate evidence
  depositWrites: 0,       // must stay 0 — the invariant observes, it does not mutate
  // Stripe reconciliation: PaymentIntent id → status reported by the provider.
  piStatus: {} as Record<string, string>,
  retrieveThrows: false,
  retrievedIds: [] as string[],
  infoLogs: [] as string[],
  // §13-D12: the single exception rail this detector now raises on.
  exceptions: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => {
      state.exceptions.push(input);
      return { item: { id: "q1" }, created: true };
    },
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async () => {
        if (state.queryThrows) throw new Error("db down");
        return state.gapRows;
      },
      notification: {
        findFirst: async ({ where }: { where: { title?: string | { startsWith?: string } } }) => {
          const t = where.title;
          if (typeof t === "string") return state.recentTitles.has(t) ? { id: "existing" } : null;
          if (t?.startsWith) {
            for (const seen of state.recentTitles) if (seen.startsWith(t.startsWith)) return { id: "existing" };
          }
          return null;
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.createdNotifications.push(data);
          return { id: "n1", ...data };
        },
      },
      // If reconciliation ever tried to fabricate a provider event, this would fire.
      paymentProviderEvent: {
        create: async () => { state.providerEventWrites += 1; return {}; },
        update: async () => { state.providerEventWrites += 1; return {}; },
        updateMany: async () => { state.providerEventWrites += 1; return { count: 1 }; },
      },
      deposit: {
        update: async () => { state.depositWrites += 1; return {}; },
        updateMany: async () => { state.depositWrites += 1; return { count: 1 }; },
      },
    },
  },
});

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async (id: string) => {
      state.retrievedIds.push(id);
      if (state.retrieveThrows) throw new Error("stripe unreachable");
      return { id, status: state.piStatus[id] ?? "requires_payment_method" };
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: () => {},
      warn: () => {},
      info: (msg: unknown) => { state.infoLogs.push(String(msg)); },
    },
  },
});

async function load() {
  const mod = await import("@/lib/services/monitoring/health.service");
  return mod.checkDepositProviderEvidence;
}

beforeEach(() => {
  state.gapRows = [];
  state.queryThrows = false;
  state.recentTitles = new Set<string>();
  state.createdNotifications = [];
  state.providerEventWrites = 0;
  state.depositWrites = 0;
  state.piStatus = {};
  state.retrieveThrows = false;
  state.retrievedIds = [];
  state.infoLogs = [];
  state.exceptions = [];
});

// ── PAID branch (existing contract, unchanged) ────────────────────────────────

test("flags each PAID+pi_ deposit lacking provider evidence on the exception rail", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [
    { id: "dep_a", pi: "pi_111", status: "PAID" },
    { id: "dep_b", pi: "pi_222", status: "PAID" },
  ];
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 2);
  assert.equal(state.exceptions.length, 2);
  assert.equal(state.exceptions[0].code, "PAYMENT_WEBHOOK_MISSED");
  assert.equal(state.exceptions[0].depositId, "dep_a");
  assert.match(String(state.exceptions[0].detail), /pi_111/);
  assert.match(String(state.exceptions[0].detail), /do NOT fabricate a provider event/);
  assert.equal(state.createdNotifications.length, 0, "§13-D12 check (d): the SYSTEM_ALERT rail is gone for these");
  assert.equal(state.retrievedIds.length, 0, "a PAID gap needs no provider round-trip");
});

test("NEVER fabricates a provider event (evidence, not inference)", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [
    { id: "dep_a", pi: "pi_111", status: "PAID" },
    { id: "dep_p", pi: "pi_333", status: "PENDING" },
  ];
  state.piStatus = { pi_333: "succeeded" };
  await checkDepositProviderEvidence();
  assert.equal(state.providerEventWrites, 0, "reconciliation must never write a PaymentProviderEvent");
  assert.equal(state.depositWrites, 0, "reconciliation observes; it never flips a deposit");
});

// Idempotency MOVED, and that is the fix rather than a loss of coverage. It used to
// live here as a read-then-write on an exact title string — a check two concurrent
// sweeps both pass. It now lives in `raiseException`, on a real unique index over
// `queue_items.idempotency_key`. What this file can still prove, and what actually
// makes the index work, is that the key does not vary between sweeps.
test("the exception key is stable across sweeps, so the unique index collapses repeats", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_a", pi: "pi_111", status: "PAID" }];

  await checkDepositProviderEvidence();
  const first = state.exceptions[0]!.idempotencyKey;
  state.exceptions = [];
  await checkDepositProviderEvidence();

  assert.equal(state.exceptions[0]!.idempotencyKey, first);
  assert.equal(first, "PAYMENT_WEBHOOK_MISSED:pi_111");
});

// §13-D12 / C5 / DUP-03 — THE FOLD ITSELF. The settlement reconciler and this
// detector find the same rows by the same provider fact. Two rails meant two rows,
// two owners and two people closing the same incident. One key means one row.
test("the key matches the settlement reconciler's, keyed on the intent not the deposit", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_a", pi: "pi_111", status: "PAID" }];
  await checkDepositProviderEvidence();

  assert.equal(
    state.exceptions[0]!.idempotencyKey,
    "PAYMENT_WEBHOOK_MISSED:pi_111",
    "deposit-settlement.service raises exactly this key for the same gap — see its own suite",
  );
});

test("no gaps → no alerts", async () => {
  const checkDepositProviderEvidence = await load();
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 0);
  assert.equal(res.strandedPending, 0);
  assert.equal(state.exceptions.length, 0);
  assert.equal(state.createdNotifications.length, 0);
});

test("query failure degrades to zero gaps, never throws", async () => {
  const checkDepositProviderEvidence = await load();
  state.queryThrows = true;
  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 0);
  assert.equal(res.strandedPending, 0);
});

// ── PENDING branch — the non-delivering webhook ───────────────────────────────

test("a PENDING deposit whose PaymentIntent SUCCEEDED at Stripe raises a delivery exception", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_live", pi: "pi_3U98ES", status: "PENDING" }];
  state.piStatus = { pi_3U98ES: "succeeded" };

  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 1);
  assert.equal(state.exceptions.length, 1);

  const raised = state.exceptions[0]!;
  assert.equal(raised.code, "PAYMENT_WEBHOOK_MISSED");
  assert.equal(raised.depositId, "dep_live");
  assert.equal(raised.buyerId, undefined, "ops-only — never notify the buyer");
  assert.equal(raised.idempotencyKey, "PAYMENT_WEBHOOK_MISSED:pi_3U98ES");
  // The detail must point the operator at the actual thing to check.
  assert.match(String(raised.detail), /pi_3U98ES/);
  assert.match(String(raised.detail), /webhook/i);
  assert.match(String(raised.detail), /STRIPE_WEBHOOK_SECRET/);
  assert.match(String(raised.detail), /\/api\/webhooks\/stripe/);
});

test("an abandoned checkout is NOT an exception — the common benign case stays silent", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [
    { id: "dep_abandoned", pi: "pi_aaa", status: "PENDING" },
    { id: "dep_cancelled", pi: "pi_bbb", status: "PENDING" },
  ];
  state.piStatus = { pi_aaa: "requires_payment_method", pi_bbb: "canceled" };

  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 0, "a buyer who never paid is not a delivery failure");
  assert.equal(state.exceptions.length, 0);
});

test("an authorized-but-uncaptured intent also counts as money the platform never learned about", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_cap", pi: "pi_ccc", status: "PENDING" }];
  state.piStatus = { pi_ccc: "requires_capture" };
  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 1);
});

test("the PENDING exception is idempotent per deposit", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_live", pi: "pi_zzz", status: "PENDING" }];
  state.piStatus = { pi_zzz: "succeeded" };
  state.recentTitles = new Set([
    "Stripe webhook not delivering — paid deposit stranded PENDING: dep_live",
  ]);
  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 1, "still reports the count");
  assert.equal(state.createdNotifications.length, 0, "but raises no duplicate alert");
});

test("an unreachable Stripe raises ONE deduped degraded-mode alert, not a per-deposit storm", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [
    { id: "dep_1", pi: "pi_1", status: "PENDING" },
    { id: "dep_2", pi: "pi_2", status: "PENDING" },
    { id: "dep_3", pi: "pi_3", status: "PENDING" },
  ];
  state.retrieveThrows = true;

  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 0, "unconfirmed is not the same as stranded");
  assert.equal(state.createdNotifications.length, 1, "one degraded-mode alert, not three");
  assert.match(String(state.createdNotifications[0].title), /reconcile/i);
});

test("an in-flight (processing) intent is not an exception — no terminal event is due yet", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [{ id: "dep_ach", pi: "pi_ach", status: "PENDING" }];
  state.piStatus = { pi_ach: "processing" };
  const res = await checkDepositProviderEvidence();
  assert.equal(res.strandedPending, 0);
  assert.equal(state.createdNotifications.length, 0);
});

test("provider round-trips are budgeted per sweep, and the truncation is logged not hidden", async () => {
  const checkDepositProviderEvidence = await load();
  // 14 PENDING candidates, budget is 10 — the rest defer to the next sweep.
  state.gapRows = Array.from({ length: 14 }, (_, i) => ({
    id: `dep_${i}`,
    pi: `pi_${i}`,
    status: "PENDING",
  }));
  state.piStatus = Object.fromEntries(state.gapRows.map((r) => [r.pi, "succeeded"]));

  const res = await checkDepositProviderEvidence();
  assert.equal(state.retrievedIds.length, 10, "at most the per-run Stripe budget");
  assert.equal(res.strandedPending, 10);
  assert.ok(
    state.infoLogs.some((m) => /deferred to the next sweep/.test(m)),
    "a bounded sweep must say what it did not examine",
  );
});

// One CODE, two readings. C5 asks for "one emitter, one exception code" — not for the
// two conditions to become indistinguishable. The code and owner are shared; the
// detail is what tells the reader whether the money is recorded and unexplained, or
// moved and unrecorded, which are different jobs for the same person.
test("mixed PAID and PENDING gaps each raise, and each says which it is", async () => {
  const checkDepositProviderEvidence = await load();
  state.gapRows = [
    { id: "dep_paid", pi: "pi_p", status: "PAID" },
    { id: "dep_pending", pi: "pi_q", status: "PENDING" },
  ];
  state.piStatus = { pi_q: "succeeded" };

  const res = await checkDepositProviderEvidence();
  assert.equal(res.gaps, 1);
  assert.equal(res.strandedPending, 1);
  assert.equal(state.exceptions.length, 2);
  assert.deepEqual(
    state.exceptions.map((e) => e.code),
    ["PAYMENT_WEBHOOK_MISSED", "PAYMENT_WEBHOOK_MISSED"],
  );
  assert.deepEqual(
    state.exceptions.map((e) => e.idempotencyKey).sort(),
    ["PAYMENT_WEBHOOK_MISSED:pi_p", "PAYMENT_WEBHOOK_MISSED:pi_q"],
    "one row per PaymentIntent — never one row for both, and never two for one",
  );
  const details = state.exceptions.map((e) => String(e.detail));
  assert.ok(details.some((d) => /is PAID and linked to Stripe PaymentIntent/.test(d)));
  assert.ok(details.some((d) => /is still PENDING, but Stripe reports/.test(d)));
});
