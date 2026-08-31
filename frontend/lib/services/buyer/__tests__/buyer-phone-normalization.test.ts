// Fix 3 (docs/plans/BUYER-LOCATION-GAP.md) — every writer of `buyers.phone`
// must store the E.164 form.
//
// `buyers.phone` is nullable, non-unique and un-indexed, and was stored verbatim
// as typed or as Twilio delivered it. `normalizePhone` exists and is used by 18
// call sites across suppression, CRM, contacts and comms — none of them a Buyer
// write. The consequences are concrete: an inbound STOP arrives as `+15551234567`
// and `updateMany({ where: { phone: from } })` matches zero rows for a buyer
// stored as `(555) 123-4567`, and no phone-based dedup is possible while the
// column holds four spellings of the same number.
//
// The `''` guard matters as much as the normalisation: `normalizePhone` returns
// an empty string for unparseable input, and writing `''` would make every
// unparseable-phone buyer collide with every other one under any future
// equality match. Unparseable must persist as NULL.
//
// One file covers all four writers deliberately — this is a single invariant
// spanning modules, and a per-module test would let a new writer slip in
// unnoticed.
//
// Run: pnpm test:buyer-phone

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Captured `data` payloads from every prisma Buyer write. */
const buyerCreates: Array<Record<string, unknown>> = [];
const buyerUpdates: Array<Record<string, unknown>> = [];

let existingUser: { id: string; buyer: { id: string } | null } | null = null;

const prismaMock = {
  buyer: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      buyerCreates.push(data);
      return { id: "buyer_new", ...data };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      buyerUpdates.push(data);
      return { id: "buyer_1", ...data };
    },
    updateMany: async () => ({ count: 1 }),
    findUnique: async () => null,
  },
  user: {
    findUnique: async () => existingUser,
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "user_new", ...data }),
  },
  vehicleRequest: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "vr_1", ...data }),
  },
  buyerOpportunity: { update: async () => ({}), create: async () => ({ id: "bo_1" }) },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

// Buyer-profile route auth — the route resolves the buyer server-side.
mock.module("@/lib/auth/session", {
  namedExports: {
    requireBuyer: async () => ({
      id: "buyer_1",
      firstName: "Jane",
      lastName: "Doe",
      phone: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      plan: "STANDARD",
      onboardingComplete: true,
      user: { email: "b@example.com" },
    }),
  },
});

// Keep the intake pipeline and voice dispatch free of network/queue work.
mock.module("@/lib/services/acquisition/intake-processor.service", {
  namedExports: { enqueueIntakeProcessing: async () => {} },
});
mock.module("@/lib/services/email/resend.service", {
  namedExports: { sendAdminCreatedBuyerEmail: async () => {} },
});
mock.module("@/lib/supabase-service", {
  namedExports: {
    getServiceSupabase: () => ({}),
    adminSupabase: () => ({
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: "sb_new" } }, error: null }),
          deleteUser: async () => ({}),
        },
      },
    }),
  },
});

beforeEach(() => {
  buyerCreates.length = 0;
  buyerUpdates.length = 0;
  existingUser = null;
});

/** Every phone value written by a Buyer create or update in this test run. */
function writtenPhones(): unknown[] {
  return [...buyerCreates, ...buyerUpdates]
    .filter((d) => "phone" in d)
    .map((d) => d.phone);
}

// ─── Writer 1: PATCH /api/buyer/profile ──────────────────────────────────────

