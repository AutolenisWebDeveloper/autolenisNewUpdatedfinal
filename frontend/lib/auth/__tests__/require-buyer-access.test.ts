// P0 regression: two inescapable redirect loops that locked real production
// accounts out of the buyer portal with no explanation and no way back.
//
// LOOP 1 — no Prisma Buyer row. requireBuyer() redirected an authenticated,
// email-verified Supabase user with role=BUYER to /auth/signin when no Buyer
// row existed. proxy.ts step 9 bounces an authenticated user OFF /auth/signin
// back to their portal (/buyer/dashboard), which lands in requireBuyer again:
//   /buyer/dashboard -> /auth/signin -> /buyer/dashboard -> ...
// Production holds two such accounts (auth-callback provisioning never
// completed). They could never reach the portal, and never saw why.
//
// LOOP 2 — the suspension notice. requireBuyer() redirects a suspended buyer to
// /buyer/suspended, but that page lives under app/buyer/ so app/buyer/layout.tsx
// wraps it and calls requireBuyer() itself:
//   /buyer/suspended -> /buyer/suspended -> ...
// The page author had already guarded the page ("do NOT call requireBuyer()"),
// but a child route cannot opt out of its parent layout, so the guard was
// defeated from above. The layout now returns the suspension page bare.
//
// Run: pnpm test:auth  (globs lib/auth/__tests__/*.test.ts)

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  user: Record<string, unknown> | null;
  buyerRow: Record<string, unknown> | null;
  /** Rows that ensurePrismaUser will "create" — set to simulate a successful heal. */
  healCreates: Record<string, unknown> | null;
  healThrows: boolean;
  ensureCalls: Array<{ supabaseId: string; email: string }>;
}
let ctrl: Ctrl;

class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
    this.name = "RedirectError";
  }
}

mock.module("next/navigation", {
  namedExports: {
    redirect: (to: string) => {
      throw new RedirectError(to);
    },
  },
});

mock.module("@/lib/supabase", {
  namedExports: {
    createServerSupabaseClient: async () => ({
      auth: { getUser: async () => ({ data: { user: ctrl.user } }) },
    }),
    createServiceSupabaseClient: () => ({}),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findFirst: async () => (ctrl.buyerRow ? { ...ctrl.buyerRow } : null),
      },
    },
  },
});

mock.module("@/lib/auth/actions", {
  namedExports: {
    ensurePrismaUser: async (supabaseId: string, email: string) => {
      ctrl.ensureCalls.push({ supabaseId, email });
      if (ctrl.healThrows) throw new Error("provisioning failed");
      // A successful heal makes the row readable on the next lookup — exactly
      // what ensurePrismaUser does in production.
      ctrl.buyerRow = ctrl.healCreates;
      return { id: "u1" };
    },
  },
});

async function loadSession() {
  return import("../session");
}

/** Run requireBuyer and report where it redirected (or that it returned). */
async function callRequireBuyer(): Promise<{ redirectedTo: string | null; buyerId?: string }> {
  const { requireBuyer } = await loadSession();
  try {
    const buyer = await requireBuyer();
    return { redirectedTo: null, buyerId: (buyer as { id: string }).id };
  } catch (err) {
    if (err instanceof RedirectError) return { redirectedTo: err.to };
    throw err;
  }
}

const VERIFIED_BUYER_USER = {
  id: "sb_user_1",
  email: "buyer@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { role: "BUYER", firstName: "Sam", lastName: "Buyer" },
};

beforeEach(() => {
  ctrl = { user: null, buyerRow: null, healCreates: null, healThrows: false, ensureCalls: [] };
});

test("an unauthenticated visitor still goes to sign-in", async () => {
  ctrl.user = null;
  assert.equal((await callRequireBuyer()).redirectedTo, "/auth/signin");
});

