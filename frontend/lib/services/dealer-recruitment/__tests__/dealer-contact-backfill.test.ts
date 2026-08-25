// B′ — dealer contact backfill. Off-peak gap-fill of rooftop contacts using the
// leftover ("backfill") Apollo budget. Injected fakes (reveal / remaining / upsert
// / prisma) prove: off = no spend & no query, budget-stop, priority order, honest
// tally on miss / upsert-failure. Runs under base `test` (dealer-recruitment/__tests__).
//   npx tsx --test lib/services/dealer-recruitment/__tests__/dealer-contact-backfill.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  runDealerContactBackfill,
  type BackfillDeps,
} from "../dealer-contact-backfill.service";
import { REVEAL_COST_CREDITS } from "../apollo-reveal.service";

const NOW = new Date("2026-08-10T12:00:00Z");

interface Rooftop {
  id: string;
  displayName: string;
  websiteHost: string | null;
  city: string | null;
  state: string | null;
  makes: string[];
  createdAt: Date;
}

interface PopulationSeed {
  // Registered dealers / prospects with no rooftop yet (Phase 0 resolution inputs).
  dealers?: Array<{ id: string; dealershipName: string }>;
  prospects?: Array<{ id: string; name: string }>;
}

function fakePrisma(
  rooftops: Rooftop[],
  cycleAttempted: Array<{ rooftopId: string; status: string }> = [],
  population: PopulationSeed = {},
): {
  prisma: PrismaClient;
  calls: { findMany: number; dealerFindMany: number; prospectFindMany: number };
} {
  const calls = { findMany: 0, dealerFindMany: 0, prospectFindMany: 0 };
  const prisma = {
    dealer: {
      findMany: async ({ take }: { take?: number } = {}) => {
        calls.dealerFindMany++;
        return (population.dealers ?? [])
          .slice(0, take ?? undefined)
          .map((d) => ({
            id: d.id, dealershipName: d.dealershipName,
            city: null, state: null, zip: null, phone: null, latitude: null, longitude: null,
          }));
      },
    },
    dealerProspect: {
      findMany: async ({ take }: { take?: number } = {}) => {
        calls.prospectFindMany++;
        return (population.prospects ?? [])
          .slice(0, take ?? undefined)
          .map((p) => ({
            id: p.id, name: p.name, website: null,
            city: null, state: null, zip: null, phone: null, latitude: null, longitude: null,
          }));
      },
    },
    dealerRooftop: {
      findMany: async () => {
        calls.findMany++;
        return rooftops.map((r) => ({ ...r }));
      },
    },
    apolloReveal: {
      findMany: async ({ where }: { where: { status: { in: string[] } } }) =>
        cycleAttempted
          .filter((a) => where.status.in.includes(a.status))
          .map((a) => ({ rooftopId: a.rooftopId })),
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

// Phase 0 fakes: a resolveRooftop that links a candidate to a synthetic rooftop id
// (recording call order + kind), and a reconcile that records which prospects it ran for.
function resolveRooftopFake(
  order: Array<{ kind: string; id: string }>,
  failIds: Set<string> = new Set(),
): BackfillDeps["resolveRooftop"] {
  return (async (candidate: { kind: string; id: string }) => {
    order.push({ kind: candidate.kind, id: candidate.id });
    if (failIds.has(candidate.id)) throw new Error(`resolve failed for ${candidate.id}`);
    return `rooftop-of-${candidate.id}`;
  }) as BackfillDeps["resolveRooftop"];
}

function reconcileFake(
  ran: string[],
  nullIds: Set<string> = new Set(),
): BackfillDeps["reconcile"] {
  return (async (prospectId: string) => {
    ran.push(prospectId);
    return nullIds.has(prospectId) ? null : { id: `profile-of-${prospectId}` };
  }) as BackfillDeps["reconcile"];
}

// A reveal fake that returns a verified contact for the given rooftop ids and null
// otherwise, recording call order.
function revealFake(hitIds: Set<string>, order: string[]): BackfillDeps["reveal"] {
  return (async (input: { rooftopId: string }) => {
    order.push(input.rooftopId);
    if (!hitIds.has(input.rooftopId)) return null;
    return { email: `${input.rooftopId}@dealer.test`, status: "VERIFIED" as const, contactName: "Sales Mgr", contactTitle: "Sales Manager" };
  }) as BackfillDeps["reveal"];
}

const rt = (id: string, over: Partial<Rooftop> = {}): Rooftop => ({
  id,
  displayName: `Dealer ${id}`,
  websiteHost: `${id}.example.com`,
  city: "Austin",
  state: "TX",
  makes: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

test("OFF (Apollo disabled) → no query, no spend, no attempts", async () => {
  const { prisma, calls } = fakePrisma([rt("a"), rt("b")]);
  let remainingCalls = 0;
  const r = await runDealerContactBackfill(
    {},
    {
      prisma,
      now: NOW,
      enabled: () => false,
      reveal: revealFake(new Set(), []),
      remaining: (async () => { remainingCalls++; return 9999; }) as BackfillDeps["remaining"],
      upsert: (async () => ({ id: "x" })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.enabled, false);
  assert.equal(r.candidates, 0);
  assert.equal(r.attempted, 0);
  assert.equal(calls.findMany, 0, "must not query candidates when off");
  assert.equal(remainingCalls, 0, "must not check budget when off");
});

test("reveals candidates with budget and persists each hit as VERIFIED apollo_backfill", async () => {
  const { prisma } = fakePrisma([rt("a"), rt("b")]);
  const order: string[] = [];
  const upserts: Array<{ rooftopId: string; input: Record<string, unknown> }> = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["a", "b"]), order),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (rooftopId: string, input: Record<string, unknown>) => {
        upserts.push({ rooftopId, input });
        return { id: rooftopId };
      }) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.enabled, true);
  assert.equal(r.candidates, 2);
  assert.equal(r.attempted, 2);
  assert.equal(r.revealed, 2);
  assert.equal(r.skipped, 0);
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].input.emailVerificationStatus, "VERIFIED");
  assert.equal(upserts[0].input.contactSource, "apollo_backfill");
  assert.equal(upserts[0].input.email, "a@dealer.test");
});

test("priority makes/states are revealed before unprioritized rooftops", async () => {
  // c matches make, b matches state, a matches nothing → order c, b, a.
  const { prisma } = fakePrisma([
    rt("a", { makes: ["ford"], state: "OH" }),
    rt("b", { makes: ["kia"], state: "TX" }),
    rt("c", { makes: ["toyota"], state: "OH" }),
  ]);
  const order: string[] = [];
  await runDealerContactBackfill(
    { priorityMakes: ["Toyota"], priorityStates: ["TX"] },
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["a", "b", "c"]), order),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.deepEqual(order, ["c", "b", "a"]);
});

