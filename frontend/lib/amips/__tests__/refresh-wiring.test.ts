// Behavioural coverage for the AMIPS refresh service, against a Prisma fake.
//
// The two behaviours worth a database fake, because neither is visible in the
// pure planner:
//
//   1. Sources are refreshed BEFORE candidates are read, and a source failure
//      aborts the requeue. Re-opening pages against data that did not get newer
//      regenerates them into UNDER_REVIEW on Gate 5 — worse than leaving them
//      demoted, and it spends the LLM budget doing it.
//   2. The service re-opens the page's OWN queue row and never writes an as-of
//      date. Back-dating freshness onto an unchanged body is the failure mode
//      this whole design exists to avoid.
//
// Run: pnpm test:amips

import test, { mock, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

const NOW = new Date("2026-08-31T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

type PageRow = {
  id: string;
  slug: string;
  contentTier: string;
  make: string | null;
  model: string | null;
  metro: string | null;
  publishedAt: Date | null;
};

const state = {
  pages: [] as PageRow[],
  queueRows: [] as Array<{ id: string; contentPageId: string | null; priorityScore: number; status: string; failureReason: string | null }>,
  markets: [] as Array<{ metroName: string; lastUpdated: Date }>,
  scores: [] as Array<{ make: string; model: string; metro: string; computedAt: Date }>,
  vehicles: [] as Array<{ make: string; model: string; lastUpdated: Date }>,
  autolenis: [] as Array<{ metro: string; vehicleMake: string; vehicleModel: string; lastUpdated: Date }>,
  searchRows: [] as Array<{ url: string; weekOf: Date; searchImpressions: number; clicks: number; leadsGenerated: number }>,
  /** Every contentQueue.updateMany the service issued. */
  queueUpdates: [] as Array<{ ids: string[]; data: Record<string, unknown> }>,
  /** Every amipsPage write — must stay EMPTY; the service must never write a page. */
  pageWrites: [] as unknown[],
  syncCalls: 0,
  scoreCalls: 0,
  callOrder: [] as string[],
  syncThrows: null as Error | null,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      amipsPage: {
        findMany: async () => {
          state.callOrder.push("readPages");
          return state.pages;
        },
        update: async (a: unknown) => { state.pageWrites.push(a); return {}; },
        updateMany: async (a: unknown) => { state.pageWrites.push(a); return { count: 0 }; },
      },
      contentQueue: {
        findMany: async () => state.queueRows,
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
          state.queueUpdates.push({ ids: where.id.in, data });
          return { count: where.id.in.length };
        },
      },
      marketIntelligence: { findMany: async () => state.markets },
      amipsMarketScore: { findMany: async () => state.scores },
      vehicleIntelligence: { findMany: async () => state.vehicles },
      autolenisIntelligence: { findMany: async () => state.autolenis },
      searchIntelligence: { findMany: async () => state.searchRows },
    },
  },
});

mock.module("@/lib/amips/pipelines/market-intelligence.pipeline", {
  namedExports: {
    syncMarketIntelligence: async () => {
      state.syncCalls += 1;
      state.callOrder.push("syncMarket");
      if (state.syncThrows) throw state.syncThrows;
      return { metros: 25, scored: 25 };
    },
  },
});

mock.module("@/lib/amips/pipelines/market-score-batch.pipeline", {
  namedExports: {
    computeMarketScoreBatch: async () => {
      state.scoreCalls += 1;
      state.callOrder.push("computeScores");
      return { combinations: 100, computed: 90, skipped: 10 };
    },
  },
});

const SERVICE = "@/lib/amips/refresh.service";

/** One Tier C page whose sources are all fresh and which has traffic. */
function seedHealthy() {
  state.pages = [{
    id: "p1", slug: "honda-accord-austin", contentTier: "C",
    make: "Honda", model: "Accord", metro: "Austin", publishedAt: daysAgo(200),
  }];
  state.queueRows = [{ id: "q1", contentPageId: "p1", priorityScore: 50, status: "complete", failureReason: null }];
  state.markets = [{ metroName: "Austin", lastUpdated: daysAgo(1) }];
  state.scores = [{ make: "Honda", model: "Accord", metro: "Austin", computedAt: daysAgo(1) }];
  state.vehicles = [{ make: "Honda", model: "Accord", lastUpdated: daysAgo(1) }];
  state.searchRows = [{
    url: "https://autolenis.com/intelligence/honda-accord-austin",
    weekOf: daysAgo(10), searchImpressions: 400, clicks: 12, leadsGenerated: 0,
  }];
}

