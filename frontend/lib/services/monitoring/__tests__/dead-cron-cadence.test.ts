// Cadence-aware failing-cron detection.
//
// THE DEFECT
// detectFailedCrons demanded FAILED_CRON_STREAK_THRESHOLD (2) consecutive failed
// runs inside FAILED_CRON_LOOKBACK_MINUTES (180). 34 of the 67 scheduled crons
// have a worst-case inter-run gap larger than that window, so at most one of
// their runs was ever in scope and the streak could never reach 2. Every daily
// and weekly job in the fleet was structurally unalertable.
//
// Owner-verified proof case: `social-market-index` (weekly, 0 12 * * 1) has
// 2 recorded runs and 2 failures — 100% — and never produced a signal.
//
// THE RULE
// The threshold-of-2 exists to avoid paging on a blip "the next scheduled run
// clears". That is a TIME argument, not a count argument. Demand a second
// failure only when the second run lands inside the base window; otherwise one
// failure already means a full cadence of downtime.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  failedStreakThresholdFor,
  failedLookbackMinutesFor,
  FAILED_CRON_STREAK_THRESHOLD,
  FAILED_CRON_LOOKBACK_MINUTES,
} from "@/lib/services/monitoring/dead-cron.service";
import { CRON_STALENESS } from "@/lib/services/monitoring/cron-schedule";

describe("threshold follows cadence", () => {
  test("the weekly cron that never alerted now alerts on one failure", () => {
    // The whole point of this change. Pre-fix this required 2 failures inside
    // 180 minutes, which a weekly cron cannot produce.
    assert.equal(failedStreakThresholdFor("social-market-index"), 1);
  });

  test("daily jobs alert on one failure", () => {
    for (const name of ["prequal-sla-escalation", "prequal-purge", "amips-snapshot"]) {
      assert.equal(failedStreakThresholdFor(name), 1, name);
    }
  });

  test("fast crons keep today's behaviour exactly", () => {
    // No change for the 33 crons the detector already served — this fix must not
    // start paging on single transient failures for a 5-minute reconciler.
    for (const name of ["esign-artifact-reconcile", "health-check", "auction-close"]) {
      assert.equal(failedStreakThresholdFor(name), FAILED_CRON_STREAK_THRESHOLD, name);
    }
  });

  test("the boundary is the base lookback itself", () => {
    // A cron whose next run lands exactly at the window edge still gets a second
    // chance; one minute slower does not.
    for (const [name, entry] of Object.entries(CRON_STALENESS)) {
      const expected = entry.intervalMinutes <= FAILED_CRON_LOOKBACK_MINUTES ? 2 : 1;
      assert.equal(failedStreakThresholdFor(name), expected, `${name} @ ${entry.intervalMinutes}m`);
    }
  });

  test("an unregistered cron keeps the conservative default", () => {
    // A de-scheduled name still present in cron_job_logs must not start paging
    // on a single failure just because we cannot look up its cadence.
    assert.equal(failedStreakThresholdFor("cron-that-does-not-exist"), FAILED_CRON_STREAK_THRESHOLD);
  });
});

