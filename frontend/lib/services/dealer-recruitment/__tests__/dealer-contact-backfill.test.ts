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

function fakePrisma(
  rooftops: Rooftop[],
  cycleAttempted: Array<{ rooftopId: string; status: string }> = [],
): { prisma: PrismaClient; calls: { findMany: number } } {
  const calls = { findMany: 0 };
  const prisma = {
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
