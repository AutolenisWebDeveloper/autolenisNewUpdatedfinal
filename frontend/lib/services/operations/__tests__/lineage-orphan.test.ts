// §3's orphan rule — the forward guard and the sweep.
//
// For each of auction, offer, deal, contract and pickup (the payment half is
// PAYMENT_UNROUTABLE, covered by the webhook), an unresolvable parent must yield
// exactly one queue_items row typed LINEAGE_ORPHAN owned by Operations, the stored
// parent reference must be unchanged afterwards, and the child must not be created.
//
// The property that matters most is the negative one: NOTHING here re-parents. The
// sweep reads and raises; it never writes to the row it swept.
//
// Run: pnpm test:operations

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface QRow { id: string; status: string; idempotencyKey: string | null; [k: string]: unknown }

const db = {
  queue: new Map<string, QRow>(),
  vehicleRequests: new Map<string, { id: string }>(),
  auctions: new Map<string, { id: string; vehicleRequestId: string | null; buyerId: string }>(),
  offers: new Map<string, { id: string; auctionId: string | null; dealerId: string }>(),
  deals: new Map<string, { id: string; offerId: string | null; vehicleRequestOfferId: string | null; buyerId: string }>(),
  contractVersions: new Map<string, { id: string; dealId: string }>(),
  pickups: new Map<string, { id: string; dealId: string }>(),
  deposits: new Map<string, { id: string; vehicleRequestId: string | null; buyerId: string }>(),
  auctionVehicles: new Map<string, { id: string; vehicleRequestId: string | null; auctionId: string; candidateStatus: string }>(),
  vehicleRequestOffers: new Map<string, { id: string }>(),
  buyers: new Map<string, { id: string }>(),
  /** Set by any test that wants to prove nothing wrote to a swept table. */
  writesToSweptTables: [] as string[],
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
    } else if (v && typeof v === "object" && "not" in (v as object)) {
      if (row[k] === (v as { not: unknown }).not) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function readOnlyModel(store: Map<string, Record<string, unknown>>, name: string) {
  return {
    findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
    // `where` is honoured: the candidate sweep excludes DROPPED rows, and a double that
    // ignored the filter would report the exclusion as working when it is not.
    findMany: async ({ take, where }: { take?: number; where?: Record<string, unknown> }) =>
      [...store.values()].filter((r) => (where ? matches(r, where) : true)).slice(0, take ?? 500),
    // Present so a re-parent attempt is observable rather than a crash.
    update: async () => {
      db.writesToSweptTables.push(name);
      throw new Error(`${name}.update must not be called by the sweep`);
    },
    updateMany: async () => {
      db.writesToSweptTables.push(name);
      throw new Error(`${name}.updateMany must not be called by the sweep`);
    },
  };
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      queueItem: {
        create: async ({ data }: { data: QRow }) => {
          if (data.idempotencyKey !== null) {
            for (const e of db.queue.values()) {
              if (e.idempotencyKey === data.idempotencyKey) {
                const err = new Error("unique") as Error & { code?: string };
                err.code = "P2002";
                throw err;
              }
            }
          }
          const row = { ...data };
          db.queue.set(row.id, row);
          return row;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          [...db.queue.values()].find((r) => matches(r, where)) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => db.queue.get(where.id) ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          [...db.queue.values()].filter((r) => matches(r, where)),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          let count = 0;
          for (const r of db.queue.values()) {
            if (!matches(r, where)) continue;
            Object.assign(r, data);
            count++;
          }
          return { count };
        },
      },
      vehicleRequest: readOnlyModel(db.vehicleRequests as never, "vehicleRequest"),
      auction: readOnlyModel(db.auctions as never, "auction"),
      offer: readOnlyModel(db.offers as never, "offer"),
      deal: readOnlyModel(db.deals as never, "deal"),
      contractVersion: readOnlyModel(db.contractVersions as never, "contractVersion"),
      pickup: readOnlyModel(db.pickups as never, "pickup"),
      deposit: readOnlyModel(db.deposits as never, "deposit"),
      auctionVehicle: readOnlyModel(db.auctionVehicles as never, "auctionVehicle"),
      vehicleRequestOffer: readOnlyModel(db.vehicleRequestOffers as never, "vehicleRequestOffer"),
      buyer: readOnlyModel(db.buyers as never, "buyer"),
    },
  },
});

function lineage() {
  return import("@/lib/services/operations/lineage.service");
}

beforeEach(() => {
  db.queue.clear();
  db.vehicleRequests.clear();
  db.auctions.clear();
  db.offers.clear();
  db.deals.clear();
  db.contractVersions.clear();
  db.pickups.clear();
  db.deposits.clear();
  db.auctionVehicles.clear();
  db.vehicleRequestOffers.clear();
  db.buyers.clear();
  db.writesToSweptTables = [];
});

