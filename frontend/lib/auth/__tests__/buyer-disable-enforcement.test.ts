// P0 security regression: a DISABLED (or purged) buyer must not retain
// authenticated access through the shared API authorization boundary.
//
// Root cause (Phase 1 C-ADM1): `disableBuyerAccessByAdmin` sets `buyer.disabledAt`,
// but that state was enforced ONLY at the buyer layout (page render). The shared
// API helper `getRequestBuyer` returned the buyer regardless, so all ~53
// `/api/buyer/*` routes (which 401 on a null buyer) still authorized a disabled
// buyer. This proves the shared boundary now denies disabled/purged buyers,
// mirroring the dealer `requireDealerFromRequest` BLOCKED_STATUSES precedent.
//
// Run: pnpm test:auth   (globs lib/auth/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Mock prisma so resolveAuthorizedBuyer runs against controlled rows ───────
const state = {
  buyerRow: null as Record<string, unknown> | null,
  throwOnInclude: false,
};

const prismaMock = {
  buyer: {
    findFirst: async (args: { select?: unknown }) => {
      // The primary path uses `include`; the backward-safe fallback uses `select`.
      if (!args.select && state.throwOnInclude) {
        throw new Error('column "disabled_at" does not exist');
      }
      return state.buyerRow;
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

// Import SUT lazily inside tests (tsx's cjs transform rejects top-level await,
// and mock.module must be registered before @/lib/auth/api loads @/lib/prisma).
async function loadApi() {
  return import("@/lib/auth/api");
}
async function loadStatus() {
  return import("@/lib/auth/buyer-status");
}

beforeEach(() => {
  state.buyerRow = null;
  state.throwOnInclude = false;
});

// ── Pure predicate ───────────────────────────────────────────────────────────
test("isBuyerAccessDisabled: active buyer is NOT disabled", async () => {
  const { isBuyerAccessDisabled } = await loadStatus();
  assert.equal(isBuyerAccessDisabled({ disabledAt: null, purgedAt: null }), false);
});
test("isBuyerAccessDisabled: disabledAt set → disabled", async () => {
  const { isBuyerAccessDisabled } = await loadStatus();
  assert.equal(isBuyerAccessDisabled({ disabledAt: new Date(), purgedAt: null }), true);
});
test("isBuyerAccessDisabled: purgedAt set → disabled", async () => {
  const { isBuyerAccessDisabled } = await loadStatus();
  assert.equal(isBuyerAccessDisabled({ disabledAt: null, purgedAt: new Date() }), true);
});
test("isBuyerAccessDisabled: null buyer → false (not authenticated is a separate concern)", async () => {
  const { isBuyerAccessDisabled } = await loadStatus();
  assert.equal(isBuyerAccessDisabled(null), false);
});

// ── Shared API boundary ──────────────────────────────────────────────────────
test("resolveAuthorizedBuyer: ACTIVE buyer is authorized (unchanged)", async () => {
  state.buyerRow = { id: "b1", disabledAt: null, purgedAt: null, user: {} };
  const { resolveAuthorizedBuyer } = await loadApi();
  const buyer = await resolveAuthorizedBuyer("uid-1");
  assert.equal(buyer?.id, "b1");
});

test("resolveAuthorizedBuyer: DISABLED buyer is denied (returns null → routes 401)", async () => {
  state.buyerRow = { id: "b2", disabledAt: new Date(), purgedAt: null, user: {} };
  const { resolveAuthorizedBuyer } = await loadApi();
  const buyer = await resolveAuthorizedBuyer("uid-2");
  assert.equal(buyer, null);
});

test("resolveAuthorizedBuyer: PURGED buyer is denied (returns null)", async () => {
  state.buyerRow = { id: "b3", disabledAt: null, purgedAt: new Date(), user: {} };
  const { resolveAuthorizedBuyer } = await loadApi();
  const buyer = await resolveAuthorizedBuyer("uid-3");
  assert.equal(buyer, null);
});

test("resolveAuthorizedBuyer: no buyer row → null", async () => {
  state.buyerRow = null;
  const { resolveAuthorizedBuyer } = await loadApi();
  const buyer = await resolveAuthorizedBuyer("uid-none");
  assert.equal(buyer, null);
});

test("resolveAuthorizedBuyer: pre-migration fallback returns buyer (documented fail-open until migration applied)", async () => {
  // When the lifecycle columns are absent the primary include-query throws and
  // the fallback select runs; it cannot read disabledAt, so it returns the buyer
  // with null lifecycle fields. This is the documented prod-dependency: full
  // enforcement REQUIRES migration 20260603000000_add_buyer_lifecycle_fields.
  state.throwOnInclude = true;
  state.buyerRow = { id: "b4", user: {} };
  const { resolveAuthorizedBuyer } = await loadApi();
  const buyer = await resolveAuthorizedBuyer("uid-4");
  assert.equal(buyer?.id, "b4");
});
