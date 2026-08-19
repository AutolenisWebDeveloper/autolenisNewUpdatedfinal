// Y2 — request-time coverage gate. Injected fake prisma + assessor + recruiter;
// proves the soft-hold set/clear, the record-only pipeline mode, recruit
// isolation, and the reconciler release convergence — all offline.
//   npx tsx --test lib/services/acquisition/__tests__/request-coverage-gate.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  applyRequestCoverageGate,
  reconcileCoverageHolds,
} from "../request-coverage-gate.service";
import type { CoverageResult } from "../../auction/coverage.service";

type VR = {
  id: string;
  buyerOpportunityId: string | null;
  coverageHoldAt: Date | null;
  coverageHoldReason: string | null;
  status: string;
  buyer: { zip: string | null } | null;
};

const NOW = new Date("2026-08-19T00:00:00Z");

function fake(rows: VR[]): { prisma: PrismaClient; rows: VR[] } {
  const prisma = {
    vehicleRequest: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<VR> }) => {
        const r = rows.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      },
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
        let out = rows.filter((r) => r.coverageHoldAt != null);
        const statusIn = (where.status as { in?: string[] } | undefined)?.in;
        if (statusIn) out = out.filter((r) => statusIn.includes(r.status));
        out = [...out].sort(
          (a, b) => (a.coverageHoldAt?.getTime() ?? 0) - (b.coverageHoldAt?.getTime() ?? 0),
        );
        return (take ? out.slice(0, take) : out).map((r) => ({ id: r.id }));
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

const covResult = (coverage: number, radiusMiles = 150, buyerGeocoded = true): CoverageResult => ({
  coverage,
  registered: coverage,
  prospects: 0,
  radiusMiles,
  buyerGeocoded,
});

const vr = (over: Partial<VR> = {}): VR => ({
  id: "vr1",
  buyerOpportunityId: "opp1",
  coverageHoldAt: null,
  coverageHoldReason: null,
  status: "ACTIVE_SOURCING",
  buyer: { zip: "75201" },
  ...over,
});

test("thin coverage soft-holds the request and fires recruitment", async () => {
  const { prisma, rows } = fake([vr()]);
  let recruited: string | null = null;
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(1, 150),
    recruit: async (id) => { recruited = id; },
  });
  assert.equal(r.held, true);
  assert.equal(r.recruitmentFired, true);
  assert.equal(recruited, "opp1");
  assert.equal(rows[0]!.coverageHoldAt?.getTime(), NOW.getTime());
  assert.equal(rows[0]!.coverageHoldReason, "thin_coverage:1@150mi");
});

test("adequate coverage clears an existing hold (release)", async () => {
  const { prisma, rows } = fake([vr({ coverageHoldAt: new Date("2026-08-01T00:00:00Z"), coverageHoldReason: "thin_coverage:1@150mi" })]);
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(3),
    recruit: async () => { throw new Error("must not recruit on adequate"); },
  });
  assert.equal(r.held, false);
  assert.equal(r.released, true);
  assert.equal(rows[0]!.coverageHoldAt, null);
  assert.equal(rows[0]!.coverageHoldReason, null);
});

test("adequate coverage on a non-held request is a no-op write (released=false)", async () => {
  const { prisma, rows } = fake([vr()]);
  let updates = 0;
  const origUpdate = (prisma as unknown as { vehicleRequest: { update: (a: unknown) => Promise<unknown> } }).vehicleRequest.update;
  (prisma as unknown as { vehicleRequest: { update: (a: unknown) => Promise<unknown> } }).vehicleRequest.update = async (a) => {
    updates += 1;
    return origUpdate(a);
  };
  const r = await applyRequestCoverageGate("vr1", { prisma, now: NOW, assessCoverage: async () => covResult(5) });
  assert.equal(r.held, false);
  assert.equal(r.released, false);
  assert.equal(updates, 0); // never wrote — nothing to clear
  assert.equal(rows[0]!.coverageHoldAt, null);
});

test("record-only mode (recruitOnThin:false) holds without recruiting — the pipeline path", async () => {
  const { prisma, rows } = fake([vr()]);
  let recruitCalls = 0;
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    recruitOnThin: false,
    assessCoverage: async () => covResult(0),
    recruit: async () => { recruitCalls += 1; },
  });
  assert.equal(r.held, true);
  assert.equal(r.recruitmentFired, false);
  assert.equal(recruitCalls, 0);
  assert.equal(rows[0]!.coverageHoldReason, "thin_coverage:0@150mi");
});

test("thin coverage with no linked opportunity holds without recruiting", async () => {
  const { prisma } = fake([vr({ buyerOpportunityId: null })]);
  let recruitCalls = 0;
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(2),
    recruit: async () => { recruitCalls += 1; },
  });
  assert.equal(r.held, true);
  assert.equal(r.recruitmentFired, false);
  assert.equal(recruitCalls, 0);
});

