// Shared provider-webhook replay dedup (claimProviderEvent) — the one consolidated
// implementation of the claim/settle pattern now used by the Higgsfield, MicroBilt
// and Twilio inbound handlers against the existing PaymentProviderEvent ledger.
//
// Proves the invariants those handlers rely on:
//   • first delivery → 'claimed', settle() marks the row processed;
//   • a delivery after settle → 'duplicate' (no reprocessing);
//   • a concurrent create race (P2002) → 'in_progress' (caller retries, no double-run);
//   • an unprocessed row from a crashed prior delivery → re-'claimed' (retry, not lost);
//   • keys are provider-namespaced so they can never collide with a Stripe event id.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/webhooks/__tests__/provider-event-dedup.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

type Row = { eventId: string; eventType: string; processed: boolean; processedAt: Date | null };
let rows: Row[];
// Force a unique-violation on the NEXT create regardless of current contents, to
// model a concurrent delivery that inserted the row between our read and write.
let raceOnNextCreate = false;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      paymentProviderEvent: {
        findUnique: async ({ where }: { where: { eventId: string } }) =>
          rows.find((r) => r.eventId === where.eventId) ?? null,
        create: async ({ data }: { data: Row }) => {
          if (raceOnNextCreate || rows.some((r) => r.eventId === data.eventId)) {
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          rows.push({ eventId: data.eventId, eventType: data.eventType, processed: false, processedAt: null });
          return data;
        },
        update: async ({ where, data }: { where: { eventId: string }; data: Partial<Row> }) => {
          const row = rows.find((r) => r.eventId === where.eventId);
          if (row) Object.assign(row, data);
          return row;
        },
      },
    },
  },
});

async function claim(params: { provider: string; eventId: string; eventType: string; payload: unknown }) {
  const { claimProviderEvent } = await import("@/lib/services/webhooks/provider-event-dedup");
  return claimProviderEvent(params);
}

beforeEach(() => { rows = []; raceOnNextCreate = false; });

test("first delivery is 'claimed' and settle() marks the row processed", async () => {
  const c = await claim({ provider: "higgsfield", eventId: "req_1:failed", eventType: "failed", payload: { x: 1 } });
  assert.equal(c.status, "claimed");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventId, "higgsfield:req_1:failed", "key is provider-namespaced");
  assert.equal(rows[0].processed, false);
  if (c.status === "claimed") await c.settle();
  assert.equal(rows[0].processed, true);
  assert.ok(rows[0].processedAt instanceof Date);
});

test("a delivery after settle is 'duplicate' — no reprocessing", async () => {
  const first = await claim({ provider: "microbilt", eventId: "b1:completed:APPROVED", eventType: "ibv.completed", payload: {} });
  if (first.status === "claimed") await first.settle();
  const second = await claim({ provider: "microbilt", eventId: "b1:completed:APPROVED", eventType: "ibv.completed", payload: {} });
  assert.equal(second.status, "duplicate");
});

test("a concurrent create race (P2002) yields 'in_progress' — caller retries, never double-runs", async () => {
  raceOnNextCreate = true;
  const c = await claim({ provider: "twilio", eventId: "SM123", eventType: "sms.inbound", payload: {} });
  assert.equal(c.status, "in_progress");
});

test("an unprocessed row from a crashed prior delivery is re-'claimed' (retry, not silently done)", async () => {
  // A prior delivery created the row but died before settle().
  rows.push({ eventId: "higgsfield:req_9:completed", eventType: "higgsfield.completed", processed: false, processedAt: null });
  const c = await claim({ provider: "higgsfield", eventId: "req_9:completed", eventType: "completed", payload: {} });
  assert.equal(c.status, "claimed", "re-drives instead of being treated as duplicate");
  if (c.status === "claimed") await c.settle();
  assert.equal(rows.find((r) => r.eventId === "higgsfield:req_9:completed")!.processed, true);
});

test("distinct statuses for the same provider job key independently", async () => {
  const completed = await claim({ provider: "higgsfield", eventId: "req_5:completed", eventType: "completed", payload: {} });
  const failed = await claim({ provider: "higgsfield", eventId: "req_5:failed", eventType: "failed", payload: {} });
  assert.equal(completed.status, "claimed");
  assert.equal(failed.status, "claimed", "a different status is a different event, not a duplicate");
  assert.equal(rows.length, 2);
});
