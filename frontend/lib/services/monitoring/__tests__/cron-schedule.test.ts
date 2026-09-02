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

// ── Inventory spend ceiling, pinned by test rather than by comment ───────────

test("no scheduled cron reaching runInventorySync fires more than once per day", () => {
  // This is the quota guarantee. The old shape was inventory-sync-priority hourly (24/day)
  // plus inventory-sync-full every 6h (4/day) = 28 provider calls/day, ~850/month against a
  // 500/month plan — which produced 191 consecutive HTTP 429 runs in 2026-08.
  //
  // A comment cannot stop someone restoring an hourly schedule. This assertion can.
  const SPENDERS = ["inventory-sync-full", "inventory-sync-priority"];
  const scheduled = (vercel.crons as Array<{ path: string; schedule: string }>)
    .filter((c) => SPENDERS.some((s) => c.path === `/api/cron/${s}`));

  assert.equal(scheduled.length, 1, "exactly one scheduled MarketCheck spender");
  assert.equal(scheduled[0]!.path, "/api/cron/inventory-sync-full");

  // A daily cron is "<minute> <hour> * * *" — no step, no list, no wildcard hour.
  const [minute, hour, dom, month, dow] = scheduled[0]!.schedule.split(/\s+/);
  for (const [name, field] of [["minute", minute], ["hour", hour]] as const) {
    assert.ok(/^\d+$/.test(String(field)), `${name} must be a single fixed value, got "${field}"`);
  }
  assert.deepEqual([dom, month, dow], ["*", "*", "*"], "every day, once");

  // 1 run/day x 10 calls x 31 days = 310, inside a 400 ledger cap and a 500 provider cap.
  assert.ok(10 * 31 < 400);
});

test("inventory-sync-priority is de-scheduled in BOTH files, or it alerts forever", () => {
  const paths = (vercel.crons as Array<{ path: string }>).map((c) => c.path);
  assert.equal(paths.includes("/api/cron/inventory-sync-priority"), false);
  // A registry entry with no schedule goes OVERDUE and pages an operator nightly. The two
  // completeness assertions above already pin this in both directions; this names the
  // specific cron so the reason survives.
  assert.equal("inventory-sync-priority" in CRON_STALENESS, false);
});

test("the stale sweep runs AFTER the sync, never racing an in-flight walk", () => {
  const crons = vercel.crons as Array<{ path: string; schedule: string }>;
  const sync = crons.find((c) => c.path === "/api/cron/inventory-sync-full")!;
  const sweep = crons.find((c) => c.path === "/api/cron/inventory-stale-sweep")!;
  const mins = (s: string) => {
    const [m, h] = s.split(/\s+/);
    return Number(h) * 60 + Number(m);
  };
  assert.ok(mins(sweep.schedule) > mins(sync.schedule),
    "the sweep must evaluate a just-refreshed catalogue");
  assert.equal(mins(sweep.schedule) - mins(sync.schedule), 30);
  assert.equal(CRON_STALENESS["inventory-stale-sweep"]!.intervalMinutes, 24 * 60);
});
