// Dormant + granular + fail-closed activation.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/activation.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { envActivationResolver, parseActiveKeys, alwaysClosedResolver } from "../activation";
import { proposeIntent } from "../engine";
import { makeActor, makeDeps } from "./_harness";

test("no configuration → everything fails closed", async () => {
  const r = envActivationResolver({});
  assert.equal(await r("BUYER:buyer.get_journey_status"), false);
});

test("master off → even a listed key is closed", async () => {
  const r = envActivationResolver({ ACTION_INTENT_ACTIVE_KEYS: "BUYER:buyer.get_journey_status" });
  assert.equal(await r("BUYER:buyer.get_journey_status"), false);
});

test("master on + key listed → open; unlisted key stays closed", async () => {
  const r = envActivationResolver({
    ACTION_INTENT_EXECUTION_ENABLED: "true",
    ACTION_INTENT_ACTIVE_KEYS: "BUYER:buyer.get_journey_status",
  });
  assert.equal(await r("BUYER:buyer.get_journey_status"), true);
  // Enabling one safe read must NOT enable a mutation or another actor's intent.
  assert.equal(await r("BUYER:buyer.select_offer"), false);
  assert.equal(await r("ADMIN:admin.trigger_deposit_refund"), false);
});

test("activation is granular per actor+intent, never wildcard", async () => {
  const r = envActivationResolver({
    ACTION_INTENT_EXECUTION_ENABLED: "true",
    ACTION_INTENT_ACTIVE_KEYS: "ADMIN:admin.get_platform_snapshot",
  });
  assert.equal(await r("ADMIN:admin.get_platform_snapshot"), true);
  assert.equal(await r("ADMIN:admin.advance_deal_status"), false);
  assert.equal(await r("ADMIN:admin.trigger_deposit_refund"), false);
});

test("parseActiveKeys tolerates commas/whitespace and empty", () => {
  assert.equal(parseActiveKeys(undefined).size, 0);
  assert.equal(parseActiveKeys("").size, 0);
  const s = parseActiveKeys("a:b, c:d\n e:f");
  assert.ok(s.has("a:b") && s.has("c:d") && s.has("e:f"));
});

test("alwaysClosedResolver never opens", async () => {
  assert.equal(await alwaysClosedResolver("anything"), false);
});

test("engine wired to a dormant env resolver rejects with NOT_ACTIVATED", async () => {
  const deps = makeDeps({ activeIntents: [] });
  deps.activation = envActivationResolver({}); // fully dormant
  const out = await proposeIntent(
    { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "NOT_ACTIVATED");
  assert.deepEqual(deps.calls, []);
});
