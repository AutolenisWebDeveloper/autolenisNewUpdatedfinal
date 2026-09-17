// WHO MAY RELEASE, AND WITH WHAT CREDENTIAL — the two actors of §Stage 18, and the carve-out.
//
// THE DEFECT THIS PINS. §8.2 defect (4) collapsed five Deal-completion writers into
// `pickup-completion.service.ts`, and the journey routes moved onto it through
// `completeJourneyPickup`. That wrapper had no code to present, so it passed `rawToken: ""` —
// and `consumeReleaseToken` hashes whatever it is given and compares, so an empty string matches
// no row, returns false, and the release refused with `code_already_spent`. The admin path could
// no longer complete a pickup AT ALL. A capability that had worked for every prior phase would
// have disappeared behind a refactor whose whole purpose was to preserve it, and the guard that
// counts admin completion paths would still have read green, because the route was still there —
// it just could not finish.
//
// THE RULE THAT REPLACED THE EMPTY STRING. The code is the DEALERSHIP's credential: §Stage 18
// has the dealer scan what the buyer presents, and the point of hashing it is that possession of
// the code proves the buyer is at the counter. An Operations-recorded release is a different act
// with a different proof — role gate, stated reason, awaited audit row (pinned in
// `lib/__tests__/role-boundary-frozen.test.ts`) — and it has no code to present. So the input is
// a UNION: a scanned release carries `rawToken` and an Operations release may not carry one at
// all. `rawToken: ""` no longer type-checks in either arm, which is the real repair — the runtime
// branch below is what that union buys.
//
// AND IT REVOKES RATHER THAN CONSUMES. Consuming records "a handover happened on this
// credential", which would be false. Revoking records "it will not happen on this credential",
// which is exactly true once Operations has recorded the release.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-completion-actors.test.ts"

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { hashToken } from "@/lib/services/dealer-recruitment/account-claim.service";

/** The code the buyer holds, in this fixture. */
const LIVE_CODE = "AL-7Q2K-9XTB";

interface Ctrl {
  dealStatus: string;
  /** The pickup row's stored credential — a REAL hash, so a wrong or empty code really misses. */
  storedHash: string | null;
  tokenConsumedAt: Date | null;
  tokenRevokedAt: Date | null;
  consumeAttempts: Array<string | undefined>;
  revokeCalls: string[];
  statusHistory: Array<Record<string, unknown>>;
  pickupUpdates: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  completionEvents: string[];
}
let ctrl: Ctrl;

const dealRow = () => ({
  id: "deal_1",
  status: ctrl.dealStatus,
  buyerId: "buyer_1",
  completedAt: null,
  insuranceStatus: "VERIFIED",
  dealerExecutedContractId: "cv_1",
  fundingClearedAt: new Date("2026-02-01T00:00:00Z"),
  buyer: { firstName: "Ada", user: { email: "ada@example.com" } },
  offer: { dealerId: "dlr_1", dealer: { dealershipName: "North Motors", user: { email: "sales@north.example" } } },
});

const tx = {
  deal: {
    findUnique: async () => dealRow(),
    updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
      if (where.status !== ctrl.dealStatus) return { count: 0 };
      ctrl.dealStatus = data.status;
      return { count: 1 };
    },
  },
  pickup: {
    update: async (args: Record<string, unknown>) => { ctrl.pickupUpdates.push(args); return {}; },
    // THE TOKEN SERVICE IS NOT MOCKED. `consumeReleaseToken` and `revokeReleaseToken` are a hash
    // and a conditional `updateMany`, and mocking them to return `true` is precisely how the
    // empty-string defect stayed invisible: a stub that answers "spent" for any input cannot tell
    // `""` from the buyer's code. This models the ROW, and lets the real comparison run.
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (ctrl.tokenConsumedAt || ctrl.tokenRevokedAt) return { count: 0 };
      if ("tokenHash" in where && typeof where.tokenHash === "string") {
        ctrl.consumeAttempts.push(where.tokenHash);
        if (where.tokenHash !== ctrl.storedHash) return { count: 0 };
        ctrl.tokenConsumedAt = data.tokenConsumedAt as Date;
        return { count: 1 };
      }
      // The revoke shape: `tokenHash: { not: null }`.
      if (!ctrl.storedHash) return { count: 0 };
      ctrl.revokeCalls.push(String(where.dealId));
      ctrl.tokenRevokedAt = data.tokenRevokedAt as Date;
      return { count: 1 };
    },
  },
  dealStatusHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.statusHistory.push(data); return {}; } },
  buyerActivityEvent: { create: async () => ({}) },
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  },
});

mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (input: Record<string, unknown>) => { ctrl.outbox.push(input); return { queued: true }; },
  },
});

mock.module("@/lib/services/operations/queue-item.service", {
  namedExports: {
    raiseException: async (input: Record<string, unknown>) => { ctrl.exceptions.push(input); return {}; },
  },
});

mock.module("@/lib/services/deal/deal-completion-event.service", {
  namedExports: {
    emitDealCompletionEvent: async (dealId: string) => { ctrl.completionEvents.push(dealId); },
  },
});

const service = () => import("../pickup-completion.service");

