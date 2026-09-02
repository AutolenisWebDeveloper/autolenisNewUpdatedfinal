// The five-candidate cap counts AVAILABLE vehicles, not rows.
//
// Counting rows locks a buyer whose saved cars have sold out of their own shortlist: five
// dead entries report "5 of 5 full" while the auction has zero candidates in it, and the
// buyer cannot add the replacement for the car that just sold.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/shortlist-cap.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** id -> inventory facts. A missing id models a row that no longer exists. */
let inventory: Record<string, { isActive: boolean; priceCents: number }> = {};
let shortlistItems: Array<{ id: string; inventoryItemId: string }> = [];
const created: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventoryItem: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => id in inventory)
            .map((id) => ({ id, ...inventory[id]! })),
      },
      shortlist: {
        upsert: async () => ({ id: "sl_1", buyerId: "b1", items: shortlistItems }),
        findUnique: async () => ({ id: "sl_1", buyerId: "b1", items: shortlistItems }),
      },
      shortlistItem: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "item_new", ...data };
        },
        deleteMany: async () => ({ count: 1 }),
      },
      buyer: {
        findUnique: async () => ({
          id: "b1",
          preQualification: { expiresAt: new Date("2099-01-01"), decision: "APPROVED" },
        }),
      },
    },
  },
});

async function load() {
  return import("@/lib/services/shortlist/shortlist.service");
}

const LIVE = { isActive: true, priceCents: 2_500_000 };
const SOLD = { isActive: false, priceCents: 2_500_000 };

beforeEach(() => {
  inventory = {};
  shortlistItems = [];
  created.length = 0;
});

test("five LIVE vehicles fill the shortlist", async () => {
  for (let i = 0; i < 5; i++) {
    inventory[`v${i}`] = LIVE;
    shortlistItems.push({ id: `s${i}`, inventoryItemId: `v${i}` });
  }
  const { countAvailableItems, addToShortlist } = await load();
  assert.equal(await countAvailableItems(shortlistItems), 5);
  await assert.rejects(() => addToShortlist("b1", "v_new"), /limited to 5/);
});

test("REPRODUCTION: three of five sold — the buyer can still add a replacement", async () => {
  inventory = { v0: LIVE, v1: SOLD, v3: SOLD, v4: LIVE };  // v2's row is gone entirely
  shortlistItems = ["v0", "v1", "v2", "v3", "v4"].map((v, i) => ({ id: `s${i}`, inventoryItemId: v }));

  const { countAvailableItems, addToShortlist } = await load();
  assert.equal(shortlistItems.length, 5, "five rows exist");
  assert.equal(await countAvailableItems(shortlistItems), 2, "but only two are available");

  inventory.v_new = LIVE;
  await addToShortlist("b1", "v_new");
  assert.equal(created.length, 1, "the add must succeed — the cap counts candidates, not corpses");
});

test("a shortlist of only unavailable vehicles is NOT ready to auction", async () => {
  inventory = { v0: SOLD, v1: SOLD };
  shortlistItems = [
    { id: "s0", inventoryItemId: "v0" },
    { id: "s1", inventoryItemId: "v1" },
  ];
  const { getShortlistReadiness } = await load();
  const r = await getShortlistReadiness("b1");
  assert.equal(r.itemCount, 0);
  assert.equal(r.isReady, false, "a prequalified buyer with two sold cars must not read as ready");
  assert.equal(r.nextStep, "add-vehicles");
});

test("an empty shortlist needs no query and counts zero", async () => {
  const { countAvailableItems } = await load();
  assert.equal(await countAvailableItems([]), 0);
});

test("a zero-priced listing does not count — there is nothing to quote", async () => {
  inventory = { v0: { isActive: true, priceCents: 0 } };
  shortlistItems = [{ id: "s0", inventoryItemId: "v0" }];
  const { countAvailableItems } = await load();
  assert.equal(await countAvailableItems(shortlistItems), 0);
});
