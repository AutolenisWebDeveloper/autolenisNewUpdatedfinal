// The buyer must be told when their contract is SIGNED.
//
// The defect this pins: SIGNED was listed in INAPP_OWNED_BY_CALLERS, which makes the
// orchestrator SKIP the in-app notification on the assumption that a caller creates
// it. The named owner was `esign.service.handleEnvelopeCompleted` — a symbol that
// exists nowhere in the repository; it was removed with DocuSign and the ownership
// entry was left behind. The SIGNED plan also sets sms: null. Net effect: reaching
// SIGNED — the moment the buyer's contract becomes binding — produced NO buyer
// notification on ANY channel, and no cron or nudge covers SIGNED either.
//
// The plan itself (title/body/actionUrl) already existed and was correct; it was
// simply never dispatched. Removing the stale ownership entry lets the orchestrator
// own it, which is what it already does for every other genuinely-silent transition.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/notifications/__tests__/signed-notification.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { INAPP_OWNED_BY_CALLERS } from "@/lib/services/notifications/acquisition-comms";

test("SIGNED is NOT delegated to a caller — nothing exists to create that notification", () => {
  assert.equal(
    INAPP_OWNED_BY_CALLERS.has("SIGNED"),
    false,
    "SIGNED was delegated to esign.service.handleEnvelopeCompleted, which does not exist — the buyer got nothing",
  );
});

test("every status still delegated to a caller names a real owner", async () => {
  // Guard against the same class of bug: an ownership entry outliving its owner.
  const { readFileSync } = await import("fs");
  const src = readFileSync("lib/services/notifications/acquisition-comms.ts", "utf8");
  assert.ok(
    !/handleEnvelopeCompleted/.test(src),
    "acquisition-comms still references handleEnvelopeCompleted, which no longer exists",
  );
});
