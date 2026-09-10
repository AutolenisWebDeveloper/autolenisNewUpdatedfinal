// PAY-11a/11b, PAY-10b, PAY-08 — the payment gate's request scoping, at the route.
//
// §5b: "Create or reuse ONE Stripe PaymentIntent tied to THAT Vehicle Request — not
// merely to the buyer. `deposits` gains `vehicle_request_id`."
//
// The old idempotency key was `deposit-buyer-<id>-<UTC day>`, and it was wrong in both
// directions at once. WITHIN a day it collapsed two different requests onto one intent,
// because the buyer was the only thing in the key. ACROSS days it minted a FRESH intent
// for the same unpaid request — which is how the duplicate-charge path opened, with the
// day bucket hiding the collision until the next day.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/deposit/__tests__/create-intent-request-scope.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "vr_scoped_1";

interface Ctrl {
  openRequest: { id: string } | null;
  /**
   * The §5a verdict. The route now receives TWO verdicts from one gather — the
   * transition gate (six conditions) and the intent gate (those plus disclosure
   * acceptance) — because the existing-obligation check sits between them. This fake
   * derives both from one setting: the disclosure half is exercised by
   * `deposit-eligibility.test.ts`, not here.
   */
  eligibility: { eligible: boolean; code?: string; message?: string; missing?: string };
  paymentRequiredCalls: string[];
  createArgs: Array<{ params: Record<string, unknown>; opts: Record<string, unknown> }>;
  upserts: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: BUYER_ID, preQualification: { decision: "APPROVED" } }),
    getRequestUser: async () => ({ email_confirmed_at: "2026-01-01T00:00:00Z" }),
    successResponse: (data: unknown) => ({ ok: true, data }),
    errorResponse: (code: string, message: string, status: number, details?: unknown) => ({
      ok: false, code, message, status, details,
    }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOfferReview: { findUnique: async () => null },
      buyer: {
        findUnique: async () => ({
          firstName: "Sam", lastName: "Buyer", phone: null, user: { email: "buyer@example.com" },
        }),
      },
      shortlistItem: { count: async () => 1 },
      deposit: {
        findMany: async () => [],
        findFirst: async () => null,
        upsert: async (args: Record<string, unknown>) => { ctrl.upserts.push(args); return { id: "dep_1" }; },
        create: async () => ({ id: "dep_1" }),
        update: async () => ({ id: "dep_1" }),
        updateMany: async () => ({ count: 1 }),
      },
    },
  },
});

mock.module("@/lib/stripe", {
  namedExports: {
    getStripe: () => ({
      paymentIntents: {
        create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
          ctrl.createArgs.push({ params, opts });
          return { id: "pi_NEW", client_secret: "pi_NEW_secret", metadata: params.metadata };
        },
        retrieve: async () => ({ status: "requires_payment_method", client_secret: "x", metadata: {} }),
      },
    }),
  },
});

mock.module("@/lib/services/vehicle-request/open-request.service", {
  namedExports: {
    findOpenRequest: async () => ctrl.openRequest,
    OPEN_REQUEST_STATUSES: ["DRAFT", "SUBMITTED", "INTAKE", "PAYMENT_REQUIRED"],
  },
});
mock.module("@/lib/services/vehicle-request/vehicle-request.service", {
  namedExports: {
    enterPaymentRequired: async (id: string) => { ctrl.paymentRequiredCalls.push(id); return true; },
  },
});
mock.module("@/lib/services/payment/deposit-eligibility", {
  namedExports: {
    gatherAndCheckEligibility: async () => ({ transition: ctrl.eligibility, intent: ctrl.eligibility }),
  },
});
mock.module("@/lib/security/rate-limit", {
  namedExports: {
    limitPaymentIntent: async () => ({ ok: true }),
    // The checkout PROBE (a call with no disclosure version) is rate-limited as the
    // read it is, not against the 10/hour card-testing budget a mint uses.
    limitGeneral: async () => ({ ok: true }),
    clientIpKey: () => "ip",
  },
});
mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: { scheduleLifecycleWorkload: async () => {} },
});
mock.module("@/lib/services/crm/lifecycle-touch-drain.service", {
  namedExports: { cancelPreCheckoutTouches: async () => ({ canceled: 0, status: "OK" }) },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return (await import("@/app/api/buyer/deposit/create-intent/route")).POST;
}

function req(body: Record<string, unknown> = { disclosuresVersion: "2026-09-09-draft" }): NextRequest {
  return new NextRequest("https://autolenis.com/api/buyer/deposit/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  ctrl = {
    openRequest: { id: REQUEST_ID },
    eligibility: { eligible: true },
    paymentRequiredCalls: [],
    createArgs: [],
    upserts: [],
  };
});

