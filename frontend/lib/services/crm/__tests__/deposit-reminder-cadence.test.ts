// The $99 deposit-reminder CADENCE — six touches, end to end.
//
// Owner spec: immediate → +1h → +6h → +24h → +72h → day-7.
// The implementation carried four (+1h/+6h/+24h/+72h); an immediate first touch
// and a day-7 final notice are added. The documented "+1h first-touch grace"
// rationale is noted and overruled by the owner's product decision, so the
// producer enqueues touch 1 with no delay.
//
// Everything here runs the REAL code: the real producer (lifecycle-scheduler),
// the real SEQUENCES table and drain (lifecycle-touch-drain.service), the real
// send-time guard (lib/qstash/state.depositConversionResolved) and — for the TCPA
// assertions — the real send layer (lib/qstash/notify). Faked: the
// `lifecycle_touch_schedule` and `contact_identities` tables (in-memory shims with
// the same filter semantics), Prisma reads behind the guard, and the Twilio
// client (spied, so nothing is actually sent).
//
// The two NEW touches are the point of this file: a touch must not escape a guard
// by virtue of being new. Touch 1 and touch 6 are therefore asserted against all
// three gates individually — deposit conversion, administrative halt, and the
// TCPA SMS consent gate — not merely by being members of the same table.
//
// SCOPE LIMIT: the email SEND is not asserted. notify.ts builds its Resend client
// internally via getResend(), which returns null without a RESEND_API_KEY, so an
// "email delivered" assertion would pass or fail for reasons unrelated to this
// change. Only claims independent of the email transport are made below.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/crm/__tests__/deposit-reminder-cadence.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const MIN = 60_000;
const HR = 60 * MIN;

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
let smsSends: Array<{ to: string; body: string }> = [];
let deposits: Array<{ status: string }> = [];
let buyerHalt: string | null = null;
let contactConsentSms = true;
let contactDoNotContact = false;
let nextId = 1;

/** Thenable query builder over the in-memory touch table — mirrors only the
 *  operators enqueue and drain actually use. */
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
      if (op === "select") { resolve({ data: matched.slice(0, limit), error: null }); return; }
      if (op === "update") {
        matched = matched.slice(0, limit);
        for (const r of matched) Object.assign(r, payload);
        resolve({ data: matched.map((r) => ({ ...r })), error: null });
        return;
      }
      // upsert onConflict(base_key,sequence) + ignoreDuplicates — the UNIQUE
      // constraint that makes enqueue and chaining idempotent.
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
    if (name === "lifecycle_touch_schedule") {
      return {
        select: () => builder("select"),
        upsert: (payload: Record<string, unknown>) => builder("upsert", payload),
        update: (payload: Record<string, unknown>) => builder("update", payload),
      };
    }
    if (name === "contact_identities") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { contact_id: "c1" } }) }) }) }),
      };
    }
    throw new Error(`unexpected table: ${name}`);
  },
};

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => fakeSupabase } });

// QStash is removed from the stack. Throwing makes any regression that routes
// there loud instead of silently dropping the buyer.
mock.module("@/lib/qstash/dispatch", {
  namedExports: { dispatch: async () => { throw new Error("QStash was called — it is removed from the stack"); } },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deposit: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          const filter = (where.status as { in?: string[] } | undefined)?.in;
          return deposits.filter((d) => !filter || filter.includes(d.status));
        },
      },
      buyer: {
        findUnique: async () => ({
          suspendedAt: buyerHalt === "suspendedAt" ? new Date() : null,
          disabledAt: buyerHalt === "disabledAt" ? new Date() : null,
          archivedAt: buyerHalt === "archivedAt" ? new Date() : null,
          purgedAt: buyerHalt === "purgedAt" ? new Date() : null,
        }),
      },
      vehicleRequest: { findFirst: async () => null },
    },
  },
});

// Real notifyContact runs; only the transport and the consent store are faked.
mock.module("@/lib/services/contact.service", {
  namedExports: {
    ContactService: {
      getContactById: async () => ({
        id: "c1",
        email: "buyer@example.com",
        phone: "+15551230000",
        consent_sms: contactConsentSms,
        do_not_contact: contactDoNotContact,
      }),
    },
  },
});
mock.module("@/lib/services/suppression.service", {
  namedExports: { SuppressionService: { isSmsSuppressed: async () => false, isEmailSuppressed: async () => false } },
});
mock.module("twilio", {
  defaultExport: () => ({
    messages: { create: async ({ to, body }: { to: string; body: string }) => { smsSends.push({ to, body }); return { sid: "SM1" }; } },
  }),
});