describe("lookback follows cadence", () => {
  test("fast crons keep the base window", () => {
    assert.equal(failedLookbackMinutesFor("health-check"), FAILED_CRON_LOOKBACK_MINUTES);
  });

  test("slow crons get two cadences of history", () => {
    const weekly = CRON_STALENESS["social-market-index"].intervalMinutes;
    assert.equal(failedLookbackMinutesFor("social-market-index"), weekly * 2);
    const daily = CRON_STALENESS["prequal-purge"].intervalMinutes;
    assert.equal(failedLookbackMinutesFor("prequal-purge"), daily * 2);
  });

  test("the window always holds at least the runs the threshold needs", () => {
    for (const [name, entry] of Object.entries(CRON_STALENESS)) {
      const runsInWindow = Math.floor(failedLookbackMinutesFor(name) / entry.intervalMinutes);
      assert.ok(
        runsInWindow >= failedStreakThresholdFor(name),
        `${name}: window holds ${runsInWindow} run(s) but needs ${failedStreakThresholdFor(name)}`,
      );
    }
  });

  test("it never reaches back so far that a recovered failure resurfaces", () => {
    // Two cadences, not ten: beyond that a cron is OVERDUE, which dead-cron
    // detection owns, not failing.
    for (const [name, entry] of Object.entries(CRON_STALENESS)) {
      assert.ok(
        failedLookbackMinutesFor(name) <= Math.max(FAILED_CRON_LOOKBACK_MINUTES, entry.intervalMinutes * 2),
        name,
      );
    }
  });

  test("an unregistered cron keeps the base window", () => {
    assert.equal(failedLookbackMinutesFor("cron-that-does-not-exist"), FAILED_CRON_LOOKBACK_MINUTES);
  });
});

describe("fleet coverage — the gap this closes", () => {
  test("every registered cron is now detectable", () => {
    // Pre-fix, a cron was detectable only if 2 runs fit in 180 minutes.
    const undetectable = Object.entries(CRON_STALENESS).filter(([name, entry]) => {
      const runsInWindow = Math.floor(failedLookbackMinutesFor(name) / entry.intervalMinutes);
      return runsInWindow < failedStreakThresholdFor(name);
    });
    assert.deepEqual(undetectable.map(([n]) => n), []);
  });

  // COUNTS RELAXED TO A FLOOR, DELIBERATELY. These were pinned at exactly 34 and
  // 33 — the fleet's size when the cadence fix landed. That made every future
  // cron addition fail a test about threshold behaviour, which is a trap rather
  // than a signal: adding `amips-refresh` (daily, so it joins the slow set) broke
  // it for a reason that has nothing to do with what the test is checking.
  //
  // What is actually load-bearing is asserted below and is UNCHANGED: every slow
  // cron alerts on one failure, every fast cron still needs two, and the two sets
  // partition the registry so nothing escapes classification. The historical
  // scale survives as a floor — 34 crons were structurally unalertable — which
  // still fails loudly if a lookback change reclassifies the fleet wholesale.
  const PRE_FIX_BLIND_FLOOR = 34;

  test("the pre-fix blind set — 34+ crons — now alerts on a single failure", () => {
    const wouldHaveBeenBlind = Object.entries(CRON_STALENESS).filter(
      ([, e]) => e.intervalMinutes > FAILED_CRON_LOOKBACK_MINUTES,
    );
    // Originally 18 daily + 10 weekly + 5 six-hourly + 1 four-hourly, per vercel.json.
    assert.ok(
      wouldHaveBeenBlind.length >= PRE_FIX_BLIND_FLOOR,
      `slow set shrank to ${wouldHaveBeenBlind.length}; the lookback may have been widened`,
    );
    for (const [name] of wouldHaveBeenBlind) {
      assert.equal(failedStreakThresholdFor(name), 1, `${name} must now alert on one failure`);
    }
  });

  test("the fast set is untouched — still two failures before it alerts", () => {
    const fast = Object.entries(CRON_STALENESS).filter(
      ([, e]) => e.intervalMinutes <= FAILED_CRON_LOOKBACK_MINUTES,
    );
    assert.ok(fast.length > 0, "the fast set must not be empty");
    for (const [name] of fast) {
      assert.equal(failedStreakThresholdFor(name), FAILED_CRON_STREAK_THRESHOLD, name);
    }
  });

  test("the two sets partition the registry — no cron escapes classification", () => {
    const all = Object.entries(CRON_STALENESS);
    const slow = all.filter(([, e]) => e.intervalMinutes > FAILED_CRON_LOOKBACK_MINUTES);
    const fast = all.filter(([, e]) => e.intervalMinutes <= FAILED_CRON_LOOKBACK_MINUTES);
    assert.equal(slow.length + fast.length, all.length);
  });
});
