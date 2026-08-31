// Fifth fix (docs/plans/BUYER-LOCATION-BACKFILL.md §4) — PATCH
// /api/admin/buyers/[buyerId] must validate state and ZIP the way the
// buyer-facing surfaces do, and must normalise state to the uppercase 2-letter
// form the geocode tables key on.
//
// Lives here (not co-located under the [buyerId] segment) because node:test
// treats "[" as a glob metacharacter; the route is imported via the @/ alias.
//
// Why this is a correctness gate and not a nit: the admin route is the path the
// buyer-location backfill runs through. `lookupCity` keys on `"city,state"`
// lowercased and `lookupZip` slices to the first 5 characters, so `"Texas"` or
// `"787"` both resolve to null in `dealer-invitation.service`. Before this fix
// the schema was a bare `z.string().optional()` on all four fields and
// `updateBuyerProfileByAdmin` spread the payload straight into the update — so
// an admin could save either value, the row would look backfilled, and the
// auction would still invite zero dealers. `app/api/buyer/prequal/route.ts`
// already enforces both regexes; this brings the admin path to parity.
//
// Run: pnpm test:admin-authz

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const buyerUpdates: Array<Record<string, unknown>> = [];
const auditWrites: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          buyerUpdates.push(data);
          return { id: "buyer_1", ...data };
        },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          auditWrites.push(data);
          return { id: "log_1" };
        },
      },
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({
      adminId: "admin_1",
      email: "ops@autolenis.com",
      role: "OPERATIONS_ADMIN",
    }),
    adminSuccess: (data: unknown) => Response.json({ success: true, data }, { status: 200 }),
    adminError: (code: string, message: string, status: number) =>
      Response.json({ success: false, error: { code, message } }, { status }),
  },
});

function patch(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/buyers/buyer_1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function run(body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/admin/buyers/[buyerId]/route");
  const res = await PATCH(patch(body), { params: Promise.resolve({ buyerId: "buyer_1" }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const REASON = "backfill per docs/plans/BUYER-LOCATION-BACKFILL.md";

beforeEach(() => {
  buyerUpdates.length = 0;
  auditWrites.length = 0;
});

// ─── state ───────────────────────────────────────────────────────────────────

test("rejects a full state name — 'Texas' would resolve to null in lookupCity", async () => {
  const { status } = await run({ state: "Texas", reason: REASON });

  assert.equal(status, 400);
  assert.deepEqual(buyerUpdates, [], "nothing may be written when validation fails");
});

test("rejects a 1-letter or 3-letter state", async () => {
  assert.equal((await run({ state: "T", reason: REASON })).status, 400);
  assert.equal((await run({ state: "TXX", reason: REASON })).status, 400);
  assert.deepEqual(buyerUpdates, []);
});

test("rejects a numeric state", async () => {
  assert.equal((await run({ state: "48", reason: REASON })).status, 400);
  assert.deepEqual(buyerUpdates, []);
});

test("accepts a lowercase 2-letter state and stores it uppercased", async () => {
  // lookupCity lowercases both sides, so "tx" would in fact match — but the
  // column is read by other surfaces and the buyer-facing route already
  // uppercases. Parity matters more than the single call site that tolerates it.
  const { status } = await run({ state: "tx", reason: REASON });

  assert.equal(status, 200);
  assert.equal(buyerUpdates.length, 1);
  assert.equal(buyerUpdates[0]!.state, "TX");
});

// ─── zip ─────────────────────────────────────────────────────────────────────

test("rejects a truncated ZIP — '787' would resolve to null in lookupZip", async () => {
  const { status } = await run({ zip: "787", reason: REASON });

  assert.equal(status, 400);
  assert.deepEqual(buyerUpdates, []);
});

test("rejects a non-numeric ZIP", async () => {
  assert.equal((await run({ zip: "ABCDE", reason: REASON })).status, 400);
  assert.deepEqual(buyerUpdates, []);
});

test("accepts a 5-digit ZIP", async () => {
  const { status } = await run({ zip: "75024", reason: REASON });

  assert.equal(status, 200);
  assert.equal(buyerUpdates[0]!.zip, "75024");
});

test("accepts ZIP+4 and stores it — lookupZip slices to the first five", async () => {
  const { status } = await run({ zip: "75024-1234", reason: REASON });

  assert.equal(status, 200);
  assert.equal(buyerUpdates[0]!.zip, "75024-1234");
});

// ─── the whole backfill payload ──────────────────────────────────────────────

test("a well-formed backfill payload is written and audited", async () => {
  const { status } = await run({
    city: "Plano",
    state: "tx",
    zip: "75024",
    reason: REASON,
  });

  assert.equal(status, 200);
  assert.equal(buyerUpdates.length, 1);
  assert.deepEqual(buyerUpdates[0], { city: "Plano", state: "TX", zip: "75024" });

  // The audit row is what makes a backfill reviewable after the fact.
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0]!.action, "BUYER_PROFILE_UPDATED");
  assert.equal(auditWrites[0]!.entityId, "buyer_1");
  assert.equal(auditWrites[0]!.reason, REASON);
});

test("reason stays required — an unaudited profile write is refused", async () => {
  const { status } = await run({ city: "Plano", state: "TX", zip: "75024" });

  assert.equal(status, 400);
  assert.deepEqual(buyerUpdates, []);
  assert.deepEqual(auditWrites, []);
});

test("the reason is never persisted onto the buyer row", async () => {
  await run({ city: "Plano", reason: REASON });

  assert.equal(buyerUpdates.length, 1);
  assert.ok(!("reason" in buyerUpdates[0]!), "reason belongs on the audit row, not the buyer");
});

// ─── the admin edit form's real payload ──────────────────────────────────────

test("the admin edit form still saves a buyer whose location is NULL", async () => {
  // REGRESSION GUARD. AdminBuyerCommandCenter.tsx:249-251 seeds its form from
  // `buyer.city ?? ""` and submits the WHOLE form on every save
  // (`api.patch(..., form)` at :261). For a buyer with NULL location that
  // payload carries city/state/zip as empty strings. A regex that rejects ""
  // would 400 every save for precisely the ten buyers this work exists to fix —
  // including any attempt to correct them through the admin UI.
  const { status, json } = await run({
    firstName: "Sam",
    lastName: "Turner",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    reason: REASON,
  });

  assert.equal(status, 200, `admin form save must not 400 — got ${JSON.stringify(json)}`);
});

test("an empty-string location field is not written as an empty string", async () => {
  await run({ city: "", state: "", zip: "", reason: REASON });

  assert.equal(buyerUpdates.length, 1);
  for (const field of ["city", "state", "zip"] as const) {
    assert.notEqual(buyerUpdates[0]![field], "", `${field} must not persist as an empty string`);
  }
});
