// Wiring for the staleness-runway signal: alert levels, the cron that carries
// it, and the admin surface.
//
// The design decision these pin: the runway does NOT mark the cron run FAILED.
// See lib/amips/staleness-runway.service.ts for the full argument — briefly, it
// would be untrue (the work succeeded), it would destroy the payload
// (failCronRun replaces `result`), and it would not page anyway, because
// detectFailedCrons needs 2 failures inside 180 minutes and a DAILY cron's runs
// are 24h apart.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HealthAlertLevel } from "@prisma/client";
import { runwayAlertLevel, RUNWAY_ALERT_SOURCE } from "@/lib/amips/staleness-runway.service";
import type { StalenessRunway } from "@/lib/amips/staleness-runway";
import {
  FAILED_CRON_STREAK_THRESHOLD,
  FAILED_CRON_LOOKBACK_MINUTES,
  failedStreakThresholdFor,
} from "@/lib/services/monitoring/dead-cron.service";

const runway = (over: Partial<StalenessRunway>): StalenessRunway => ({
  servablePages: 393,
  undatedPages: 0,
  minDaysToWithhold: 95,
  firstWithholdDate: "2026-12-04",
  isSingleDayCliff: true,
  within30: 0,
  within60: 0,
  within90: 0,
  alreadyWithheld: 0,
  severity: "OK",
  ...over,
});

describe("severity maps onto the existing platform alert levels", () => {
  test("OK raises nothing", () => {
    assert.equal(runwayAlertLevel(runway({ severity: "OK" })), null);
  });

  test("NOTICE is INFO, WARN is P2", () => {
    assert.equal(runwayAlertLevel(runway({ severity: "NOTICE", minDaysToWithhold: 90 })), HealthAlertLevel.INFO);
    assert.equal(runwayAlertLevel(runway({ severity: "WARN", minDaysToWithhold: 45 })), HealthAlertLevel.P2);
  });

  test("CRITICAL is P1 while pages still serve", () => {
    // P0 must mean "production is degraded NOW". An impending cliff is urgent
    // but the platform is still serving correctly.
    assert.equal(runwayAlertLevel(runway({ severity: "CRITICAL", minDaysToWithhold: 10 })), HealthAlertLevel.P1);
  });

  test("CRITICAL becomes P0 once pages are actually dark", () => {
    assert.equal(
      runwayAlertLevel(runway({ severity: "CRITICAL", minDaysToWithhold: -1, alreadyWithheld: 393 })),
      HealthAlertLevel.P0,
    );
  });
});

describe("the signal is carried by a DAILY cron, in the existing result JSONB", () => {
  const SNAPSHOT = readFileSync(
    join(process.cwd(), "app/api/cron/amips-snapshot/route.ts"),
    "utf8",
  );
  const VERCEL = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  test("amips-snapshot reports the runway", () => {
    assert.ok(/reportStalenessRunway\(\)/.test(SNAPSHOT));
    assert.ok(/stalenessRunway/.test(SNAPSHOT));
  });

  test("its host cron runs daily, not weekly", () => {
    // A countdown to a single-day cliff needs daily resolution: a weekly job
    // could report "7 days left" and not fire again until after the cliff.
    const cron = VERCEL.crons.find((c) => c.path === "/api/cron/amips-snapshot");
    assert.ok(cron, "amips-snapshot must remain scheduled");
    assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/, "expected a daily schedule");
  });

  test("no new cron was added for this signal", () => {
    // Adding one would be a schedule change, which is out of scope.
    const amips = VERCEL.crons.filter((c) => c.path.includes("amips")).map((c) => c.path);
    assert.ok(!amips.some((p) => /runway|staleness/.test(p)));
  });

  test("it rides in the cron result rather than a new table", () => {
    assert.ok(/withCronRun\("amips-snapshot"/.test(SNAPSHOT));
    const SERVICE = readFileSync(
      join(process.cwd(), "lib/amips/staleness-runway.service.ts"),
      "utf8",
    );
    assert.ok(
      !/prisma\.\w*[Rr]unway\w*\.create/.test(SERVICE),
      "must not introduce a runway table",
    );
  });
});

describe("why the cron is not marked FAILED", () => {
  test("a daily cron DOES now page — the third reason is superseded", () => {
    // This test previously asserted the OPPOSITE: that a daily cron could never
    // form the 2-in-180-minutes streak, so marking the run FAILED would alert
    // nobody. That gap has since been closed — failedStreakThresholdFor() returns
    // 1 for any cron whose cadence outruns the base window — so the claim no
    // longer holds, and the comment it justified has been corrected in
    // staleness-runway.service.ts.
    //
    // The DECISION is unchanged, because reasons 1 and 2 never depended on it:
    // marking the run FAILED would be untrue (the work succeeds) and would
    // destroy the payload (failCronRun replaces `result`).
    const dailyGapMinutes = 24 * 60;
    assert.ok(dailyGapMinutes > FAILED_CRON_LOOKBACK_MINUTES, "premise: daily outruns the window");
    assert.equal(FAILED_CRON_STREAK_THRESHOLD, 2, "the base threshold is unchanged");
    assert.equal(
      failedStreakThresholdFor("amips-snapshot"),
      1,
      "a daily cron now alerts on a single failed run",
    );
  });

  test("the service does not throw to signal severity", () => {
    const SERVICE = readFileSync(
      join(process.cwd(), "lib/amips/staleness-runway.service.ts"),
      "utf8",
    );
    assert.ok(!/throw new Error/.test(SERVICE), "throwing would clobber the payload");
    assert.ok(/createAlertOnce\(/.test(SERVICE), "escalation goes through the alert layer");
    assert.ok(/notifyOncall\(/.test(SERVICE), "P0/P1 must page");
  });

  test("the alert source is stable so dedup works across runs", () => {
    assert.equal(RUNWAY_ALERT_SOURCE, "amips-staleness-runway");
  });
});

describe("the admin surface shows it beside the corpus counts", () => {
  const DASH = readFileSync(
    join(process.cwd(), "components/admin/amips/ExecutiveIntelligenceDashboard.tsx"),
    "utf8",
  );
  const INTEL = readFileSync(
    join(process.cwd(), "lib/amips/intelligence/executive-intelligence.ts"),
    "utf8",
  );

  test("the intelligence payload carries the runway", () => {
    assert.ok(/stalenessRunway: StalenessRunway;/.test(INTEL));
    assert.ok(/loadStalenessRunway\(\)/.test(INTEL));
  });

  test("the content-performance panel renders it", () => {
    assert.ok(/StalenessRunwayRow/.test(DASH));
    assert.ok(/data-testid="amips-staleness-runway"/.test(DASH));
    assert.ok(/data-testid="amips-runway-severity"/.test(DASH));
    assert.ok(/runway=\{data\.stalenessRunway\}/.test(DASH));
  });

  test("it names the cliff and the manual remedy on screen", () => {
    assert.ok(/goes dark in one day, not gradually/.test(DASH));
    assert.ok(/Refresh is manual/.test(DASH));
    assert.ok(/Regenerating pages does not clear it/.test(DASH));
  });

  test("an undated corpus reads as unmeasured, not healthy", () => {
    assert.ok(/No dated pages — nothing is scheduled to withhold\./.test(DASH));
  });
});