test("stops the run when backfill budget is exhausted", async () => {
  const { prisma } = fakePrisma([rt("a"), rt("b"), rt("c")]);
  const order: string[] = [];
  let call = 0;
  const r = await runDealerContactBackfill(
    {},
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["a", "b", "c"]), order),
      // budget for exactly one reveal: first check ok, second below cost.
      remaining: (async () => (call++ === 0 ? REVEAL_COST_CREDITS : REVEAL_COST_CREDITS - 1)) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.attempted, 1);
  assert.equal(r.revealed, 1);
  assert.equal(r.stoppedForBudget, true);
  assert.deepEqual(order, ["a"]);
});

test("a reveal miss is counted skipped, no upsert, run continues", async () => {
  const { prisma } = fakePrisma([rt("a"), rt("b")]);
  const order: string[] = [];
  let upsertCalls = 0;
  const r = await runDealerContactBackfill(
    {},
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["b"]), order), // a misses, b hits
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => { upsertCalls++; return { id }; }) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.attempted, 2);
  assert.equal(r.revealed, 1);
  assert.equal(r.skipped, 1);
  assert.equal(upsertCalls, 1);
});

test("limit caps the number of attempts", async () => {
  const { prisma } = fakePrisma([rt("a"), rt("b"), rt("c")]);
  const order: string[] = [];
  const r = await runDealerContactBackfill(
    { limit: 2 },
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["a", "b", "c"]), order),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.attempted, 2);
  assert.equal(order.length, 2);
});

test("rooftops already attempted this cycle (EMPTY/PENDING) are skipped and do not consume the limit", async () => {
  // a=EMPTY this cycle, b=PENDING this cycle, c=fresh. limit 1 must land on c.
  const { prisma } = fakePrisma(
    [rt("a"), rt("b"), rt("c")],
    [
      { rooftopId: "a", status: "EMPTY" },
      { rooftopId: "b", status: "PENDING" },
    ],
  );
  const order: string[] = [];
  const r = await runDealerContactBackfill(
    { limit: 1 },
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["c"]), order),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.candidates, 1, "only c is actionable");
  assert.equal(r.attempted, 1);
  assert.equal(r.revealed, 1);
  assert.deepEqual(order, ["c"], "EMPTY/PENDING rooftops never reached the reveal path");
});

test("a profile upsert failure is counted skipped (honest tally), run continues", async () => {
  const { prisma } = fakePrisma([rt("a"), rt("b")]);
  const order: string[] = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma,
      now: NOW,
      enabled: () => true,
      reveal: revealFake(new Set(["a", "b"]), order),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => {
        if (id === "a") throw new Error("db down");
        return { id };
      }) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.attempted, 2);
  assert.equal(r.revealed, 1);
  assert.equal(r.skipped, 1);
});

// ── Phase 0 — canonical rooftop resolution (the coverage extension) ───────────