test("an unverified email still goes to the verification screen", async () => {
  ctrl.user = { ...VERIFIED_BUYER_USER, email_confirmed_at: null };
  assert.equal((await callRequireBuyer()).redirectedTo, "/auth/verify-email");
});

test("a normal buyer is returned unchanged", async () => {
  ctrl.user = VERIFIED_BUYER_USER;
  ctrl.buyerRow = { id: "buyer_1", isSuspended: false };
  const res = await callRequireBuyer();
  assert.equal(res.redirectedTo, null);
  assert.equal(res.buyerId, "buyer_1");
  assert.equal(ctrl.ensureCalls.length, 0, "a healthy account must not be re-provisioned");
});

test("LOOP 1: a missing Buyer row is healed through the canonical provisioning path", async () => {
  ctrl.user = VERIFIED_BUYER_USER;
  ctrl.buyerRow = null;
  ctrl.healCreates = { id: "buyer_healed", isSuspended: false };

  const res = await callRequireBuyer();
  assert.equal(res.redirectedTo, null, "must not redirect — the account is now usable");
  assert.equal(res.buyerId, "buyer_healed");
  assert.equal(ctrl.ensureCalls.length, 1, "must heal via ensurePrismaUser, not a second code path");
  assert.equal(ctrl.ensureCalls[0].supabaseId, "sb_user_1");
  assert.equal(ctrl.ensureCalls[0].email, "buyer@example.com");
});

test("LOOP 1: when healing fails it must NOT redirect to /auth/signin", async () => {
  // This is the loop itself: proxy.ts step 9 bounces an authenticated user off
  // /auth/signin straight back to /buyer/dashboard, which lands here again.
  ctrl.user = VERIFIED_BUYER_USER;
  ctrl.buyerRow = null;
  ctrl.healCreates = null; // heal "succeeds" but produces nothing readable
  const res = await callRequireBuyer();
  assert.notEqual(res.redirectedTo, "/auth/signin", "redirecting to an auth route re-enters the loop");
  assert.equal(res.redirectedTo, "/auth/unauthorized?reason=account_setup");
});

test("LOOP 1: a thrown provisioning error is also handled, not surfaced as a crash", async () => {
  ctrl.user = VERIFIED_BUYER_USER;
  ctrl.buyerRow = null;
  ctrl.healThrows = true;
  const res = await callRequireBuyer();
  assert.equal(res.redirectedTo, "/auth/unauthorized?reason=account_setup");
});

test("a non-BUYER role is never auto-provisioned a buyer profile", async () => {
  ctrl.user = { ...VERIFIED_BUYER_USER, user_metadata: { role: "AFFILIATE" } };
  ctrl.buyerRow = null;
  const res = await callRequireBuyer();
  assert.equal(ctrl.ensureCalls.length, 0, "must not mint a Buyer row for a non-buyer");
  assert.equal(res.redirectedTo, "/auth/unauthorized?reason=account_setup");
});

test("LOOP 2: a suspended buyer is still routed to the suspension notice", async () => {
  // The redirect is correct and stays; what changed is that app/buyer/layout.tsx
  // no longer re-runs this check for /buyer/suspended itself, so the notice can
  // finally render instead of redirecting to itself forever.
  ctrl.user = VERIFIED_BUYER_USER;
  ctrl.buyerRow = { id: "buyer_1", isSuspended: true };
  assert.equal((await callRequireBuyer()).redirectedTo, "/buyer/suspended");
});

test("the account-setup destination is not an auth route", async () => {
  // AUTH_ROUTES in proxy.ts — the set step 9 bounces authenticated users away
  // from. The recovery destination must not be in it, or the loop returns.
  const AUTH_ROUTES = [
    "/auth/signin",
    "/auth/signup",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/verify-email",
  ];
  const destination = "/auth/unauthorized";
  for (const r of AUTH_ROUTES) {
    assert.ok(
      destination !== r && !destination.startsWith(r + "/"),
      `${destination} must not match auth route ${r}`,
    );
  }
});
