// The refresh planner: which REFRESH_REQUIRED pages are worth regenerating.
//
// The rule this suite exists to protect is that refreshing is REGENERATION, not
// a timestamp bump. Every skip reason below is a case where re-opening the page
// would either publish numbers the body does not contain, mint a duplicate page,
// or spend LLM budget the next lifecycle run would immediately undo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planPageRefresh,
  planRefreshBatch,
  REFRESH_REQUEUE_BUDGET,
  type RefreshCandidate,
} from "../refresh";

const NOW = new Date("2026-08-31T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY);

// Tier C requires market data (MARKET_DATA_TIERS); thresholds are vehicle 180d,
// dealer 90d, market 30d.
function candidate(over: Partial<RefreshCandidate> = {}): RefreshCandidate {
  return {
    id: "p1",
    slug: "honda-accord-austin",
    contentTier: "C",
    publishedAt: daysAgo(200),
    projectedVehicleDataAsOf: daysAgo(2),
    projectedDealerDataAsOf: daysAgo(2),
    projectedMarketDataAsOf: daysAgo(2),
    queueItemId: "q1",
    priorityScore: 10,
    blockedAsDuplicate: false,
    ...over,
  };
}

describe("a page whose data the refresh actually fixed", () => {
  test("is re-opened for regeneration, carrying its own queue item", () => {
    const d = planPageRefresh(candidate(), { now: NOW, impressions180: 500 });
    assert.deepEqual(d, { action: "requeue", queueItemId: "q1" });
  });

  test("the queue item is the page's OWN row — the only thing that reproduces its slug", () => {
    const d = planPageRefresh(candidate({ queueItemId: "q-specific" }), {
      now: NOW,
      impressions180: 1,
    });
    assert.equal(d.action === "requeue" && d.queueItemId, "q-specific");
  });
});

describe("pages the refresh must NOT re-open", () => {
  test("still stale after the source refresh — regenerating would fail Gate 5", () => {
    // The SOURCE row for this metro is older than the 30-day market threshold:
    // the refresh did not cover it, so a regeneration would score 4 and land in
    // UNDER_REVIEW — strictly worse than the REFRESH_REQUIRED it sits in.
    const d = planPageRefresh(candidate({ projectedMarketDataAsOf: daysAgo(45) }), {
      now: NOW,
      impressions180: 500,
    });
    assert.deepEqual(d, { action: "skip", reason: "still_stale" });
  });

  test("demoted for no impressions, not staleness — fresh data does not fix unread", () => {
    const d = planPageRefresh(candidate(), { now: NOW, impressions180: 0 });
    assert.deepEqual(d, { action: "skip", reason: "no_impressions" });
  });

  test("no queue item — its keywordTarget is unrecoverable, so regenerating would DUPLICATE", () => {
    // slug = slugify(keywordTarget). Without the original keyword a regeneration
    // mints a second page at a different slug instead of refreshing this one.
    const d = planPageRefresh(candidate({ queueItemId: null }), {
      now: NOW,
      impressions180: 500,
    });
    assert.deepEqual(d, { action: "skip", reason: "no_queue_item" });
  });

  test("a page the entity guard already refused is not re-opened to fail again", () => {
    // Production carries duplicate clusters. Re-opening one nightly would fail
    // the same guard every time, and clearing its failureReason would erase the
    // verdict that says so — a permanent loop. Repair owns clusters, not refresh.
    const d = planPageRefresh(candidate({ blockedAsDuplicate: true }), {
      now: NOW,
      impressions180: 500,
    });
    assert.deepEqual(d, { action: "skip", reason: "duplicate_entity" });
  });

  test("staleness is judged BEFORE impressions — the two reasons are distinguishable", () => {
    // A page that is both stale and unread reports still_stale, because that is
    // the condition this cron owns; conflating them would hide missing source data.
    const d = planPageRefresh(candidate({ projectedMarketDataAsOf: daysAgo(45) }), {
      now: NOW,
      impressions180: 0,
    });
    assert.equal(d.action === "skip" && d.reason, "still_stale");
  });

  test("a never-published page is not treated as unread", () => {
    // pubAge null means it never had the chance to earn an impression.
    const d = planPageRefresh(candidate({ publishedAt: null }), {
      now: NOW,
      impressions180: 0,
    });
    assert.equal(d.action, "requeue");
  });
});

describe("the regeneration budget", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      candidate({ id: `p${i}`, slug: `s${i}`, queueItemId: `q${i}` }),
    );
  const seen = (slugs: string[], v: number) => new Map(slugs.map((s) => [s, v]));

  test("caps how many pages one run re-opens", () => {
    const pages = many(40);
    const plan = planRefreshBatch(pages, {
      now: NOW,
      impressions180: seen(pages.map((p) => p.slug), 500),
    });
    const requeued = plan.filter((r) => r.disposition.action === "requeue");
    assert.equal(requeued.length, REFRESH_REQUEUE_BUDGET);
  });

  test("the overflow is reported as over_budget, not silently dropped", () => {
    const pages = many(20);
    const plan = planRefreshBatch(pages, {
      now: NOW,
      impressions180: seen(pages.map((p) => p.slug), 500),
    });
    const over = plan.filter(
      (r) => r.disposition.action === "skip" && r.disposition.reason === "over_budget",
    );
    assert.equal(over.length, 20 - REFRESH_REQUEUE_BUDGET);
    assert.equal(plan.length, 20, "every page is accounted for");
  });

  test("budget is spent in the caller's order — best pages first", () => {
    const pages = many(20);
    const plan = planRefreshBatch(pages, {
      now: NOW,
      impressions180: seen(pages.map((p) => p.slug), 500),
      budget: 3,
    });
    const requeued = plan
      .filter((r) => r.disposition.action === "requeue")
      .map((r) => r.page.slug);
    assert.deepEqual(requeued, ["s0", "s1", "s2"]);
  });

  test("a SKIPPED page costs no budget — one unusable page never displaces a good one", () => {
    // Two unusable pages first; the budget must still reach three real ones.
    const pages = [
      candidate({ slug: "stale", projectedMarketDataAsOf: daysAgo(45) }),
      candidate({ slug: "orphan", queueItemId: null }),
      ...many(3),
    ];
    const plan = planRefreshBatch(pages, {
      now: NOW,
      impressions180: seen(pages.map((p) => p.slug), 500),
      budget: 3,
    });
    const requeued = plan
      .filter((r) => r.disposition.action === "requeue")
      .map((r) => r.page.slug);
    assert.deepEqual(requeued, ["s0", "s1", "s2"]);
  });

  test("an empty backlog plans nothing and does not throw", () => {
    assert.deepEqual(planRefreshBatch([], { now: NOW, impressions180: new Map() }), []);
  });
});

