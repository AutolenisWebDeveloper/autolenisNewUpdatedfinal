// The five-candidate cap under genuine concurrency, proved against the DATABASE trigger.
//
// WHY THIS CANNOT BE A UNIT TEST. `addToShortlist` counts the buyer's available candidates and
// then inserts. Between those two statements another request can do the same, and both see
// four. The in-memory count is the friendly path — it produces a readable refusal — but it is
// not the enforcement. `shortlist_items_enforce_cap_trg` is: a BEFORE INSERT trigger that takes
// `FOR UPDATE` on the parent shortlist row, so the second transaction blocks until the first
// commits and then counts five. That lock exists only in Postgres, so only Postgres can prove
// it holds. Phase 1 shipped the trigger (§13-D4: MISSING at the database level, PARTIAL in
// code); this is the proof that it does what it was shipped to do.
//
// Requires a REAL, DISPOSABLE Postgres:
//   DATABASE_URL=postgresql://.../autolenis_e2e pnpm test:concurrency
//
// SAFETY: the same allowlist as the offer-selection suite — loopback host plus the reserved
// `autolenis_e2e` database name, decided from the connection string before anything is opened.
// A refusal FAILS in CI (a green pipeline must never mean "the destructive test quietly did not
// run") and skips on a developer machine, reporting NOT VERIFIED. Every row is tagged and
// removed on both the success and the failure path.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDestructiveTarget,
  describeTarget,
  withTaggedRun,
  type CleanupClient,
} from "@/lib/testing/isolated-database";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";

const decision = resolveDestructiveTarget(process.env.DATABASE_URL);

test("the shortlist-cap suite has an approved, positively identified database target", () => {
  assert.notEqual(decision.mode, "fail", decision.reason);
  if (decision.mode === "skip") {
    // eslint-disable-next-line no-console
    console.log(`# ${decision.reason}`);
  }
});

const skip =
  decision.mode === "run"
    ? false
    : decision.mode === "skip"
      ? decision.reason
      : "target refused — the enforcement test above has failed this run";

test("N concurrent adds at the cap boundary leave EXACTLY five shortlist rows", { skip }, async () => {
  const { prisma } = await import("@/lib/prisma");
  // eslint-disable-next-line no-console
  console.log(`[shortlist-cap] isolated target confirmed: ${describeTarget(decision.mode === "run" ? decision.target : null as never)}`);

  const ROUNDS = 3;
  const CONTENDERS = 8;

  await withTaggedRun(prisma as unknown as CleanupClient, async (runTag) => {
    for (let round = 0; round < ROUNDS; round++) {
      const user = await prisma.user.create({
        data: {
          id: `${runTag}_u${round}`, supabaseId: `${runTag}_sb${round}`,
          email: `${runTag}.${round}@isolated.test`, role: "BUYER", requiresPasswordChange: false,
        },
        select: { id: true },
      });
      const buyer = await prisma.buyer.create({
        data: { id: `${runTag}_b${round}`, userId: user.id, firstName: "Cap", lastName: "Race", zip: "76011" },
        select: { id: true },
      });
      const shortlist = await prisma.shortlist.create({
        data: { id: `${runTag}_sl${round}`, buyerId: buyer.id },
        select: { id: true },
      });

      // Eight live, in-radius, fresh listings. All eight are individually addable, so the ONLY
      // thing that can hold the line at five is the trigger.
      const listingIds: string[] = [];
      for (let i = 0; i < CONTENDERS; i++) {
        const row = await prisma.inventoryItem.create({
          data: {
            id: `${runTag}_inv${round}_${i}`,
            vin: `${runTag.slice(-8).toUpperCase()}R${round}V${i}`.slice(0, 17),
            year: 2022, make: "Toyota", model: "Camry", priceCents: 2_500_000 + i,
            lane: "LANE_3", sourceAdapter: `${runTag}-seed`, isActive: true,
            lastSeenAt: new Date(), latitude: 32.75, longitude: -97.12,
            city: "Arlington", state: "TX", zip: "76011",
          },
          select: { id: true },
        });
        listingIds.push(row.id);
      }

      // Genuinely parallel: every insert is dispatched before any of them is awaited.
      const results = await Promise.allSettled(
        listingIds.map((inventoryItemId) =>
          prisma.shortlistItem.create({
            data: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY", distanceMiles: 1.5 },
            select: { id: true },
          }),
        ),
      );

      const landed = results.filter((r) => r.status === "fulfilled").length;
      const refused = results.filter((r) => r.status === "rejected").length;
      const persisted = await prisma.shortlistItem.count({ where: { shortlistId: shortlist.id } });

      assert.equal(persisted, MAX_SHORTLIST_ITEMS,
        `round ${round}: ${CONTENDERS} concurrent adds must leave exactly ${MAX_SHORTLIST_ITEMS} rows, found ${persisted}`);
      assert.equal(landed, MAX_SHORTLIST_ITEMS, `round ${round}: exactly ${MAX_SHORTLIST_ITEMS} inserts may succeed`);
      assert.equal(refused, CONTENDERS - MAX_SHORTLIST_ITEMS, `round ${round}: the rest must be REFUSED, not silently dropped`);

      // The refusal must be the trigger's, not a unique-constraint collision or a deadlock.
      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String((r.reason as Error)?.message ?? r.reason));
      for (const reason of reasons) {
        assert.match(reason, /shortlist|cap|P0001/i, `an unexpected failure shape: ${reason}`);
      }
    }
  }, { prefix: "slcap" });
});

