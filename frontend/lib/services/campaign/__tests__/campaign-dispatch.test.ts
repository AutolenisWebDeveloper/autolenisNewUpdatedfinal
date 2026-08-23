// Unit tests for the campaign-dispatch drain — migrated off the Inngest
// campaignFanoutFn + scheduledCampaignCronFn. Pins:
//   • drain returns NO_DUE_CAMPAIGNS when nothing is due;
//   • processCampaign claims the lease, fans eligible contacts onto the comms
//     outbox (respecting DNC / consent / suppression), flips the campaign to
//     completed, and releases the lease;
//   • a lost claim → NOT_RUNNABLE (no fanout);
//   • a missing segment → NO_SEGMENT;
//   • a fanout failure leaves the lease 'failed' (reclaimable) and re-throws.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/campaign/__tests__/campaign-dispatch.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let claimResult = true;
let contacts: Array<Record<string, unknown>> = [];
let campaignRow: Record<string, unknown> | null = null;
let segmentRow: Record<string, unknown> | null = null;
let allowedEmails: string[] = [];
let allowedPhones: string[] = [];
let resolveThrows = false;

const calls = {
  enqueueEmail: [] as Array<Record<string, unknown>>,
  enqueueSms: [] as Array<Record<string, unknown>>,
  campaignUpdates: [] as Record<string, unknown>[],
  release: [] as string[],
  idempotency: [] as { key: string; status: string }[],
};

mock.module("@/lib/jobs/idempotency", {
  namedExports: {
    getSupabase: () => fakeSupabase(),
    claimJob: async () => claimResult,
    updateIdempotencyState: async (_s: unknown, key: string, status: string) => {
      calls.idempotency.push({ key, status });
    },
    releaseIdempotencyGuard: async (_s: unknown, key: string) => {
      calls.release.push(key);
    },
  },
});

mock.module("@/lib/services/comms/comms-outbox.service", {
  namedExports: {
    enqueueEmail: async (p: Record<string, unknown>) => {
      calls.enqueueEmail.push(p);
      return { enqueued: true, dedupKey: String(p.idempotencyKey) };
    },
    enqueueSms: async (p: Record<string, unknown>) => {
      calls.enqueueSms.push(p);
      return { enqueued: true, dedupKey: String(p.idempotencyKey) };
    },
  },
});

mock.module("@/lib/services/segment.service", {
  namedExports: {
    SegmentService: {
      resolveContacts: async () => {
        if (resolveThrows) throw new Error("segment resolve boom");
        return contacts;
      },
    },
  },
});

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      filterEmailsSuppressed: async () => ({ allowed: allowedEmails }),
      filterPhonesSuppressed: async () => ({ allowed: allowedPhones }),
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

// Fake supabase covering the campaign fanout's query chains.
function fakeSupabase() {
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: table === "campaigns" ? campaignRow : table === "segments" ? segmentRow : null }),
      upsert: async () => ({ error: null }),
      update: (d: Record<string, unknown>) => {
        if (table === "campaigns") calls.campaignUpdates.push(d);
        return b;
      },
      then: (resolve: (v: unknown) => void) => {
        // campaign_recipients select(id,contact_id) → return a row per contact
        if (table === "campaign_recipients") {
          resolve({ data: contacts.map((c) => ({ id: `r-${c.id}`, contact_id: c.id })), error: null });
        } else if (table === "campaigns") {
          // drainDueCampaigns select id → due campaigns
          resolve({ data: campaignRow ? [{ id: campaignRow.id }] : [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };
    return b;
  };
  return { from };
}

async function load() {
  return import("@/lib/services/campaign/campaign-dispatch.service");
}

beforeEach(() => {
  claimResult = true;
  resolveThrows = false;
  contacts = [];
  campaignRow = { id: "camp1", segment_id: "seg1", status: "scheduled", type: "email", template_id: "t1" };
  segmentRow = { id: "seg1", conditions: {} };
  allowedEmails = [];
  allowedPhones = [];
  calls.enqueueEmail = [];
  calls.enqueueSms = [];
  calls.campaignUpdates = [];
  calls.release = [];
  calls.idempotency = [];
});

test("drain returns NO_DUE_CAMPAIGNS when none are due", async () => {
  campaignRow = null;
  const { drainDueCampaigns } = await load();
  const r = await drainDueCampaigns();
  assert.equal(r.status, "NO_DUE_CAMPAIGNS");
});

test("processCampaign fans eligible contacts to the outbox, respecting gates, then completes", async () => {
  contacts = [
    { id: "c1", email: "a@x.com", consent_email: true, do_not_contact: false, first_name: "A" },
    { id: "c2", email: "b@x.com", consent_email: true, do_not_contact: false }, // suppressed (not in allowed)
    { id: "c3", email: "c@x.com", consent_email: false, do_not_contact: false }, // no consent
    { id: "c4", email: "d@x.com", consent_email: true, do_not_contact: true }, // DNC
  ];
  allowedEmails = ["a@x.com"]; // only c1 passes suppression
  const { processCampaign } = await load();
  const r = await processCampaign(fakeSupabase() as never, "camp1");
  assert.equal(r.status, "OK");
  assert.equal(calls.enqueueEmail.length, 1, "only the fully-eligible contact is enqueued");
  assert.equal(calls.enqueueEmail[0].email, "a@x.com");
  assert.equal(calls.enqueueEmail[0].idempotencyKey, "campaign:camp1:c1:email");
  const completed = calls.campaignUpdates.find((u) => u.status === "completed");
  assert.ok(completed, "campaign flipped to completed");
  assert.deepEqual(calls.release, ["campaign-dispatch:camp1"], "lease released on success");
});

test("a lost claim → NOT_RUNNABLE, no fanout", async () => {
  claimResult = false;
  const { processCampaign } = await load();
  const r = await processCampaign(fakeSupabase() as never, "camp1");
  assert.equal(r.status, "NOT_RUNNABLE");
  assert.equal(calls.enqueueEmail.length, 0);
});

test("a campaign with no segment → NO_SEGMENT", async () => {
  campaignRow = { id: "camp1", segment_id: null, status: "scheduled", type: "email" };
  const { processCampaign } = await load();
  const r = await processCampaign(fakeSupabase() as never, "camp1");
  assert.equal(r.status, "NO_SEGMENT");
});

test("a fanout failure leaves the lease 'failed' and re-throws", async () => {
  resolveThrows = true;
  const { processCampaign } = await load();
  await assert.rejects(() => processCampaign(fakeSupabase() as never, "camp1"), /segment resolve boom/);
  assert.deepEqual(calls.idempotency, [{ key: "campaign-dispatch:camp1", status: "failed" }]);
  assert.equal(calls.release.length, 0);
});