test("a resolvable parent passes quietly and raises nothing", async () => {
  const { assertParentResolvable } = await lineage();
  db.auctions.set("a1", { id: "a1", vehicleRequestId: "vr1", buyerId: "b1" });
  await assertParentResolvable({
    recordClass: "offer",
    parents: [{ kind: "auction", id: "a1" }],
    refs: { auctionId: "a1" },
  });
  assert.equal(db.queue.size, 0);
});

for (const c of [
  { recordClass: "offer", parent: { kind: "auction", id: "ghost" }, refs: { dealerId: "d1" } },
  { recordClass: "contractVersion", parent: { kind: "deal", id: "ghost" }, refs: { dealId: "ghost" } },
  { recordClass: "pickup", parent: { kind: "deal", id: "ghost" }, refs: { dealId: "ghost" } },
  { recordClass: "auction", parent: { kind: "vehicleRequest", id: "ghost" }, refs: { buyerId: "b1" } },
  { recordClass: "deal", parent: { kind: "offer", id: "ghost" }, refs: { buyerId: "b1" } },
  { recordClass: "deposit", parent: { kind: "vehicleRequest", id: "ghost" }, refs: { buyerId: "b1" } },
] as const) {
  test(`${c.recordClass}: an unresolvable parent raises exactly one LINEAGE_ORPHAN and refuses the write`, async () => {
    const { assertParentResolvable, LineageOrphanError } = await lineage();
    await assert.rejects(
      () =>
        assertParentResolvable({
          recordClass: c.recordClass,
          parents: [c.parent],
          refs: c.refs,
        }),
      LineageOrphanError,
      "the child must not be created under a parent that does not resolve"
    );
    assert.equal(db.queue.size, 1);
    const row = [...db.queue.values()][0];
    assert.equal(row.exceptionCode, "LINEAGE_ORPHAN");
    assert.equal(row.type, "LINEAGE_ORPHAN");
    assert.equal(row.ownerRole, "OPERATIONS");
    assert.ok(String(row.requiredAction).includes("Never write the parent id from a service"));
  });
}

test("a class whose parent this phase does not require passes on a missing parent", async () => {
  const { assertParentResolvable, LINEAGE_SPECS, CURRENT_PHASE } = await lineage();
  assert.ok(LINEAGE_SPECS.auction.requiredFromPhase > CURRENT_PHASE, "auction parents are deferred in this phase");
  await assertParentResolvable({ recordClass: "auction", parents: [{ kind: "vehicleRequest", id: null }], refs: { buyerId: "b1" } });
  assert.equal(db.queue.size, 0, "the legacy deposit-settlement path must not be refused in this phase");
});

test("a class whose parent this phase DOES require raises on a missing parent", async () => {
  const { assertParentResolvable, LineageOrphanError } = await lineage();
  await assert.rejects(
    () => assertParentResolvable({ recordClass: "offer", parents: [{ kind: "auction", id: null }], refs: { dealerId: "d1" } }),
    LineageOrphanError
  );
  assert.equal(db.queue.size, 1);
});

test("a deal resolving EITHER offer link is not an orphan", async () => {
  const { assertParentResolvable } = await lineage();
  db.vehicleRequestOffers.set("vro1", { id: "vro1" });
  await assertParentResolvable({
    recordClass: "deal",
    parents: [
      { kind: "offer", id: null },
      { kind: "vehicleRequestOffer", id: "vro1" },
    ],
    refs: { buyerId: "b1" },
  });
  assert.equal(db.queue.size, 0);
});

test("the sweep raises one exception per orphaned row and re-parents nothing", async () => {
  const { sweepLineageOrphans } = await lineage();
  db.auctions.set("a1", { id: "a1", vehicleRequestId: "vr_gone", buyerId: "b1" });
  db.offers.set("o1", { id: "o1", auctionId: "a_gone", dealerId: "d1" });
  db.offers.set("o2", { id: "o2", auctionId: "a1", dealerId: "d1" });
  db.pickups.set("p1", { id: "p1", dealId: "deal_gone" });

  const report = await sweepLineageOrphans({ includeDeferred: true });

  const byClass = report.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.recordClass] = (acc[f.recordClass] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(byClass.auction, 1);
  assert.equal(byClass.offer, 1, "o2 resolves and must not be flagged");
  assert.equal(byClass.pickup, 1);
  assert.equal(db.queue.size, 3);
  assert.deepEqual(db.writesToSweptTables, [], "the sweep must never write to a swept table");

  // The stored parent reference is unchanged.
  assert.equal(db.auctions.get("a1")?.vehicleRequestId, "vr_gone");
  assert.equal(db.offers.get("o1")?.auctionId, "a_gone");
});