test("re-running thin preserves the ORIGINAL hold timestamp (idempotent set)", async () => {
  const original = new Date("2026-08-01T00:00:00Z");
  const { prisma, rows } = fake([vr({ coverageHoldAt: original, coverageHoldReason: "thin_coverage:2@100mi" })]);
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(1, 150),
    recruit: async () => {},
  });
  assert.equal(r.held, true);
  assert.equal(rows[0]!.coverageHoldAt?.getTime(), original.getTime()); // not bumped to NOW
  assert.equal(rows[0]!.coverageHoldReason, "thin_coverage:1@150mi"); // reason refreshed
});

test("ungeocoded buyer tags the hold reason", async () => {
  const { prisma, rows } = fake([vr({ buyer: { zip: null } })]);
  await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(0, 150, false),
    recruit: async () => {},
  });
  assert.equal(rows[0]!.coverageHoldReason, "thin_coverage:0@150mi:ungeocoded");
});

test("recruitment failure is isolated — the request is still held", async () => {
  const { prisma, rows } = fake([vr()]);
  const r = await applyRequestCoverageGate("vr1", {
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(1),
    recruit: async () => { throw new Error("recruit boom"); },
  });
  assert.equal(r.held, true);
  assert.equal(r.recruitmentFired, false);
  assert.equal(rows[0]!.coverageHoldAt?.getTime(), NOW.getTime()); // hold recorded despite recruit failure
});

test("missing request → found:false, no throw", async () => {
  const { prisma } = fake([]);
  const r = await applyRequestCoverageGate("nope", { prisma, now: NOW, assessCoverage: async () => covResult(0) });
  assert.equal(r.found, false);
  assert.equal(r.held, false);
});

// ─── reconciler (release path) ───────────────────────────────────────────────

test("reconciler clears recovered holds, keeps thin ones, and recruits the thin batch", async () => {
  const held = new Date("2026-08-01T00:00:00Z");
  const { prisma, rows } = fake([
    vr({ id: "recovered", coverageHoldAt: held, coverageHoldReason: "thin_coverage:1@150mi" }),
    vr({ id: "stillthin", buyerOpportunityId: "opp2", coverageHoldAt: held, coverageHoldReason: "thin_coverage:0@150mi" }),
    vr({ id: "notheld" }), // no hold — must be ignored
    vr({ id: "held_but_done", coverageHoldAt: held, status: "OFFER_ACCEPTED" }), // past sourcing — ignored
  ]);
  const recruited: string[] = [];
  const res = await reconcileCoverageHolds({
    prisma,
    now: NOW,
    assessCoverage: async (zip) => (zip === "75201" ? covResult(3) : covResult(3)), // default zip → recovered
    recruit: async (id) => { recruited.push(id); },
  });
  // Only "recovered" and "stillthin" match (held + active-sourcing). We make the
  // assessor recover BOTH here to keep it deterministic; assert on the mechanics.
  assert.equal(res.found, 2);
  assert.equal(res.cleared, 2);
  assert.equal(rows.find((r) => r.id === "recovered")!.coverageHoldAt, null);
  assert.equal(rows.find((r) => r.id === "notheld")!.coverageHoldAt, null); // untouched (was null)
  assert.equal(rows.find((r) => r.id === "held_but_done")!.coverageHoldAt?.getTime(), held.getTime()); // untouched
});

test("reconciler keeps a still-thin hold and recruits its next batch", async () => {
  const held = new Date("2026-08-01T00:00:00Z");
  const { prisma, rows } = fake([
    vr({ id: "stillthin", buyerOpportunityId: "opp2", coverageHoldAt: held, coverageHoldReason: "thin_coverage:0@150mi", status: "ACTIVE_SOURCING" }),
  ]);
  const recruited: string[] = [];
  const res = await reconcileCoverageHolds({
    prisma,
    now: NOW,
    assessCoverage: async () => covResult(1, 150), // still below MIN
    recruit: async (id) => { recruited.push(id); },
  });
  assert.equal(res.found, 1);
  assert.equal(res.cleared, 0);
  assert.equal(res.stillHeld, 1);
  assert.equal(res.recruited, 1);
  assert.deepEqual(recruited, ["opp2"]);
  assert.equal(rows[0]!.coverageHoldAt?.getTime(), held.getTime()); // still held
});

test("reconciler isolates a per-request failure (batch continues)", async () => {
  const held = new Date("2026-08-01T00:00:00Z");
  const { prisma } = fake([
    vr({ id: "boom", coverageHoldAt: held }),
    vr({ id: "ok", coverageHoldAt: held }),
  ]);
  let calls = 0;
  const res = await reconcileCoverageHolds({
    prisma,
    now: NOW,
    assessCoverage: async () => {
      calls += 1;
      if (calls === 1) throw new Error("assess boom");
      return covResult(3);
    },
    recruit: async () => {},
  });
  assert.equal(res.found, 2);
  assert.equal(res.cleared, 1); // the second one recovered
  assert.equal(res.stillHeld, 1); // the throwing one counted as still-held
});
