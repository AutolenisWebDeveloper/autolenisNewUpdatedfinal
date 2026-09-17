// The pickup services' wiring to the release token — what they stopped writing, and what they
// now revoke.
//
// THREE DEFECTS ARE PINNED HERE, all of them absences. Absences need tests or the next reader
// "restores the missing field" and reintroduces the defect:
//
//   1. `schedulePickup` must write NO credential. It used to write a `Math.random()` payload to
//      `qr_code_data` and its rendered PNG to `qr_code_image` — plaintext at rest, in a column a
//      database read hands straight back.
//   2. Moving the APPOINTMENT must retire the code minted for the old one. A token's expiry is
//      bound to `scheduledAt`, so a reschedule otherwise leaves a code that is live on a day the
//      handover is not, or dead on the day it is.
//   3. `reissueReleaseCode` must REFUSE a pickup that is not releasable. Its predecessor
//      `regenerateQr` had no status guard at all, so an administrator could mint a live 48-hour
//      code for a pickup that was never scheduled.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/pickup/__tests__/pickup-release-wiring.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  pickupRow: Record<string, unknown> | null;
  upsertArgs: Array<Record<string, unknown>>;
  updateArgs: Array<Record<string, unknown>>;
  revokedDealIds: string[];
  issueReturns: { rawToken: string; expiresAt: Date } | null;
  issuedDealIds: string[];
  availability: { ok: boolean; reason: string };
  notifications: Array<Record<string, unknown>>;
  advances: Array<{ dealId: string; status: string }>;
}
let ctrl: Ctrl;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      pickup: {
        upsert: async (args: Record<string, unknown>) => { ctrl.upsertArgs.push(args); return { id: "pu_1" }; },
        update: async (args: Record<string, unknown>) => { ctrl.updateArgs.push(args); return { id: "pu_1", status: "RESCHEDULED" }; },
        findUnique: async () => ctrl.pickupRow,
      },
      deal: {
        // PHASE 9: `schedulePickup` now evaluates §Stage 16's thirteen readiness items before it
        // advances, so this fixture carries the facts they read. Twelve come from earlier phases
        // (vin, executed contract, financing, funding, insurance, down payment); the four the
        // dealership attests sit on the pickup row. All satisfied — this file's subject is the
        // TOKEN wiring, and the unready case is proven in `pickup-readiness-gate.test.ts`.
        findUnique: async () => ({
          id: "deal_1",
          buyerId: "buyer_1",
          status: "FUNDING_PENDING",
          offer: { dealerId: "dlr_1" },
          vin: "1HGCM82633A004352",
          vehicleYear: 2021,
          vehicleMake: "Honda",
          vehicleModel: "Accord",
          vehicleHoldUntil: new Date("2126-01-01T00:00:00Z"),
          dealerExecutedContractId: "cv_1",
          financingCompletedAt: new Date("2026-02-01T00:00:00Z"),
          fundingClearedAt: new Date("2026-02-01T00:00:00Z"),
          insuranceStatus: "VERIFIED",
          downPaymentCents: 200000,
          holdReason: null,
          frozenAt: null,
          financing: { downPaymentMethod: "CASHIERS_CHECK" },
          tradeInSubmissions: [],
          queueItems: [],
          pickup: {
            ...ctrl.pickupRow,
            vehiclePreparedAt: new Date("2026-02-01T00:00:00Z"),
            dealerReadinessChecklist: { accessoriesPresent: true, deliveryDocumentsReady: true },
            dueBillItems: [],
          },
        }),
      },
      notification: { create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); return {}; } },
      buyerActivityEvent: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, status: string) => { ctrl.advances.push({ dealId, status }); return true; },
    // MUST MATCH lib/services/deal/deal.service.ts. The readiness evaluator reads this list for
    // item 7, and a mock that omits it makes `INSURANCE_SATISFIED.includes(...)` throw inside a
    // service this file is not testing — a failure with nothing to do with the token wiring.
    INSURANCE_SATISFIED: ["VERIFIED", "POLICY_BOUND"],
  },
});

