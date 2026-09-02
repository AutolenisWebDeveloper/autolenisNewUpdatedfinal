// Shortlist eligibility — the freshness gate.
//
// A shortlist is what an auction is later activated against, so admitting a
// listing the aggregator stopped carrying months ago sends a buyer after a car
// that is gone. Production held 95 active rows last seen up to four months
// earlier, and every one of them was shortlistable: `addToShortlist` checked
// only that the row existed.
//
// These also pin the DISPLAY boundary the requirement draws: the gate applies to
// entering a shortlist, never to what a buyer can see or search.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/shortlist-freshness-gate.test.ts

import test, { mock, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

interface Call { [k: string]: unknown }

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-02T18:00:00Z");

let vehicle: {
  id: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
} | null = null;
let shortlistItems: Array<{ inventoryItemId: string }> = [];
const created: Call[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventoryItem: { findUnique: async () => vehicle },
      shortlist: {
        upsert: async () => ({ id: "sl_1", buyerId: "buyer_1", items: shortlistItems }),
        findUnique: async () => ({ id: "sl_1", buyerId: "buyer_1", items: shortlistItems }),
      },
      shortlistItem: {
        create: async ({ data }: Call) => { created.push(data as Call); return { id: "sli_1", ...(data as object) }; },
        deleteMany: async () => ({ count: 1 }),
      },
    },
  },
});

async function load() {
  return import("@/lib/services/shortlist/shortlist.service");
}

function listing(overrides: Partial<NonNullable<typeof vehicle>> = {}) {
  return {
    id: "veh_1",
    isActive: true,
    lastSeenAt: new Date(NOW.getTime() - 1 * DAY) as Date | null,
    createdAt: new Date(NOW.getTime() - 200 * DAY),
    ...overrides,
  };
}

beforeEach(() => {
  vehicle = listing();
  shortlistItems = [];
  created.length = 0;
});

describe("the freshness gate", () => {
  test("a fresh listing may be shortlisted", async () => {
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, true);
    assert.equal(created.length, 1);
  });

  test("a listing seen 8 days ago is FLAGGED stale but still shortlistable", async () => {
    vehicle = listing({ lastSeenAt: new Date(NOW.getTime() - 8 * DAY) });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, true, "the 7-day window is a display flag — it must not gate the shortlist");
  });

  test("REGRESSION: a listing not seen in 31 days is NOT shortlist-eligible", async () => {
    vehicle = listing({ lastSeenAt: new Date(NOW.getTime() - 31 * DAY) });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "LISTING_NOT_SHORTLIST_ELIGIBLE");
    assert.equal(created.length, 0, "nothing may be written when the gate rejects");
  });

  test("REGRESSION: a deactivated listing is NOT shortlist-eligible", async () => {
    vehicle = listing({ isActive: false });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "LISTING_NOT_SHORTLIST_ELIGIBLE");
  });

  test("the 30-day boundary is exact", async () => {
    const { addToShortlist } = await load();

    vehicle = listing({ lastSeenAt: new Date(NOW.getTime() - 30 * DAY + 1000) });
    assert.equal((await addToShortlist("buyer_1", "veh_1", NOW)).ok, true);

    created.length = 0;
    vehicle = listing({ lastSeenAt: new Date(NOW.getTime() - 30 * DAY - 1000) });
    assert.equal((await addToShortlist("buyer_1", "veh_1", NOW)).ok, false);
  });

  test("a NULL lastSeenAt falls back to createdAt rather than passing the gate silently", async () => {
    vehicle = listing({ lastSeenAt: null, createdAt: new Date(NOW.getTime() - 40 * DAY) });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false, "an unstamped four-month-old row must not be shortlistable");
  });

  test("a freshly created row with no lastSeenAt is still shortlistable", async () => {
    vehicle = listing({ lastSeenAt: null, createdAt: new Date(NOW.getTime() - 1000) });
    const { addToShortlist } = await load();

    assert.equal((await addToShortlist("buyer_1", "veh_1", NOW)).ok, true);
  });

  test("the rejection message says why, and names the last-seen date when there is one", async () => {
    vehicle = listing({ lastSeenAt: new Date("2026-06-18T22:00:00Z") });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.match(result.message, /30 days/);
      assert.match(result.message, /2026-06-18/);
    }
  });
});

describe("pre-existing rules still hold", () => {
  test("a missing vehicle is VEHICLE_NOT_FOUND", async () => {
    vehicle = null;
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "VEHICLE_NOT_FOUND");
  });

  test("a full shortlist is SHORTLIST_FULL", async () => {
    shortlistItems = Array.from({ length: 5 }, (_, i) => ({ inventoryItemId: `other_${i}` }));
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "SHORTLIST_FULL");
  });

  test("a duplicate is ALREADY_IN_SHORTLIST", async () => {
    shortlistItems = [{ inventoryItemId: "veh_1" }];
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "ALREADY_IN_SHORTLIST");
  });

  test("the gate runs BEFORE the shortlist is created — a stale add makes no empty shortlist", async () => {
    vehicle = listing({ lastSeenAt: new Date(NOW.getTime() - 60 * DAY) });
    const { addToShortlist } = await load();
    const result = await addToShortlist("buyer_1", "veh_1", NOW);

    assert.equal(result.ok, false);
    assert.equal(created.length, 0);
  });
});