test("the service's own refusal path agrees with the database", { skip }, async () => {
  // Belt and braces on the SHAPE of the refusal: `addToShortlist` must turn the trigger's
  // P0001 into `SHORTLIST_FULL`, not propagate a raw database error to the buyer.
  const { prisma } = await import("@/lib/prisma");
  const { addToShortlist } = await import("@/lib/services/shortlist/shortlist.service");

  await withTaggedRun(prisma as unknown as CleanupClient, async (runTag) => {
    const user = await prisma.user.create({
      data: {
        id: `${runTag}_u`, supabaseId: `${runTag}_sb`, email: `${runTag}@isolated.test`,
        role: "BUYER", requiresPasswordChange: false,
      },
      select: { id: true },
    });
    const buyer = await prisma.buyer.create({
      data: { id: `${runTag}_b`, userId: user.id, firstName: "Cap", lastName: "Serial", zip: "76011" },
      select: { id: true },
    });

    const ids: string[] = [];
    for (let i = 0; i < MAX_SHORTLIST_ITEMS + 1; i++) {
      const row = await prisma.inventoryItem.create({
        data: {
          id: `${runTag}_inv${i}`,
          vin: `${runTag.slice(-9).toUpperCase()}S${i}`.slice(0, 17),
          year: 2022, make: "Toyota", model: "Camry", priceCents: 2_500_000 + i,
          lane: "LANE_3", sourceAdapter: `${runTag}-seed`, isActive: true,
          lastSeenAt: new Date(), latitude: 32.75, longitude: -97.12,
          city: "Arlington", state: "TX", zip: "76011",
        },
        select: { id: true },
      });
      ids.push(row.id);
    }

    for (let i = 0; i < MAX_SHORTLIST_ITEMS; i++) {
      const r = await addToShortlist(buyer.id, ids[i]!);
      assert.equal(r.ok, true, `add ${i} should have succeeded: ${r.ok === false ? r.code : ""}`);
    }
    const sixth = await addToShortlist(buyer.id, ids[MAX_SHORTLIST_ITEMS]!);
    assert.equal(sixth.ok, false);
    assert.equal(sixth.ok === false && sixth.code, "SHORTLIST_FULL");
    assert.match(sixth.ok === false ? sixth.message : "", /Remove one/, "the refusal names the way forward");

    assert.equal(await prisma.shortlistItem.count({ where: { shortlist: { buyerId: buyer.id } } }), MAX_SHORTLIST_ITEMS);
  }, { prefix: "slcap-serial" });
});