mock.module("@/lib/services/system/feature-flags.service", {
  namedExports: {
    isEnabled: async () => false, // no flag row — production's default
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

/** The owner's cadence, as cumulative offsets from enrollment. */
const CADENCE = [
  { sequence: "deposit_reminder_1", offsetMs: 0, label: "immediate" },
  { sequence: "deposit_reminder_2", offsetMs: 1 * HR, label: "+1h" },
  { sequence: "deposit_reminder_3", offsetMs: 6 * HR, label: "+6h" },
  { sequence: "deposit_reminder_4", offsetMs: 24 * HR, label: "+24h" },
  { sequence: "deposit_reminder_5", offsetMs: 72 * HR, label: "+72h" },
  { sequence: "deposit_reminder_6", offsetMs: 168 * HR, label: "day-7" },
];

function pending(sequence: string): Row | undefined {
  return table.find((r) => r.sequence === sequence && r.status === "pending");
}

/** Pull every pending row forward so the drain sees it as due. */
function fastForward() {
  for (const r of table) if (r.status === "pending") r.run_at = new Date(Date.now() - 1000).toISOString();
}

beforeEach(() => {
  table = [];
  smsSends = [];
  deposits = [{ status: "PENDING" }];
  buyerHalt = null;
  contactConsentSms = true;
  contactDoNotContact = false;
  nextId = 1;
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.RESEND_API_KEY = ""; // no email transport — see SCOPE LIMIT
});

async function enroll() {
  const { scheduleLifecycleWorkload } = await import("@/lib/services/crm/lifecycle-scheduler");
  await scheduleLifecycleWorkload(BUYER);
}

async function drain() {
  const { drainDueLifecycleTouches } = await import("@/lib/services/crm/lifecycle-touch-drain.service");
  return drainDueLifecycleTouches();
}

// ── The cadence itself ──────────────────────────────────────────────────────

test("the producer enqueues touch 1 IMMEDIATELY — no first-touch grace", async () => {
  const before = Date.now();
  await enroll();

  const row = pending("deposit_reminder_1");
  assert.ok(row, "touch 1 must be enqueued at enrollment");
  const delayMs = new Date(row!.run_at).getTime() - before;
  assert.ok(
    delayMs >= -5_000 && delayMs <= 5_000,
    `the immediate touch must be due at ~0, got ${Math.round(delayMs / MIN)} minutes — ` +
      `the owner's cadence replaces the +1h grace with an immediate "here's your link back"`,
  );
});

test("the immediate touch is DUE right away — the drain sends it on its next pass", async () => {
  await enroll();
  const summary = await drain();
  assert.equal(summary.sent, 1, `touch 1 must be due without waiting, got ${JSON.stringify(summary)}`);
});

test("all SIX touches fire in order at the owner's offsets, with no gaps", async () => {
  await enroll();

  let cumulativeMs = 0;
  const fired: string[] = [];

  for (let i = 0; i < CADENCE.length; i++) {
    const step = CADENCE[i]!;
    const row = pending(step.sequence);
    assert.ok(row, `${step.sequence} (${step.label}) must be pending at step ${i + 1} — the chain has a gap`);

    if (i > 0) {
      // Each touch chains the next from the moment it is sent, so the delta is
      // what the code controls; the running sum is the cadence the buyer sees.
      const deltaMs = new Date(row!.run_at).getTime() - Date.now();
      const expectedDelta = step.offsetMs - CADENCE[i - 1]!.offsetMs;
      assert.ok(
        Math.abs(deltaMs - expectedDelta) <= 60_000,
        `${step.sequence} must be chained ${expectedDelta / HR}h after ${CADENCE[i - 1]!.sequence}, ` +
          `got ${(deltaMs / HR).toFixed(2)}h`,
      );
      cumulativeMs += deltaMs;
      assert.ok(
        Math.abs(cumulativeMs - step.offsetMs) <= 60_000,
        `${step.sequence} lands at ${(cumulativeMs / HR).toFixed(2)}h from enrollment; the spec says ${step.label}`,
      );
    }

    fastForward();
    const summary = await drain();
    assert.equal(summary.sent, 1, `${step.sequence} must send, got ${JSON.stringify(summary)}`);
    fired.push(step.sequence);
  }

  assert.deepEqual(fired, CADENCE.map((c) => c.sequence), "six touches, in order");
  assert.equal(
    table.filter((r) => r.status === "done").length,
    6,
    "a non-converting buyer receives exactly six touches over seven days",
  );
});

test("touch 6 is TERMINAL — the chain stops at day-7", async () => {
  await enroll();
  for (let i = 0; i < CADENCE.length; i++) { fastForward(); await drain(); }

  assert.equal(
    table.find((r) => r.sequence === "deposit_reminder_6")?.status,
    "done",
    "the day-7 notice must actually have been sent — otherwise this test passes vacuously",
  );
  assert.equal(pending("deposit_reminder_7"), undefined, "there is no seventh touch");
  assert.deepEqual(
    table.filter((r) => r.status === "pending").map((r) => r.sequence),
    [],
    "nothing is left scheduled after the day-7 final notice",
  );
});

test("no duplicate sends — each sequence is sent exactly once across the whole chain", async () => {
  await enroll();
  for (let i = 0; i < CADENCE.length + 2; i++) { fastForward(); await drain(); }

  const counts = new Map<string, number>();
  for (const r of table) counts.set(r.sequence, (counts.get(r.sequence) ?? 0) + 1);
  for (const [sequence, n] of counts) {
    assert.equal(n, 1, `UNIQUE(base_key, sequence) must hold — ${sequence} has ${n} rows`);
  }
  assert.equal(table.length, 6, "six rows, one per touch");
});

test("re-enrolment mid-chain does not restart or duplicate the sequence", async () => {
  await enroll();
  fastForward();
  await drain();            // touch 1 sent, touch 2 pending
  await enroll();           // buyer returns to checkout and abandons again

  assert.equal(table.filter((r) => r.sequence === "deposit_reminder_1").length, 1, "no second touch 1");
  assert.equal(table.find((r) => r.sequence === "deposit_reminder_1")!.status, "done", "the sent touch stays done");
});

// ── The two NEW touches are subject to EVERY guard ──────────────────────────
// A new touch must not bypass a gate by virtue of being new, so each gate is
// asserted against deposit_reminder_1 and deposit_reminder_6 specifically.

const NEW_TOUCHES = ["deposit_reminder_1", "deposit_reminder_6"] as const;

/** Advance the chain until `sequence` is the pending touch, without sending it.
 *  The earlier touches in the walk send legitimately, so the transport spy is
 *  cleared afterwards — every assertion below is about the touch under test. */
async function advanceTo(sequence: string) {
  await enroll();
  while (!pending(sequence)) {
    const before = table.length;
    fastForward();
    const summary = await drain();
    if (table.length === before && summary.sent === 0) throw new Error(`chain stalled before ${sequence}`);
  }
  smsSends = [];
}

for (const sequence of NEW_TOUCHES) {
  for (const status of ["PAID", "REFUNDED", "FAILED"]) {
    test(`GUARD (conversion): ${sequence} is canceled, not sent, when the deposit is ${status}`, async () => {
      await advanceTo(sequence);
      deposits = [{ status }];
      fastForward();
      const summary = await drain();

      assert.equal(summary.sent, 0, `a ${status} deposit must never produce a ${sequence} send`);
      assert.equal(summary.canceled, 1);
      assert.deepEqual(smsSends, []);
    });
  }

  test(`GUARD (conversion): ${sequence} is canceled when no deposit exists at all`, async () => {
    await advanceTo(sequence);
    deposits = [];
    fastForward();
    const summary = await drain();
    assert.equal(summary.sent, 0, "nothing to convert — do not chase");
    assert.equal(summary.canceled, 1);
  });

  for (const field of ["suspendedAt", "disabledAt", "archivedAt", "purgedAt"] as const) {
    test(`GUARD (admin halt): ${sequence} is not sent to a ${field.replace("At", "")} buyer`, async () => {
      await advanceTo(sequence);
      buyerHalt = field;
      fastForward();
      const summary = await drain();

      assert.equal(summary.sent, 0, `an admin set ${field}; ${sequence} must respect that decision`);
      assert.equal(summary.canceled, 1);
      assert.deepEqual(smsSends, [], "no marketing message reaches a halted buyer");
    });
  }

  test(`GUARD (TCPA): ${sequence} sends no SMS without consent_sms`, async () => {
    await advanceTo(sequence);
    contactConsentSms = false;
    fastForward();
    const summary = await drain();

    assert.equal(summary.sent, 1, "the touch still completes — the email leg is unaffected");
    assert.deepEqual(smsSends, [], `${sequence} must not text an unconsented buyer`);
  });

  test(`GUARD (TCPA): ${sequence} sends no SMS to a do_not_contact buyer`, async () => {
    await advanceTo(sequence);
    contactDoNotContact = true;
    fastForward();
    await drain();
    assert.deepEqual(smsSends, [], "do-not-contact outranks an SMS opt-in");
  });

  test(`GUARD (TCPA): ${sequence}'s SMS carries the required opt-out when consent IS on file`, async () => {
    await advanceTo(sequence);
    contactConsentSms = true;
    fastForward();
    await drain();

    assert.equal(smsSends.length, 1, `${sequence} must reach a consented buyer — the gate must not over-block`);
    assert.match(smsSends[0]!.body, /reply stop to opt out/i, "every marketing SMS carries the opt-out");
    assert.match(smsSends[0]!.body, /\/buyer\/deposit/, "the CTA points at the $99 checkout");
  });
}
