// The two-tier AI kill switch.
//
// Tier 1 (`AI_KILL_SWITCH` env) is the hard, deploy-level stop that still answers
// when the database is unreachable. Tier 2 (the `ai_kill_switch` FeatureFlag row)
// is the soft, admin-controlled runtime stop.
//
// The direction of tier 2 is the subtle part and is asserted here explicitly:
// it is a KILL flag, not an ENABLE flag. `getFeatureFlag` returns `false` for an
// absent row, so "no row" must mean "not killed" — today's default. Had it been
// framed as an enable-flag, the first deploy would have disabled all AI.
//
//   pnpm test:zura

import test, { beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

let flagValue = false;
let flagThrows = false;
let flagReads = 0;

mock.module("@/lib/services/admin/admin-platform.service", {
  namedExports: {
    getFeatureFlag: async () => {
      flagReads += 1;
      if (flagThrows) throw new Error("db down");
      return flagValue;
    },
    setFeatureFlag: async () => ({}),
  },
});

// The runner's CJS transform forbids top-level await, so the module under test
// is loaded in `beforeEach` — after the mock above is in force.
type KillSwitch = typeof import("../kill-switch");
let ks: KillSwitch;

const ORIGINAL_ENV = process.env.AI_KILL_SWITCH;

beforeEach(async () => {
  flagValue = false;
  flagThrows = false;
  flagReads = 0;
  delete process.env.AI_KILL_SWITCH;
  ks = await import("../kill-switch");
  ks.__resetKillSwitchCacheForTests();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AI_KILL_SWITCH;
  else process.env.AI_KILL_SWITCH = ORIGINAL_ENV;
  ks.__resetKillSwitchCacheForTests();
});

test("the flag key is the documented one", () => {
  assert.equal(ks.AI_KILL_SWITCH_FLAG, "ai_kill_switch");
});

test("tier 1: AI_KILL_SWITCH unset means enabled (today's default preserved)", () => {
  assert.equal(ks.isAiEnabled(), true);
  assert.doesNotThrow(() => ks.assertAiEnabled());
});

test("tier 1: AI_KILL_SWITCH=true disables, synchronously and without the DB", () => {
  process.env.AI_KILL_SWITCH = "true";
  assert.equal(ks.isAiEnabled(), false);
  assert.throws(() => ks.assertAiEnabled(), /AI_KILL_SWITCH/);
});

test("tier 1 short-circuits: with env off, the flag is never read", async () => {
  process.env.AI_KILL_SWITCH = "true";
  assert.equal(await ks.isAiEnabledAsync(), false);
  assert.equal(flagReads, 0, "a hard stop must not depend on a database read");
});

test("tier 2: an ABSENT flag row means AI is enabled", async () => {
  flagValue = false; // getFeatureFlag's documented default for a missing row
  assert.equal(await ks.isAiEnabledAsync(), true);
});

test("tier 2: the flag set means AI is killed, with no redeploy", async () => {
  flagValue = true;
  assert.equal(await ks.isAiEnabledAsync(), false);
});

test("a FeatureFlag read failure falls back to the env tier and does NOT disable AI", async () => {
  flagThrows = true;
  assert.equal(
    await ks.isAiEnabledAsync(),
    true,
    "a database outage must not take AI down on its own",
  );
});

test("a FeatureFlag read failure does NOT enable AI when the env tier says off", async () => {
  flagThrows = true;
  process.env.AI_KILL_SWITCH = "true";
  assert.equal(await ks.isAiEnabledAsync(), false);
});

test("a failed flag read is not cached — the next call retries", async () => {
  flagThrows = true;
  await ks.isAiEnabledAsync();
  const after = flagReads;
  await ks.isAiEnabledAsync();
  assert.ok(flagReads > after, "a degraded answer must not be pinned for the cache window");
});

test("a successful flag read IS cached for the cache window", async () => {
  const startedAt = Date.now();
  await ks.isAiEnabledAsync();
  const after = flagReads;
  await ks.isAiEnabledAsync();
  const elapsed = Date.now() - startedAt;

  if (elapsed >= ks.KILL_FLAG_CACHE_MS) {
    // The premise did not hold — this process stalled past the cache window
    // between the two calls, so a second read is CORRECT and asserting against
    // it would be a spurious failure rather than a real finding.
    return;
  }
  assert.equal(flagReads, after, "the flag must not be re-read on every model call");
});

test("assertAiEnabledForModelCall names the refused purpose and keeps the AI_KILL_SWITCH marker", async () => {
  flagValue = true;
  await assert.rejects(
    () => ks.assertAiEnabledForModelCall("zura.buyer.chat"),
    (err: Error) => {
      // Route handlers map `String(err).includes("AI_KILL_SWITCH")` to a 503
      // AI_DISABLED response; the runtime tier must trip the same mapping.
      assert.match(err.message, /AI_KILL_SWITCH/);
      assert.match(err.message, /zura\.buyer\.chat/);
      return true;
    },
  );
});

test("assertAiEnabledForModelCall resolves when AI is enabled", async () => {
  await assert.doesNotReject(() => ks.assertAiEnabledForModelCall("zura.buyer.chat"));
});