test("the PaymentIntent is keyed to the VEHICLE REQUEST, not to the buyer and the day", async () => {
  const POST = await load();
  await POST(req());

  assert.equal(ctrl.createArgs.length, 1);
  assert.equal(
    ctrl.createArgs[0]!.opts.idempotencyKey,
    `deposit-vr-${REQUEST_ID}`,
    "a returning buyer must get the SAME intent for the same unpaid request; the UTC-day bucket " +
      "minted a fresh $99 intent the next day",
  );
  assert.ok(
    !String(ctrl.createArgs[0]!.opts.idempotencyKey).includes(BUYER_ID),
    "and the buyer alone must not be what the key is per — that collapsed two requests onto one intent",
  );
});

test("the request id is stamped in the PaymentIntent metadata", async () => {
  const POST = await load();
  await POST(req());
  const md = ctrl.createArgs[0]!.params.metadata as Record<string, string>;
  assert.equal(md.vehicleRequestId, REQUEST_ID);
  assert.equal(md.type, "deposit");
});

test("the deposit row carries the request link AND the disclosure acceptance", async () => {
  const POST = await load();
  await POST(req());

  const create = ctrl.upserts[0]!.create as Record<string, unknown>;
  assert.equal(create.vehicleRequestId, REQUEST_ID, "attached at creation, not at settlement");
  assert.equal(create.disclosuresVersion, "2026-09-09-draft");
  assert.ok(create.disclosuresAcceptedAt instanceof Date);
});

test("an existing row is brought up to date rather than left with an empty update", async () => {
  const POST = await load();
  await POST(req());

  const update = ctrl.upserts[0]!.update as Record<string, unknown>;
  assert.equal(
    update.vehicleRequestId,
    REQUEST_ID,
    "`update: {}` would keep a concurrently-written row that predates the request link",
  );
  assert.equal(update.disclosuresVersion, "2026-09-09-draft");
});

test("PAY-10b: the request is moved to PAYMENT_REQUIRED on the eligibility pass", async () => {
  const POST = await load();
  await POST(req());
  assert.deepEqual(ctrl.paymentRequiredCalls, [REQUEST_ID]);
});

test("§5a: a failure returns the NAMED requirement and mints nothing", async () => {
  ctrl.eligibility = {
    eligible: false,
    code: "LOCATION_REQUIRED",
    message: "We need your city, ZIP code before we can find dealerships near you.",
    missing: "city, ZIP code",
  };
  const POST = await load();
  const res = (await POST(req())) as unknown as { ok: boolean; code: string; details: { missing: string } };

  assert.equal(res.ok, false);
  assert.equal(res.code, "LOCATION_REQUIRED", "the code is the named requirement, not a generic 400");
  assert.equal(res.details.missing, "city, ZIP code", "and the client can route to the step that fixes it");
  assert.equal(ctrl.createArgs.length, 0);
  assert.equal(ctrl.paymentRequiredCalls.length, 0, "a failed gate must not move the request either");
});

test("no open request is refused before anything is minted", async () => {
  ctrl.openRequest = null;
  const POST = await load();
  const res = (await POST(req())) as unknown as { ok: boolean; code: string };

  assert.equal(res.code, "REQUEST_REQUIRED");
  assert.equal(ctrl.createArgs.length, 0, "the $99 activates sourcing for a SPECIFIC request");
});