// Specifiers are resolved from THIS file, and node matches mocks by resolved URL — so "../x"
// here and "./x" inside the service under test are the same module. Writing the importer's own
// spelling ("./release-token.service") would resolve against __tests__/ and fail to find it,
// which is a loud ERR_MODULE_NOT_FOUND rather than a silently unmocked import.
mock.module("../release-token.service", {
  namedExports: {
    issueReleaseToken: async ({ dealId }: { dealId: string }) => {
      ctrl.issuedDealIds.push(dealId);
      return ctrl.issueReturns;
    },
    revokeReleaseToken: async (dealId: string) => { ctrl.revokedDealIds.push(dealId); return true; },
  },
});

mock.module("../availability.service", {
  namedExports: { checkPickupTime: async () => ctrl.availability },
});

const APPT = new Date("2026-09-22T15:00:00.000Z");

beforeEach(() => {
  ctrl = {
    pickupRow: { id: "pu_1", status: "SCHEDULED" },
    upsertArgs: [],
    updateArgs: [],
    revokedDealIds: [],
    issueReturns: { rawToken: "a".repeat(64), expiresAt: new Date("2026-09-23T03:00:00.000Z") },
    issuedDealIds: [],
    availability: { ok: true, reason: "" },
    notifications: [],
    advances: [],
  };
});

// ── 1. schedulePickup writes no credential ───────────────────────────────────────────────

test("schedulePickup writes NO qr_code_data, qr_code_image or qr_expires_at", async () => {
  const { schedulePickup } = await import("../pickup.service");
  await schedulePickup("deal_1", APPT, "123 Dealer Dr, Dallas TX");

  assert.equal(ctrl.upsertArgs.length, 1);
  const args = ctrl.upsertArgs[0] as { create: Record<string, unknown>; update: Record<string, unknown> };
  for (const half of ["create", "update"] as const) {
    for (const col of ["qrCodeData", "qrCodeImage", "qrExpiresAt"]) {
      assert.equal(
        col in args[half],
        false,
        `${half}.${col} must not be written — a stored credential is the defect this phase closes`,
      );
    }
  }
  // And the row it DOES write is still the real scheduling write, not an empty object.
  assert.equal(args.create.status, "SCHEDULED");
  assert.equal((args.create.scheduledAt as Date).getTime(), APPT.getTime());
  assert.equal(args.update.location, "123 Dealer Dr, Dallas TX");
});

test("schedulePickup retires any code minted for the previous appointment", async () => {
  const { schedulePickup } = await import("../pickup.service");
  await schedulePickup("deal_1", APPT, "123 Dealer Dr, Dallas TX");
  assert.deepEqual(ctrl.revokedDealIds, ["deal_1"]);
});

test("schedulePickup mints nothing — a token nobody holds is a token spent on no one", async () => {
  const { schedulePickup } = await import("../pickup.service");
  await schedulePickup("deal_1", APPT, "123 Dealer Dr, Dallas TX");
  assert.deepEqual(ctrl.issuedDealIds, [], "the buyer reveals their code; scheduling does not push one");
});

test("the buyer's scheduling notice does not promise a code that is ready and waiting", async () => {
  // It used to read "Your QR code is ready." There is no stored code to be ready, and telling a
  // buyer otherwise sends them looking for something that is not there.
  const { schedulePickup } = await import("../pickup.service");
  await schedulePickup("deal_1", APPT, "123 Dealer Dr, Dallas TX");
  const body = String(ctrl.notifications[0]?.body ?? "");
  assert.equal(/QR code is ready/i.test(body), false, `stale promise in: ${body}`);
  assert.match(body, /pickup code/i, "it must still tell the buyer where their code comes from");
});