// The bug this pins: eligibility MUST be judged on the source rows a
// regeneration is about to read, never on the page's own stored as-of dates.
// A page's columns do not change until it is regenerated, so an implementation
// that consulted them would find every page still stale immediately after a
// successful source refresh — the cron would run daily, report work, and
// requeue nothing, forever.
describe("eligibility reads the projected source dates, not the page's own", () => {
  test("a page with ANCIENT stored dates is still eligible when the sources are fresh", () => {
    const page: RefreshCandidate = {
      id: "p1",
      slug: "honda-accord-austin",
      contentTier: "C",
      publishedAt: daysAgo(200),
      // What a regeneration would write: fresh, because the refresh just ran.
      projectedVehicleDataAsOf: daysAgo(1),
      projectedDealerDataAsOf: daysAgo(1),
      projectedMarketDataAsOf: daysAgo(1),
      queueItemId: "q1",
      priorityScore: 10,
      blockedAsDuplicate: false,
    };
    const d = planPageRefresh(page, { now: NOW, impressions180: 500 });
    assert.equal(
      d.action,
      "requeue",
      "a page demoted for 85-day-old data must become eligible the moment its sources are refreshed",
    );
  });

  test("fresh stored dates do NOT rescue a page whose sources are stale", () => {
    // The mirror case: only the projected dates may decide.
    const page: RefreshCandidate = {
      id: "p2",
      slug: "toyota-camry-dallas",
      contentTier: "C",
      publishedAt: daysAgo(200),
      projectedVehicleDataAsOf: daysAgo(1),
      projectedDealerDataAsOf: daysAgo(1),
      projectedMarketDataAsOf: daysAgo(60), // source never refreshed
      queueItemId: "q2",
      priorityScore: 10,
      blockedAsDuplicate: false,
    };
    const d = planPageRefresh(page, { now: NOW, impressions180: 500 });
    assert.deepEqual(d, { action: "skip", reason: "still_stale" });
  });
});
