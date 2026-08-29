// AFFILIATE ACCESS IS OPEN — no approval gate, no onboarding gate.
//
// This file previously pinned the onboarding gate (NOT_STARTED affiliates
// redirected to the wizard from "gated" pages). That gate is REMOVED by owner
// decision: an affiliate is auto-approved at registration and must be able to
// reach every portal surface immediately. These tests now pin the OPPOSITE, so
// a future change that reintroduces a gate fails here:
//   • no portal route redirects on ANY onboarding status, including
//     NOT_STARTED, a missing review row, and a degraded read;
//   • the session helper still reports onboardingStatus (for non-blocking
//     nudges) but never throws a redirect;
//   • the sidebar exposes no locked/gated destinations;
//   • SUSPENDED/REJECTED remain enforced — those are revocations (the abuse
//     kill switch), not approval gates.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/onboarding-gate.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

interface Ctrl {
  reviewStatus: string | null; // null = no row
  reviewThrows: boolean;
  pathname: string;
  affiliateStatus: string;
}
let ctrl: Ctrl;

class RedirectSignal extends Error {
  constructor(public readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
  }
}

mock.module("@/lib/supabase", {
  namedExports: {
    createServerSupabaseClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "sb_aff_1" } } }) },
    }),
    createServiceSupabaseClient: () => ({}),
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      affiliate: {
        findFirst: async () => ({
          id: "aff_1",
          status: ctrl.affiliateStatus,
          user: { email: "a@x.com" },
        }),
      },
      affiliateOnboardingReview: {
        findUnique: async () => {
          if (ctrl.reviewThrows) throw new Error("degraded read");
          return ctrl.reviewStatus ? { status: ctrl.reviewStatus } : null;
        },
      },
    },
  },
});
mock.module("next/headers", {
  namedExports: {
    headers: async () => new Headers({ "x-pathname": ctrl.pathname }),
    cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
  },
});
mock.module("next/navigation", {
  namedExports: {
    redirect: (target: string): never => {
      throw new RedirectSignal(target);
    },
  },
});

beforeEach(() => {
  ctrl = {
    reviewStatus: null,
    reviewThrows: false,
    pathname: "/affiliate/portal/earnings",
    affiliateStatus: "ACTIVE",
  };
});

async function gate() {
  return import("@/lib/auth/affiliate-session");
}

const PORTAL_DIR = path.join(process.cwd(), "app/affiliate/portal");
function filesystemPortalRoutes(): string[] {
  return fs
    .readdirSync(PORTAL_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PORTAL_DIR, entry.name, "page.tsx")))
    .map((entry) => `/affiliate/portal/${entry.name}`);
}

test("NO portal route redirects for a NOT_STARTED affiliate — every page is reachable", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  for (const route of filesystemPortalRoutes()) {
    ctrl.pathname = route;
    ctrl.reviewStatus = null; // NOT_STARTED: no review row at all
    const result = await requireAffiliateWithOnboarding();
    assert.equal(result.affiliate.id, "aff_1", `${route} must resolve, not redirect`);
    assert.equal(result.onboardingStatus, "NOT_STARTED");
  }
});

test("no onboarding status blocks access — every status passes every page", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "NEEDS_CORRECTION", "APPROVED", "REJECTED"]) {
    ctrl.reviewStatus = status;
    ctrl.pathname = "/affiliate/portal/finance";
    const result = await requireAffiliateWithOnboarding();
    assert.equal(result.onboardingStatus, status, `${status} must pass through, not redirect`);
  }
});

test("a degraded review read never blocks — it reports NOT_STARTED and lets the affiliate through", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  ctrl.reviewThrows = true;
  ctrl.pathname = "/affiliate/portal/finance";
  const result = await requireAffiliateWithOnboarding();
  assert.equal(result.onboardingStatus, "NOT_STARTED");
  assert.equal(result.affiliate.id, "aff_1");
});

test("the session helper exports no onboarding exempt-path list (the gate is gone)", async () => {
  const mod = await gate();
  assert.equal(
    (mod as Record<string, unknown>).ONBOARDING_EXEMPT_PATHS,
    undefined,
    "ONBOARDING_EXEMPT_PATHS must not exist — its presence implies a gate",
  );
});

test("the sidebar exposes no locked/gated destinations", async () => {
  const { NAV_ITEMS } = await import("@/components/affiliate/AffiliateSidebar");
  for (const item of NAV_ITEMS) {
    assert.equal(
      (item as Record<string, unknown>).gated,
      undefined,
      `${item.href} still carries a gated flag — nav must not lock destinations`,
    );
  }
  // Check the affordance itself (a Lock glyph or a `locked` binding driving
  // className/aria), not the word in prose.
  const src = fs.readFileSync(path.join(process.cwd(), "components/affiliate/AffiliateSidebar.tsx"), "utf8");
  assert.ok(!/<Lock\b/.test(src), "sidebar must not render a Lock icon");
  assert.ok(!/\blocked\s*[=?]/.test(src), "sidebar must not branch on a `locked` binding");
  assert.ok(!/onboardingRequired/.test(src), "sidebar must not take an onboardingRequired prop");
});

test("every sidebar destination is a real filesystem route (no dead links)", async () => {
  const { NAV_ITEMS } = await import("@/components/affiliate/AffiliateSidebar");
  const routes = filesystemPortalRoutes();
  for (const item of NAV_ITEMS) {
    assert.ok(routes.includes(item.href), `nav item ${item.href} has no page.tsx`);
  }
});

test("SUSPENDED and REJECTED are still enforced — revocation is not an approval gate", async () => {
  const { requireAffiliate } = await gate();
  for (const [status, reason] of [["SUSPENDED", "suspended"], ["REJECTED", "rejected"]]) {
    ctrl.affiliateStatus = status;
    await assert.rejects(requireAffiliate(), (e: unknown) => {
      assert.ok(e instanceof RedirectSignal);
      assert.equal(e.target, `/affiliate/unsubscribed?reason=${reason}`);
      return true;
    });
  }
});

test("a PENDING legacy account has full portal access (no approval needed)", async () => {
  const { requireAffiliate, requireAffiliateWithOnboarding } = await gate();
  ctrl.affiliateStatus = "PENDING"; // legacy rows created before auto-approval
  const affiliate = await requireAffiliate();
  assert.equal(affiliate.id, "aff_1");
  ctrl.pathname = "/affiliate/portal/finance";
  const result = await requireAffiliateWithOnboarding();
  assert.equal(result.affiliate.id, "aff_1", "a legacy PENDING account must not be blocked");
});
