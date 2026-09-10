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

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: { geocodeZip: async () => ({ lat: 32.7357, lng: -97.1081, source: "static" }) },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventoryItem: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => id in inventory)
            .map((id) => ({ id, ...inventory[id]! })),
        // The gate moved INTO the service (Phase 4), so an add now reads the candidate's own
        // gate inputs. Every fixture vehicle sits 2 miles from the buyer and was seen today,
        // which keeps these tests about the CAP and nothing else.
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id in inventory
            ? {
                id: where.id, ...inventory[where.id]!,
                lastSeenAt: new Date(), lane: "LANE_3", dealerId: null, addedByAdminId: null,
                latitude: 32.75, longitude: -97.12,
              }
            : null,
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
          zip: "76011",
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
  inventory.v_new = LIVE;  // the candidate must EXIST before the cap is the reason to refuse
  const { countAvailableItems, addToShortlist } = await load();
  assert.equal(await countAvailableItems(shortlistItems), 5);
  // A RESULT, not a throw: the route needs a code (`SHORTLIST_FULL` means something different
  // to a client than `OUT_OF_RADIUS`) and prose in an Error cannot be turned into one without
  // matching on the message.
  const refused = await addToShortlist("b1", "v_new");
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.code, "SHORTLIST_FULL");
  assert.equal(created.length, 0, "nothing is written on a refusal");
});

test("three of five sold: the cap still counts ROWS, and says so", async () => {
  // THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-10, and the reversal is an owner ruling,
  // not a weakened assertion.
  //
  // The old behaviour — counting available candidates — was written to stop a buyer whose
  // saved cars had sold from being locked out. It did not achieve that. The independent
  // review found that `shortlist_items_enforce_cap_trg` does `count(*)` with no availability
  // predicate (Phase 1 wave `migration.sql:1261-1278`), so this gate waved the add through and
  // the trigger refused it two statements later with a P0001 the buyer never asked for. The
  // lock-out was not prevented; it was moved somewhere with worse copy.
  //
  // The owner ruled on the three available repairs: a migration altering a Phase 1 enforcement
  // object is disproportionate to a counting mismatch; pruning the dead rows automatically
  // deletes something a buyer chose; so the service agrees with the trigger and the copy names
  // the number the buyer can act on. The dead rows are visibly dead on the shortlist page and
  // carry a remove control, which is where the buyer resolves it.
  inventory = { v0: LIVE, v1: SOLD, v3: SOLD, v4: LIVE };  // v2's row is gone entirely
  shortlistItems = ["v0", "v1", "v2", "v3", "v4"].map((v, i) => ({ id: `s${i}`, inventoryItemId: v }));

  const { countAvailableItems, addToShortlist } = await load();
  assert.equal(shortlistItems.length, 5, "five rows exist");
  assert.equal(await countAvailableItems(shortlistItems), 2, "and only two are available");

  inventory.v_new = LIVE;
  const refused = await addToShortlist("b1", "v_new");
  assert.equal(refused.ok, false, "five rows is five rows — the trigger would refuse it anyway");
  assert.equal(refused.ok === false && refused.code, "SHORTLIST_FULL");
  assert.equal(created.length, 0, "nothing is written on a refusal");
  // The copy has to point at the resolution, or a truthful refusal is still a dead end.
  const message = refused.ok === false ? refused.message : "";
  assert.match(message, /5 of 5 saved/, "names the count the buyer can act on");
  assert.match(message, /sold or expired/, "and points at the rows to remove first");
});

test("the cap agrees with the trigger even when EVERY saved car is dead", async () => {
  // The strictest case, and the one the old behaviour was written for. It is still a refusal:
  // the database would refuse it, so the friendly gate says so first, in words.
  inventory = { v0: SOLD, v1: SOLD, v2: SOLD, v3: SOLD, v4: SOLD, v_new: LIVE };
  shortlistItems = ["v0", "v1", "v2", "v3", "v4"].map((v, i) => ({ id: `s${i}`, inventoryItemId: v }));
  const { addToShortlist } = await load();
  const refused = await addToShortlist("b1", "v_new");
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.code, "SHORTLIST_FULL");
  assert.equal(created.length, 0);
});