test("PATCH /api/buyer/profile normalises the phone it stores", async () => {
  const { PATCH } = await import("@/app/api/buyer/profile/route");

  const res = await PATCH(
    new Request("http://localhost/api/buyer/profile", {
      method: "PATCH",
      body: JSON.stringify({ phone: "(555) 123-4567" }),
      headers: { "Content-Type": "application/json" },
    }) as never,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(writtenPhones(), ["+15551234567"]);
});

test("PATCH /api/buyer/profile stores NULL — never '' — for an unparseable phone", async () => {
  const { PATCH } = await import("@/app/api/buyer/profile/route");

  await PATCH(
    new Request("http://localhost/api/buyer/profile", {
      method: "PATCH",
      body: JSON.stringify({ phone: "abc" }),
      headers: { "Content-Type": "application/json" },
    }) as never,
  );

  assert.deepEqual(writtenPhones(), [null]);
});

test("PATCH /api/buyer/profile still clears the phone on an explicit empty string", async () => {
  // The partial-update contract (69bfa2b) says an explicit "" clears the field.
  // Normalisation must not turn that into a no-op.
  const { PATCH } = await import("@/app/api/buyer/profile/route");

  await PATCH(
    new Request("http://localhost/api/buyer/profile", {
      method: "PATCH",
      body: JSON.stringify({ phone: "" }),
      headers: { "Content-Type": "application/json" },
    }) as never,
  );

  assert.deepEqual(writtenPhones(), [null]);
});

test("PATCH /api/buyer/profile leaves phone untouched when the caller omits it", async () => {
  const { PATCH } = await import("@/app/api/buyer/profile/route");

  await PATCH(
    new Request("http://localhost/api/buyer/profile", {
      method: "PATCH",
      body: JSON.stringify({ firstName: "Janet" }),
      headers: { "Content-Type": "application/json" },
    }) as never,
  );

  assert.deepEqual(writtenPhones(), [], "an omitted phone must not be written at all");
});

// ─── Writers 2 & 3: unified buyer intake (user-without-buyer, and guest) ─────

test("unified intake normalises the phone when creating a Buyer for an existing User", async () => {
  existingUser = { id: "user_1", buyer: null }; // Case 2 — user exists, no buyer
  const { promoteOpportunity } = await import("@/lib/services/acquisition/unified-buyer-intake.service");

  await promoteOpportunity("opp_1", {
    firstName: "Jane",
    email: "b@example.com",
    phone: "555.123.4567",
  });

  assert.equal(buyerCreates.length, 1);
  assert.equal(buyerCreates[0]!.phone, "+15551234567");
});

test("unified intake normalises the phone when creating a guest Buyer", async () => {
  existingUser = null; // Case 3 — no user at all
  const { promoteOpportunity } = await import("@/lib/services/acquisition/unified-buyer-intake.service");

  await promoteOpportunity("opp_2", {
    firstName: "Jane",
    email: "new@example.com",
    phone: "1-555-123-4567",
  });

  assert.equal(buyerCreates.length, 1);
  assert.equal(buyerCreates[0]!.phone, "+15551234567");
  assert.equal(buyerCreates[0]!.isGuest, true);
});

test("unified intake stores NULL — never '' — for an unparseable phone", async () => {
  existingUser = null;
  const { promoteOpportunity } = await import("@/lib/services/acquisition/unified-buyer-intake.service");

  await promoteOpportunity("opp_3", {
    firstName: "Jane",
    email: "new2@example.com",
    phone: "n/a",
  });

  assert.equal(buyerCreates.length, 1);
  assert.equal(buyerCreates[0]!.phone, null);
});

// ─── Writer 4: voice dispatch ────────────────────────────────────────────────

test("voice dispatch normalises the caller phone when creating a Buyer", async () => {
  existingUser = { id: "user_1", buyer: null };
  const { dispatchVehicleRequest } = await import("@/lib/voice/dispatch-request");

  await dispatchVehicleRequest(
    { firstName: "Jane", lastName: "Doe", email: "v@example.com" } as never,
    "(555) 123-4567",
  );

  assert.equal(buyerCreates.length, 1);
  assert.equal(buyerCreates[0]!.phone, "+15551234567");
});

test("voice dispatch stores NULL — never '' — for an unparseable caller phone", async () => {
  existingUser = { id: "user_1", buyer: null };
  const { dispatchVehicleRequest } = await import("@/lib/voice/dispatch-request");

  await dispatchVehicleRequest(
    { firstName: "Jane", lastName: "Doe", email: "v2@example.com" } as never,
    "anonymous",
  );

  assert.equal(buyerCreates.length, 1);
  assert.equal(buyerCreates[0]!.phone, null);
});

// ─── The invariant, stated once ──────────────────────────────────────────────

test("no Buyer writer ever persists an empty-string phone", async () => {
  // '' would make every unparseable-phone buyer equal to every other one under
  // any equality match, which is strictly worse than NULL.
  for (const phone of writtenPhones()) {
    assert.notEqual(phone, "", "phone must be NULL when unparseable, never ''");
  }
});