beforeEach(() => {
  ctrl = {
    dealStatus: "PICKUP_SCHEDULED",
    storedHash: hashToken(LIVE_CODE),
    tokenConsumedAt: null,
    tokenRevokedAt: null,
    consumeAttempts: [],
    revokeCalls: [],
    statusHistory: [],
    pickupUpdates: [],
    outbox: [],
    exceptions: [],
    completionEvents: [],
  };
});

test("an Operations-recorded release needs no code, and drives the journey route to COMPLETED", async () => {
  // THE REGRESSION. Before the union, this wrapper passed `rawToken: ""`, the consume matched no
  // row, and the release refused — so the admin journey route could not complete a pickup at all.
  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1");

  assert.deepEqual(out, { ok: true }, "the admin journey path must still be able to complete a pickup");
  assert.equal(ctrl.dealStatus, "COMPLETED");
  assert.deepEqual(
    ctrl.consumeAttempts,
    [],
    "an Operations release presents no code — it must not try to spend one, and must not fail when it cannot"
  );
  assert.deepEqual(ctrl.revokeCalls, ["deal_1"], "the live code must be RETIRED, not consumed: no handover happened on it");
});

test("the release and the completion are recorded as ADMIN acts, not as the dealer's or the buyer's", async () => {
  await (await service()).completeJourneyPickup("deal_1", "admin_1");

  assert.deepEqual(
    ctrl.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.actorRole, h.actorId]),
    [
      ["PICKUP_SCHEDULED", "HANDOVER_PENDING", "ADMIN", "admin_1"],
      ["HANDOVER_PENDING", "COMPLETED", "ADMIN", "admin_1"],
    ],
    "§Stage 19: an admin-recorded possession that reads as the buyer's makes the history lie about who was at the car"
  );
});

test("a DEALER release still has to present a code that matches — the carve-out is not a bypass", async () => {
  const out = await (await service()).recordDealerRelease({
    dealId: "deal_1",
    dealerId: "dlr_1",
    pickupId: "pu_1",
    rawToken: "not-the-right-code",
    identityVerified: true,
  });

  assert.deepEqual(out, { ok: false, reason: "code_already_spent" });
  assert.deepEqual(
    ctrl.consumeAttempts,
    [hashToken("not-the-right-code")],
    "the dealer path must still attempt the spend, against the hash of what was presented"
  );
  assert.equal(ctrl.dealStatus, "PICKUP_SCHEDULED", "a refused code must leave the deal where it was");
  assert.deepEqual(ctrl.revokeCalls, [], "a failed dealer scan must not retire the buyer's live code");
});

test("an unverified identity refuses before anything is spent or revoked", async () => {
  const out = await (await service()).recordDealerRelease({
    dealId: "deal_1",
    dealerId: "dlr_1",
    pickupId: "pu_1",
    rawToken: "code",
    identityVerified: false,
  });

  assert.deepEqual(out, { ok: false, reason: "identity_unverified" });
  assert.deepEqual(ctrl.consumeAttempts, [], "identity is a precondition — it is checked before the credential is touched");
  assert.deepEqual(ctrl.revokeCalls, []);
  assert.equal(ctrl.exceptions[0]?.code, "ID_MISMATCH_AT_HANDOVER", "§Stage 18 raises the §26 exception");
});

test("the journey wrapper refuses a deal that never reached a scheduled pickup", async () => {
  ctrl.dealStatus = "FUNDING_PENDING";

  const out = await (await service()).completeJourneyPickup("deal_1", "admin_1");

  assert.deepEqual(out, {
    ok: false,
    code: "NOT_READY_FOR_PICKUP",
    message: "This deal has not reached a scheduled pickup, so there is no handover to record.",
  });
  assert.equal(ctrl.dealStatus, "FUNDING_PENDING");
  assert.deepEqual(ctrl.revokeCalls, [], "nothing is retired for a handover that was never reached");
});

test("a second journey completion is a no-op, not a second completion", async () => {
  await (await service()).completeJourneyPickup("deal_1", "admin_1");
  const before = { history: ctrl.statusHistory.length, events: ctrl.completionEvents.length };

  const again = await (await service()).completeJourneyPickup("deal_1", "admin_1");

  assert.deepEqual(again, { ok: true });
  assert.equal(ctrl.statusHistory.length, before.history, "COMPLETED is terminal — no second history row");
  assert.equal(ctrl.completionEvents.length, before.events, "and no second completion event");
});

test("the buyer's own confirmation is still the normal path, and is recorded as the buyer's", async () => {
  ctrl.dealStatus = "HANDOVER_PENDING";

  const out = await (await service()).confirmPossession({
    dealId: "deal_1",
    buyerId: "buyer_1",
    vehicleReceived: true,
    vinMatch: true,
    keysAndAccessoriesReceived: true,
  });

  assert.equal(out.ok, true);
  assert.equal(ctrl.dealStatus, "COMPLETED");
  assert.deepEqual(
    ctrl.statusHistory.map((h) => [h.actorRole, h.actorId]),
    [["BUYER", "buyer_1"]],
    "the default actor is the buyer — the ADMIN carve-out must not become the default"
  );
});
