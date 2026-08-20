// D3a — CRON_STALENESS registry + liveness classifier (pure, no DB).
//
// The registry is the source of truth for each scheduled cron's expected
// cadence. The classifier turns "latest run timestamp" into OK / OVERDUE /
// NEVER_RUN. NEVER_RUN is informational (no run recorded yet — e.g. a cron not
// yet wired through withCronRun); only OVERDUE alerts.
//
// A completeness check pins the registry to vercel.json so a newly-scheduled
// cron cannot silently escape staleness monitoring.
//
// Run: pnpm test:monitoring

import test from "node:test";
import assert from "node:assert/strict";
import {
  CRON_STALENESS,
  classifyCronLiveness,
  maxAgeFor,
  OVERDUE_GRACE_MINUTES,
} from "@/lib/services/monitoring/cron-schedule";
import vercel from "@/vercel.json";

const NOW = new Date("2026-08-19T12:00:00.000Z");

test("classifyCronLiveness returns NEVER_RUN when no run has been recorded", () => {
  const r = classifyCronLiveness("health-check", null, NOW);
  assert.equal(r.state, "NEVER_RUN");
  assert.equal(r.lastRunAt, null);
  assert.equal(r.ageMinutes, null);
  assert.ok(r.maxAgeMinutes > 0);
});

test("classifyCronLiveness returns OK when the latest run is within maxAge", () => {
  // health-check interval is 5m → maxAge = 5*2+10 = 20m. 8m ago is fine.
  const last = new Date(NOW.getTime() - 8 * 60_000);
  const r = classifyCronLiveness("health-check", last, NOW);
  assert.equal(r.state, "OK");
  assert.equal(r.ageMinutes, 8);
});

test("classifyCronLiveness returns OVERDUE when the latest run exceeds maxAge", () => {
  // 45m since last run, maxAge 20m → overdue.
  const last = new Date(NOW.getTime() - 45 * 60_000);
  const r = classifyCronLiveness("health-check", last, NOW);
  assert.equal(r.state, "OVERDUE");
  assert.equal(r.ageMinutes, 45);
  assert.ok(r.ageMinutes! > r.maxAgeMinutes);
});

test("an unknown cron name is treated as OK (not monitored, never alerts)", () => {
  const r = classifyCronLiveness("not-a-real-cron", null, NOW);
  assert.equal(r.state, "OK");
});

test("maxAgeFor honours an explicit override, else applies the policy", () => {
  assert.equal(maxAgeFor({ intervalMinutes: 5 }), 5 * 2 + OVERDUE_GRACE_MINUTES);
  assert.equal(maxAgeFor({ intervalMinutes: 5, maxAgeMinutes: 999 }), 999);
});

test("weekly/weekday crons tolerate their real max inter-run gap", () => {
  // dealer-followup runs Mon–Fri; Fri→Mon is a 72h gap. 3 days quiet must be OK.
  const last = new Date(NOW.getTime() - 71 * 60 * 60_000);
  const r = classifyCronLiveness("dealer-followup", last, NOW);
  assert.equal(r.state, "OK", "a normal weekend gap is not overdue");
});

test("every scheduled cron in vercel.json is present in CRON_STALENESS", () => {
  const scheduled = (vercel.crons as Array<{ path: string }>).map((c) =>
    c.path.replace("/api/cron/", "")
  );
  const missing = scheduled.filter((name) => !(name in CRON_STALENESS));
  assert.deepEqual(missing, [], `crons scheduled but not staleness-monitored: ${missing.join(", ")}`);
});

test("CRON_STALENESS has no stale entries absent from vercel.json", () => {
  const scheduled = new Set(
    (vercel.crons as Array<{ path: string }>).map((c) => c.path.replace("/api/cron/", ""))
  );
  const orphans = Object.keys(CRON_STALENESS).filter((name) => !scheduled.has(name));
  assert.deepEqual(orphans, [], `registry entries with no schedule: ${orphans.join(", ")}`);
});
