// Regression coverage for FIX 5 — runLifecycleReview left no audit trail.
//
// Three separate writes set amips_pages.lifecycle_status, and none recorded who,
// when, or why. When 31 pages were found demoted in production the responsible
// run could not be identified: cron_job_logs had aged out, amips_pages has no
// lifecycleChangedAt or prior-status column, and the function emitted only
// aggregate counts. The investigation cost a full round trip for want of four
// fields.
//
// The invariant this pins: every lifecycle_status write is accompanied by a
// record() call, and the transitions ride in the cron result, which
// withCronRun() persists to cron_job_logs.result (Json) — no new table.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_LOGGED_TRANSITIONS } from "@/lib/amips/lifecycle-manager";

const SOURCE = readFileSync(join(process.cwd(), "lib/amips/lifecycle-manager.ts"), "utf8");

describe("FIX 5 — every lifecycle transition is recorded", () => {
  test("each lifecycleStatus write is followed by a record() call", () => {
    // Split on the write sites and assert an audit call follows each one before
    // the next write. Pre-fix there were three writes and zero record() calls.
    const writes = [...SOURCE.matchAll(/data:\s*\{\s*lifecycleStatus:\s*"([A-Z_]+)"\s*\}/g)];
    assert.equal(writes.length, 3, "expected exactly 3 lifecycleStatus write sites");

    for (const w of writes) {
      const from = w.index ?? 0;
      // Look ahead a bounded window for the audit call belonging to this write.
      const window = SOURCE.slice(from, from + 600);
      assert.ok(
        /record\(/.test(window),
        `lifecycleStatus write to ${w[1]} has no record() call — a demotion here would be undateable`,
      );
    }
  });

  test("every transition carries slug, from, to and reason", () => {
    for (const call of SOURCE.matchAll(/record\(\s*([\s\S]{0,220}?)\)\s*;/g)) {
      const args = call[1];
      const commas = args.split(",").length;
      assert.ok(commas >= 4, `record() called with too few arguments: ${args.slice(0, 80)}`);
    }
  });

  test("the reasons are distinct and name the actual branch", () => {
    const reasons = [...SOURCE.matchAll(/"(stale_data|no_impressions_180d|duplicate_cluster|low_conversion_90d|zero_traffic_365d)"/g)]
      .map((m) => m[1]);
    // All five branch outcomes must be nameable — "duplicate_cluster" vs
    // "low_conversion_90d" is exactly the distinction that was unanswerable.
    for (const r of [
      "stale_data",
      "no_impressions_180d",
      "duplicate_cluster",
      "low_conversion_90d",
      "zero_traffic_365d",
    ]) {
      assert.ok(reasons.includes(r), `missing transition reason: ${r}`);
    }
  });

  test("the transition list is capped so the cron JSON stays bounded", () => {
    assert.equal(typeof MAX_LOGGED_TRANSITIONS, "number");
    assert.ok(MAX_LOGGED_TRANSITIONS > 0 && MAX_LOGGED_TRANSITIONS <= 5000);
    assert.ok(
      /transitionsTruncated/.test(SOURCE),
      "truncation must be reported, or a capped list silently lies",
    );
  });

  test("no new table — transitions ride in the existing cron result", () => {
    // The platform pattern is Vercel cron + Postgres via withCronRun() writing
    // to cron_job_logs. CronJobLog.result is Json, so it carries this already.
    assert.ok(/transitions,/.test(SOURCE), "transitions must be returned in the result");
    assert.ok(
      !/prisma\.\w*[Aa]udit\w*\.create/.test(SOURCE),
      "should not introduce a separate audit table write",
    );
  });
});