test("OFF → Phase 0 never queries the dealer/prospect population either", async () => {
  const { prisma, calls } = fakePrisma(
    [rt("a")],
    [],
    { dealers: [{ id: "d1", dealershipName: "Athelus Motors" }], prospects: [{ id: "p1", name: "Toyota of X" }] },
  );
  const order: Array<{ kind: string; id: string }> = [];
  const ran: string[] = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma, now: NOW, enabled: () => false,
      resolveRooftop: resolveRooftopFake(order),
      reconcile: reconcileFake(ran),
      reveal: revealFake(new Set(), []),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async () => ({ id: "x" })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.enabled, false);
  assert.equal(calls.dealerFindMany, 0, "no dealer scan when off");
  assert.equal(calls.prospectFindMany, 0, "no prospect scan when off");
  assert.equal(order.length, 0, "no rooftop resolution when off");
  assert.equal(ran.length, 0, "no reconcile when off");
});

test("resolves registered dealers and prospects lacking a rooftop, then reconciles prospect contacts", async () => {
  const { prisma } = fakePrisma(
    [], // no rooftops yet — Phase 1 finds no candidates this run
    [],
    {
      dealers: [{ id: "d1", dealershipName: "Athelus Motors LLC" }],
      prospects: [{ id: "p1", name: "Toyota of Frisco" }, { id: "p2", name: "Honda of Plano" }],
    },
  );
  const order: Array<{ kind: string; id: string }> = [];
  const ran: string[] = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma, now: NOW, enabled: () => true,
      resolveRooftop: resolveRooftopFake(order),
      reconcile: reconcileFake(ran),
      reveal: revealFake(new Set(), []),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.dealersResolved, 1);
  assert.equal(r.prospectsResolved, 2);
  assert.equal(r.contactsReconciled, 2, "each resolved prospect's existing contact is reconciled into the profile");
  assert.equal(r.resolveFailed, 0);
  // Dealers are resolved BEFORE prospects so a registered dealer anchors the
  // canonical rooftop and its prospect twin dedups onto it (never a duplicate).
  assert.deepEqual(order, [
    { kind: "dealer", id: "d1" },
    { kind: "prospect", id: "p1" },
    { kind: "prospect", id: "p2" },
  ]);
  assert.deepEqual(ran, ["p1", "p2"]);
});

test("registered dealers are resolved but never reconciled (reconcile is prospect-only)", async () => {
  const { prisma } = fakePrisma([], [], {
    dealers: [{ id: "d1", dealershipName: "Athelus Motors LLC" }],
  });
  const order: Array<{ kind: string; id: string }> = [];
  const ran: string[] = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma, now: NOW, enabled: () => true,
      resolveRooftop: resolveRooftopFake(order),
      reconcile: reconcileFake(ran),
      reveal: revealFake(new Set(), []),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.dealersResolved, 1);
  assert.equal(r.prospectsResolved, 0);
  assert.equal(ran.length, 0, "no prospect → nothing to reconcile");
});

test("resolveLimit bounds total per-run resolution work (dealers first)", async () => {
  const { prisma } = fakePrisma([], [], {
    dealers: [{ id: "d1", dealershipName: "A" }],
    prospects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }, { id: "p3", name: "P3" }],
  });
  const order: Array<{ kind: string; id: string }> = [];
  const ran: string[] = [];
  const r = await runDealerContactBackfill(
    { resolveLimit: 2 }, // 1 dealer + 1 prospect, then stop
    {
      prisma, now: NOW, enabled: () => true,
      resolveRooftop: resolveRooftopFake(order),
      reconcile: reconcileFake(ran),
      reveal: revealFake(new Set(), []),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.dealersResolved, 1);
  assert.equal(r.prospectsResolved, 1);
  assert.deepEqual(order, [{ kind: "dealer", id: "d1" }, { kind: "prospect", id: "p1" }]);
});

test("a resolution failure is fail-open (counted, run continues to the reveal phase)", async () => {
  // p1 resolution throws; p2 resolves; then Phase 1 reveals the pre-existing rooftop 'a'.
  const { prisma } = fakePrisma([rt("a")], [], {
    prospects: [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }],
  });
  const order: Array<{ kind: string; id: string }> = [];
  const ran: string[] = [];
  const revealOrder: string[] = [];
  const r = await runDealerContactBackfill(
    {},
    {
      prisma, now: NOW, enabled: () => true,
      resolveRooftop: resolveRooftopFake(order, new Set(["p1"])),
      reconcile: reconcileFake(ran),
      reveal: revealFake(new Set(["a"]), revealOrder),
      remaining: (async () => 9999) as BackfillDeps["remaining"],
      upsert: (async (id: string) => ({ id })) as BackfillDeps["upsert"],
    },
  );
  assert.equal(r.resolveFailed, 1, "p1 failure is counted");
  assert.equal(r.prospectsResolved, 1, "p2 still resolves");
  assert.deepEqual(ran, ["p2"], "failed prospect is not reconciled");
  assert.equal(r.revealed, 1, "Phase 1 still runs after Phase 0 failures");
  assert.deepEqual(revealOrder, ["a"]);
});