beforeEach(() => {
  state.pages = []; state.queueRows = []; state.markets = []; state.scores = [];
  state.vehicles = []; state.autolenis = []; state.searchRows = [];
  state.queueUpdates = []; state.pageWrites = [];
  state.syncCalls = 0; state.scoreCalls = 0; state.callOrder = []; state.syncThrows = null;
});

describe("the source refresh runs, and runs first", () => {
  test("both pipelines fire, market intelligence before scores", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    const r = await runAmipsRefresh(NOW);
    assert.equal(state.syncCalls, 1);
    assert.equal(state.scoreCalls, 1);
    // Scores read the rows the market sync writes; running them together would
    // score half the metros against the previous snapshot.
    assert.ok(
      state.callOrder.indexOf("syncMarket") < state.callOrder.indexOf("computeScores"),
      state.callOrder.join(","),
    );
    assert.ok(state.callOrder.indexOf("computeScores") < state.callOrder.indexOf("readPages"));
    assert.deepEqual(r.sources, { metros: 25, scored: 25, combinations: 100, computed: 90 });
  });

  test("a source failure ABORTS the requeue rather than requeueing on stale data", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.syncThrows = new Error("census api down");
    const r = await runAmipsRefresh(NOW);
    assert.match(r.sourceRefreshError ?? "", /census api down/);
    assert.equal(r.requeued, 0);
    assert.equal(state.queueUpdates.length, 0, "nothing may be re-opened on unrefreshed data");
    assert.equal(state.callOrder.includes("readPages"), false, "it must not even look at pages");
  });

  test("a source failure does not throw — the diagnosis survives in the result JSONB", async () => {
    // failCronRun REPLACES result with { build }, so throwing would discard this.
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.syncThrows = new Error("boom");
    await assert.doesNotReject(() => runAmipsRefresh(NOW));
  });
});

describe("re-opening pages", () => {
  test("re-opens the page's OWN queue row, back to pending", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 1);
    assert.deepEqual(state.queueUpdates.length, 1);
    assert.deepEqual(state.queueUpdates[0].ids, ["q1"]);
    assert.equal(state.queueUpdates[0].data.status, "pending");
    // A stale "duplicate entity" from an earlier attempt must not outlive it.
    assert.equal(state.queueUpdates[0].data.failureReason, null);
  });

  test("NEVER writes an as-of date onto a page — regeneration does that", async () => {
    // The core honesty rule: a newer marketDataAsOf on an unrewritten body is a
    // freshness claim the page cannot support.
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    await runAmipsRefresh(NOW);
    assert.deepEqual(state.pageWrites, [], "the service must not write amips_pages at all");
  });

  test("a page with no linked queue row is reported, never guessed at", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.queueRows = []; // link lost
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 0);
    assert.equal(r.skipped.no_queue_item, 1);
    assert.equal(state.queueUpdates.length, 0);
  });

  test("a page the entity guard already refused is left alone, and its verdict is preserved", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.queueRows[0].status = "failed";
    state.queueRows[0].failureReason = "Duplicate entity: other-slug already covers Honda Accord in Austin";
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 0);
    assert.equal(r.skipped.duplicate_entity, 1);
    // Critically: no updateMany, so failureReason is NOT cleared. Clearing it
    // would erase the verdict and re-open the page again tomorrow, forever.
    assert.equal(state.queueUpdates.length, 0);
  });

  test("a page whose sources are STILL stale is left demoted", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.markets = [{ metroName: "Austin", lastUpdated: daysAgo(60) }]; // > 30d
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 0);
    assert.equal(r.skipped.still_stale, 1);
  });

  test("an unread page is not regenerated just because its data got fresh", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.searchRows = []; // no impressions in 180d
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 0);
    assert.equal(r.skipped.no_impressions, 1);
  });

  test("an empty backlog does no work and reports cleanly", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    state.pages = [];
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.candidates, 0);
    assert.equal(r.requeued, 0);
    assert.equal(state.queueUpdates.length, 0);
    assert.equal(state.syncCalls, 1, "sources still refresh — that is half the job");
  });
});

describe("Tier F keeps the fallback the assembler applies", () => {
  test("a Tier F page with no market rows is eligible on its transaction record", async () => {
    const { runAmipsRefresh } = await import(SERVICE);
    seedHealthy();
    state.pages[0].contentTier = "F";
    state.markets = [];
    state.scores = [];
    state.autolenis = [{
      metro: "Austin", vehicleMake: "Honda", vehicleModel: "Accord", lastUpdated: daysAgo(1),
    }];
    const r = await runAmipsRefresh(NOW);
    assert.equal(r.requeued, 1, "Tier F qualifies on transactions; its market rows are optional");
  });
});