test("schedulePickup advances THROUGH readiness — in that order, never straight to scheduled", async () => {
  // The release wiring changed nothing about the fact that this path advances the deal; PHASE 9
  // changed the RUNG IT PASSES THROUGH. §Stage 16's exit is "all items true; Deal moves to
  // scheduling", so readiness is a state the deal occupies, not a check it passes on the way.
  //
  // THE ORDER IS THE ASSERTION. A deep-equal on the set alone would pass if the two advances came
  // out backwards — scheduling first and readiness after is exactly the bypass the checklist
  // exists to prevent, and it would look identical to a sorted comparison.
  const { schedulePickup } = await import("../pickup.service");
  await schedulePickup("deal_1", APPT, "123 Dealer Dr, Dallas TX");
  assert.deepEqual(ctrl.advances, [
    { dealId: "deal_1", status: "PICKUP_READINESS" },
    { dealId: "deal_1", status: "PICKUP_SCHEDULED" },
  ]);
});

// ── 2. reissueReleaseCode ────────────────────────────────────────────────────────────────

test("reissueReleaseCode returns a rendered QR and the token's own expiry", async () => {
  const { reissueReleaseCode } = await import("../pickup.service");
  const res = await reissueReleaseCode("deal_1");
  assert.ok(res);
  assert.match(res.image, /^data:image\/png;base64,/, "a real, locally rendered PNG (D7 — never an external QR API)");
  assert.equal(res.expiresAt.toISOString(), "2026-09-23T03:00:00.000Z");
  assert.deepEqual(ctrl.issuedDealIds, ["deal_1"]);
});

test("reissueReleaseCode REFUSES when the token service refuses", async () => {
  // The status precondition lives in `issueReleaseToken`; this proves the refusal is propagated
  // rather than swallowed into a broken image. Its predecessor could not refuse at all.
  const { reissueReleaseCode } = await import("../pickup.service");
  ctrl.issueReturns = null;
  assert.equal(await reissueReleaseCode("deal_1"), null);
});

test("two reissues render different images — the raw token is what is drawn", async () => {
  const { reissueReleaseCode } = await import("../pickup.service");
  const a = await reissueReleaseCode("deal_1");
  ctrl.issueReturns = { rawToken: "b".repeat(64), expiresAt: new Date("2026-09-23T03:00:00.000Z") };
  const b = await reissueReleaseCode("deal_1");
  assert.ok(a && b);
  assert.notEqual(a.image, b.image, "a render that ignores the token would be the same picture twice");
});

// ── 3. A reschedule retires the old code ─────────────────────────────────────────────────

test("reschedulePickup revokes the outstanding code, and projects the row it returns", async () => {
  const { reschedulePickup } = await import("../scheduling.service");
  const res = await reschedulePickup("deal_1", new Date("2026-09-25T15:00:00.000Z"), { now: new Date("2026-09-20T09:00:00.000Z") });
  assert.equal(res.ok, true);
  assert.deepEqual(ctrl.revokedDealIds, ["deal_1"], "a code dated to the old appointment must not survive the move");

  // The rescheduled row is returned to the buyer's browser by
  // app/api/buyer/pickup/[dealId]/route.ts, so it has to be projected.
  const args = ctrl.updateArgs[0] as { select?: Record<string, boolean> };
  assert.ok(args.select, "the update must project; `pickup.update` without a select returns token_hash");
  assert.equal("tokenHash" in args.select, false);
  assert.equal(args.select.status, true, "and the projection must still carry the fields the screen needs");
});

test("a reschedule the availability gate refuses revokes nothing and writes nothing", async () => {
  const { reschedulePickup } = await import("../scheduling.service");
  ctrl.availability = { ok: false, reason: "Outside the dealership's hours." };
  const res = await reschedulePickup("deal_1", new Date("2026-09-25T03:00:00.000Z"), { now: new Date("2026-09-20T09:00:00.000Z") });
  assert.equal(res.ok, false);
  assert.deepEqual(ctrl.revokedDealIds, [], "a refused reschedule must not kill the buyer's working code");
  assert.deepEqual(ctrl.updateArgs, []);
});
