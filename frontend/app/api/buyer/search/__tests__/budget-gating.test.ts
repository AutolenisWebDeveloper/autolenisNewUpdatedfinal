// Truthfulness regression for GET /api/buyer/search.
//
// Regression target: the budget ceiling was gated on the mere EXISTENCE of a
// PreQualification row, not on that prequal being APPROVED. A PENDING /
// MANUAL_REVIEW row carries maxOtdAmountCents = 0, so a buyer whose prequal was
// still undetermined got `priceCents <= 0` pushed into the inventory query and
// a UI banner reading "Showing vehicles within your $0 pre-qualified budget".
// That presents an undetermined budget as an APPROVED budget of zero, and
// filters out every vehicle on the platform.
//
// The correct gate is `isPrequalValid()` — APPROVED and unexpired. This asserts
// the ceiling is enforced exactly when a prequal is genuinely valid, and that no
// budget is ever fabricated when it is not.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/search/__tests__/budget-gating.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

// The prequal row the route will read for the current test.
let prequalRow: {
  decision: string;
  expiresAt: Date;
  maxOtdAmountCents: number;
} | null = null;

// The `where` clause the route actually pushed into the inventory query.
let capturedWhere: Record<string, unknown> | null = null;

const prismaMock = {
  preQualification: {
    findUnique: async () => prequalRow,
  },
  inventoryItem: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      // Only capture the primary search query, not the local-dealer probe.
      if (capturedWhere === null) capturedWhere = where;
      return [];
    },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: BUYER_ID, zip: null }),
    successResponse: (data: unknown) =>
      new Response(JSON.stringify({ ok: true, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    errorResponse: (code: string, message: string, status: number) =>
      new Response(JSON.stringify({ ok: false, code, message }), { status }),
  },
});

async function search(query = ""): Promise<{
  budgetGuarded: boolean;
  maxBudgetCents: number | null;
}> {
  const { GET } = await import("@/app/api/buyer/search/route");
  const res = await GET(new NextRequest(`https://app.test/api/buyer/search${query}`));
  const body = (await res.json()) as { data: { budgetGuarded: boolean; maxBudgetCents: number | null } };
  return body.data;
}

/** The price ceiling the route pushed into the DB query, if any. */
function priceCeiling(): number | undefined {
  const p = capturedWhere?.priceCents as { lte?: number } | undefined;
  return p?.lte;
}

beforeEach(() => {
  capturedWhere = null;
  prequalRow = null;
});

// ── The bug: a pending prequal must not become a $0 approved budget ──────────

for (const decision of ["PENDING", "MANUAL_REVIEW", "OFAC_REVIEW", "OFAC_ESCALATED"]) {
  test(`${decision} prequal ⇒ no budget claimed and no $0 price filter`, async () => {
    prequalRow = { decision, expiresAt: FUTURE, maxOtdAmountCents: 0 };
    const data = await search();

    assert.equal(
      data.maxBudgetCents,
      null,
      "an undetermined prequal has no budget — 0 would be reported to the UI as an approved $0",
    );
    assert.equal(data.budgetGuarded, false, "no approved ceiling exists to guard against");
    assert.equal(
      priceCeiling(),
      undefined,
      "a pending prequal must not push `priceCents <= 0` and filter out all inventory",
    );
  });
}

test("DECLINED prequal ⇒ no fabricated $0 budget either", async () => {
  prequalRow = { decision: "DECLINED", expiresAt: FUTURE, maxOtdAmountCents: 0 };
  const data = await search();
  assert.equal(data.maxBudgetCents, null);
  assert.equal(data.budgetGuarded, false);
  assert.equal(priceCeiling(), undefined);
});

test("no prequal at all ⇒ unchanged behaviour (no ceiling)", async () => {
  prequalRow = null;
  const data = await search();
  assert.equal(data.maxBudgetCents, null);
  assert.equal(data.budgetGuarded, false);
  assert.equal(priceCeiling(), undefined);
});

test("EXPIRED approval ⇒ not a live budget, no ceiling enforced", async () => {
  prequalRow = { decision: "APPROVED", expiresAt: PAST, maxOtdAmountCents: 7_500_000 };
  const data = await search();
  assert.equal(data.maxBudgetCents, null, "an expired approval is not a current budget");
  assert.equal(data.budgetGuarded, false);
  assert.equal(priceCeiling(), undefined);
});

test("anomalous APPROVED row with a zero amount ⇒ no $0 ceiling is enforced", async () => {
  prequalRow = { decision: "APPROVED", expiresAt: FUTURE, maxOtdAmountCents: 0 };
  const data = await search();
  assert.equal(data.maxBudgetCents, null, "zero is never a real budget");
  assert.equal(
    priceCeiling(),
    undefined,
    "a zero ceiling would filter the whole catalogue out — treat it as no ceiling",
  );
});

// ── The approved path must be entirely unchanged ─────────────────────────────

test("valid APPROVED prequal ⇒ ceiling enforced server-side (unchanged)", async () => {
  prequalRow = { decision: "APPROVED", expiresAt: FUTURE, maxOtdAmountCents: 7_500_000 };
  const data = await search();
  assert.equal(data.maxBudgetCents, 7_500_000);
  assert.equal(data.budgetGuarded, true);
  assert.equal(priceCeiling(), 7_500_000, "the approved ceiling is applied to the query");
});

test("a client-supplied priceMax can lower, but never raise, the approved ceiling", async () => {
  prequalRow = { decision: "APPROVED", expiresAt: FUTURE, maxOtdAmountCents: 7_500_000 };
  await search("?priceMax=999999");
  assert.equal(
    priceCeiling(),
    7_500_000,
    "a client must never be able to exceed the approved budget",
  );

  capturedWhere = null;
  await search("?priceMax=40000");
  assert.equal(priceCeiling(), 4_000_000, "a lower client cap still applies");
});

test("without an approved prequal a client priceMax still applies on its own", async () => {
  prequalRow = { decision: "MANUAL_REVIEW", expiresAt: FUTURE, maxOtdAmountCents: 0 };
  await search("?priceMax=30000");
  assert.equal(
    priceCeiling(),
    3_000_000,
    "the buyer's own filter is honoured even though no approved ceiling exists",
  );
});
