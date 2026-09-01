// P0 authorization regression: a SUSPENDED buyer retained full write access to
// every /api/buyer/** route.
//
// Suspension was enforced only on PAGES:
//   • requireBuyer() redirects a suspended buyer to /buyer/suspended, and
//   • proxy.ts's suspension gate explicitly excludes /api/buyer/
//       (`!pathname.startsWith("/api/buyer/")`)
// while the shared API boundary (getRequestBuyer -> resolveAuthorizedBuyer)
// checked only isBuyerAccessDisabled — which deliberately ignores isSuspended,
// because folding suspension into it would replace the page redirect with a
// blank access-denied screen.
//
// Net effect: a suspended buyer was locked out of every buyer page while still
// able to drive every buyer mutation directly against the API — deposits, offer
// selection, document uploads, profile changes. Suspension that only hides the
// UI is not suspension.
//
// isBuyerBlockedFromApi is the API-side predicate that closes this without
// disturbing the redirect UX. These prove it, and prove the page-side predicate
// still ignores suspension so /buyer/suspended keeps rendering.
//
// Run: pnpm test:auth   (globs lib/auth/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  buyerRow: null as Record<string, unknown> | null,
  throwOnInclude: false,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findFirst: async (args: { select?: unknown }) => {
          // Primary path uses `include`; the backward-safe fallback uses `select`.
          if (!args.select && state.throwOnInclude) {
            throw new Error('column "disabled_at" does not exist');
          }
          return state.buyerRow;
        },
      },
    },
  },
});

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

const ACTIVE = { id: "b1", isSuspended: false, disabledAt: null, purgedAt: null };
const SUSPENDED = { id: "b1", isSuspended: true, disabledAt: null, purgedAt: null };

test("isBuyerBlockedFromApi: an active buyer is allowed", async () => {
  const { isBuyerBlockedFromApi } = await loadStatus();
  assert.equal(isBuyerBlockedFromApi(ACTIVE), false);
});

test("isBuyerBlockedFromApi: a suspended buyer is blocked", async () => {
  const { isBuyerBlockedFromApi } = await loadStatus();
  assert.equal(isBuyerBlockedFromApi(SUSPENDED), true);
});

test("isBuyerBlockedFromApi: disabled and purged stay blocked", async () => {
  const { isBuyerBlockedFromApi } = await loadStatus();
  assert.equal(isBuyerBlockedFromApi({ isSuspended: false, disabledAt: new Date(), purgedAt: null }), true);
  assert.equal(isBuyerBlockedFromApi({ isSuspended: false, disabledAt: null, purgedAt: new Date() }), true);
});

test("the PAGE predicate still ignores suspension", async () => {
  // If isBuyerAccessDisabled started returning true for a suspended buyer, the
  // buyer layout would render its "Account Access Suspended" panel instead of
  // redirecting to /buyer/suspended, and the dedicated notice page — with its
  // support/appeal path — would become unreachable again.
  const { isBuyerAccessDisabled } = await loadStatus();
  assert.equal(isBuyerAccessDisabled(SUSPENDED), false);
});

test("the API boundary denies a suspended buyer", async () => {
  const { resolveAuthorizedBuyer } = await loadApi();
  state.buyerRow = SUSPENDED;
  assert.equal(
    await resolveAuthorizedBuyer("sb_user_1"),
    null,
    "every /api/buyer/* route 401s on a null buyer — this is the whole enforcement",
  );
});

test("the API boundary still allows an active buyer", async () => {
  const { resolveAuthorizedBuyer } = await loadApi();
  state.buyerRow = ACTIVE;
  const buyer = await resolveAuthorizedBuyer("sb_user_1");
  assert.equal((buyer as { id: string } | null)?.id, "b1");
});

test("suspension is enforced even on the degraded backward-safe path", async () => {
  // When the lifecycle columns are unreadable the fallback select is used. It
  // DOES carry isSuspended, so suspension must still be enforced there even
  // though disabled/purged cannot be.
  const { resolveAuthorizedBuyer } = await loadApi();
  state.throwOnInclude = true;
  state.buyerRow = SUSPENDED;
  assert.equal(await resolveAuthorizedBuyer("sb_user_1"), null);
});

test("the degraded path still allows an active buyer", async () => {
  const { resolveAuthorizedBuyer } = await loadApi();
  state.throwOnInclude = true;
  state.buyerRow = ACTIVE;
  const buyer = await resolveAuthorizedBuyer("sb_user_1");
  assert.equal((buyer as { id: string } | null)?.id, "b1");
});