test("re-running the sweep does not multiply exceptions", async () => {
  const { sweepLineageOrphans } = await lineage();
  db.pickups.set("p1", { id: "p1", dealId: "deal_gone" });
  await sweepLineageOrphans();
  await sweepLineageOrphans();
  assert.equal(db.queue.size, 1);
});

test("by default the sweep skips the classes whose parent this phase defers", async () => {
  const { sweepLineageOrphans } = await lineage();
  db.auctions.set("a1", { id: "a1", vehicleRequestId: null, buyerId: "b1" });
  db.deposits.set("d1", { id: "d1", vehicleRequestId: null, buyerId: "b1" });
  const report = await sweepLineageOrphans();
  assert.ok(report.skipped.includes("auction"));
  assert.ok(report.skipped.includes("deposit"));
  assert.equal(db.queue.size, 0, "the owner rules control/L3-01 before historical rows are swept");
});


// ── PHASE 4: the candidate class ────────────────────────────────────────────

test("a candidate with no Vehicle Request is an orphan, and `only` sweeps it alone", async () => {
  // Production's three `auction_vehicles` rows all carry vehicle_request_id NULL, because
  // `ensureAuctionVehicleFromRequest` read the request and discarded its id. The ruling on them
  // is: leave them in place, with an exception raised. This is that, runnable — and it must not
  // drag in the deposit and auction classes, whose deferral is an open owner ruling.
  const { sweepLineageOrphans } = await lineage();
  db.auctions.set("a1", { id: "a1", vehicleRequestId: null, buyerId: "b1" });
  db.deposits.set("d1", { id: "d1", vehicleRequestId: null, buyerId: "b1" });
  db.auctionVehicles.set("av1", { id: "av1", vehicleRequestId: null, auctionId: "a1", candidateStatus: "ACTIVE" });

  const report = await sweepLineageOrphans({ only: ["auctionVehicle"], includeDeferred: true });

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]!.recordClass, "auctionVehicle");
  assert.equal(report.findings[0]!.reason, "MISSING");
  assert.equal(report.findings[0]!.parentKind, "vehicleRequest");
  assert.equal(db.queue.size, 1, "no deposit or auction exception was raised");
  assert.deepEqual(db.writesToSweptTables, [], "the orphaned candidates are left exactly as they are");
  assert.equal(db.auctionVehicles.get("av1")?.vehicleRequestId, null);
});

test("a valid AUCTION does not excuse a missing request", async () => {
  // `parents` is an alternatives list. Naming `auction` beside `vehicleRequest` would let a
  // candidate with a live auction and no request pass — which is the entire population this
  // class exists to find.
  const { LINEAGE_SPECS } = await lineage();
  assert.deepEqual([...LINEAGE_SPECS.auctionVehicle.parents], ["vehicleRequest"]);
});

test("a candidate whose request resolves is not flagged", async () => {
  const { sweepLineageOrphans } = await lineage();
  db.vehicleRequests.set("vr1", { id: "vr1" });
  db.auctions.set("a1", { id: "a1", vehicleRequestId: "vr1", buyerId: "b1" });
  db.auctionVehicles.set("av1", { id: "av1", vehicleRequestId: "vr1", auctionId: "a1", candidateStatus: "ACTIVE" });
  const report = await sweepLineageOrphans({ only: ["auctionVehicle"], includeDeferred: true });
  assert.deepEqual(report.findings, []);
});

test("a DROPPED candidate is not swept — it is a record of a decision, not a live child", async () => {
  const { sweepLineageOrphans } = await lineage();
  db.auctions.set("a1", { id: "a1", vehicleRequestId: null, buyerId: "b1" });
  db.auctionVehicles.set("av1", { id: "av1", vehicleRequestId: null, auctionId: "a1", candidateStatus: "DROPPED" });
  const report = await sweepLineageOrphans({ only: ["auctionVehicle"], includeDeferred: true });
  assert.deepEqual(report.findings, [], "raising an exception for a dropped row asks an operator to fix history");
  assert.equal(report.scanned.auctionVehicle, 0);
});

test("the candidate class is registered as required from Phase 4, and is deferred until then", async () => {
  const { LINEAGE_SPECS, CURRENT_PHASE, sweepLineageOrphans } = await lineage();
  assert.equal(LINEAGE_SPECS.auctionVehicle.requiredFromPhase, 4);
  assert.ok(CURRENT_PHASE < 4, "bumping CURRENT_PHASE also activates deposit and auction — that is control/L3-01, the owner's");
  db.auctionVehicles.set("av1", { id: "av1", vehicleRequestId: null, auctionId: "a1", candidateStatus: "ACTIVE" });
  const report = await sweepLineageOrphans({ only: ["auctionVehicle"] });
  assert.ok(report.skipped.includes("auctionVehicle"));
  assert.equal(db.queue.size, 0);
});