test("four rows still admits a fifth, whatever their availability", async () => {
  // The cap is not stricter than five. A row count of four accepts an add even when every one
  // of those four is dead — the refusal above is about the NUMBER, not about the condition.
  inventory = { v0: SOLD, v1: SOLD, v2: SOLD, v3: SOLD, v_new: LIVE };
  shortlistItems = ["v0", "v1", "v2", "v3"].map((v, i) => ({ id: `s${i}`, inventoryItemId: v }));
  const { addToShortlist } = await load();
  const added = await addToShortlist("b1", "v_new");
  assert.equal(added.ok, true);
  assert.equal(created.length, 1);
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

// ── the cap value itself, pinned across BOTH layers ─────────────────────────
//
// The cap is enforced twice, in two languages, on two different scopes:
//
//   application  MAX_SHORTLIST_ITEMS in lib/constants.ts, counting ROWS
//   database     shortlist_items_enforce_cap() and auction_vehicles_enforce_cap()
//                in 20261106000100_transaction_spine_foundation, counting ROWS
//                under a FOR UPDATE lock on the parent
//
// BOTH COUNT ROWS as of the owner ruling on 2026-09-10. The application count
// used to discount sold cars, on the theory that a buyer holding five dead
// entries should not be locked out -- but the trigger counts rows regardless,
// so that buyer was refused anyway, one statement later and with no message
// written for them. Two layers is still deliberate: the application count is
// what the buyer is TOLD, and the trigger is what is TRUE under concurrency,
// because both write paths are read-then-write with no transaction and lose
// the race. They must now agree on the predicate as well as the number. Nothing
// tied the two numbers together: `MAX_SHORTLIST_ITEMS = 5` and the trigger's
// hard-coded `IF existing >= 5` could drift apart in either direction, and the
// symptom of drift is either a cap the buyer can exceed or a P0001 the UI has
// no message for. Migrations are immutable once applied, so the constant is the
// side that must move -- and this test is what makes moving it deliberate.
//
// The two triggers count DIFFERENT scopes and that is also deliberate:
// shortlist_items per SHORTLIST (one per buyer, schema.prisma:419 buyerId
// @unique), auction_vehicles per VEHICLE REQUEST. They can legitimately
// disagree; what they may not do is disagree about the NUMBER.

test("MAX_SHORTLIST_ITEMS equals the literal both database triggers enforce", async () => {
  const { readFileSync } = await import("node:fs");
  const { MAX_SHORTLIST_ITEMS } = await import("@/lib/constants");

  const migration = readFileSync(
    new URL(
      "../../../../prisma/migrations/20261106000100_transaction_spine_foundation/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  const triggers = [
    { fn: "shortlist_items_enforce_cap", scope: "shortlist" },
    { fn: "auction_vehicles_enforce_cap", scope: "vehicle request" },
  ] as const;

  for (const { fn, scope } of triggers) {
    const start = migration.indexOf(`FUNCTION "${fn}"`);
    assert.notEqual(
      start,
      -1,
      `${fn}() is gone from the wave. Enforcement object 2 is the DB-level cap; if it moved to a ` +
        "later migration, point this test at that file rather than deleting the assertion.",
    );
    const body = migration.slice(start, migration.indexOf("$fn$ LANGUAGE plpgsql", start));
    const guard = /IF\s+existing\s*>=\s*(\d+)\s+THEN/.exec(body);
    assert.ok(guard, `${fn}() no longer guards on a numeric literal — this test can no longer read the cap.`);

    assert.equal(
      Number(guard[1]),
      MAX_SHORTLIST_ITEMS,
      `The application cap (MAX_SHORTLIST_ITEMS = ${MAX_SHORTLIST_ITEMS}) and the ${scope} trigger ` +
        `(${fn}, >= ${guard[1]}) disagree. s22a caps the shortlist at five candidates in both layers. ` +
        "The migration is immutable once applied, so the constant is the side that moves — and a new " +
        "forward migration is the only way to change the trigger.",
    );
  }
});
