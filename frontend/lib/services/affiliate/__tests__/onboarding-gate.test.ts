// R3/decision 2 (owner-mandated proofs) — the onboarding gate:
//   • every portal route on the FILESYSTEM is either exempt or gated — no
//     phantom exemptions, no unreachable page;
//   • the gate's redirect target is itself exempt — no loop;
//   • a NOT_STARTED affiliate reaches /affiliate/portal/compliance (they may
//     be required to acknowledge compliance before anything else);
//   • a NOT_STARTED affiliate on a gated page lands on the wizard;
//   • a missing review row and a degraded read both behave as NOT_STARTED;
//   • the sidebar's gated flags agree with the server exempt set exactly.
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
          status: "ACTIVE",
          user: { email: "a@x.com" },
          commissions: [],
          children: [],
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
  ctrl = { reviewStatus: null, reviewThrows: false, pathname: "/affiliate/portal/earnings" };
});

async function gate() {
  const mod = await import("@/lib/auth/affiliate-session");
  return mod;
}

const PORTAL_DIR = path.join(process.cwd(), "app/affiliate/portal");
function filesystemPortalRoutes(): string[] {
  return fs
    .readdirSync(PORTAL_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(PORTAL_DIR, entry.name, "page.tsx")))
    .map((entry) => `/affiliate/portal/${entry.name}`);
}

test("every filesystem portal route is exempt or gated; every exemption names a real route", async () => {
  const { ONBOARDING_EXEMPT_PATHS } = await gate();
  const routes = filesystemPortalRoutes();
  assert.ok(routes.length >= 14, `expected the full portal, saw ${routes.length} routes`);
  // No phantom exemptions: each exempt prefix must correspond to a real page.
  for (const exempt of ONBOARDING_EXEMPT_PATHS) {
    assert.ok(routes.includes(exempt), `exempt path ${exempt} has no page.tsx`);
  }
  // P2-3 (second review) — everything non-exempt must enforce the gate in its
  // OWN page module (soft navigation does not re-render the layout). Driven
  // by the FILESYSTEM, not the sidebar, so a gated page that never made it
  // into the nav cannot silently escape. A page whose entire body is a
  // redirect to a gated page inherits that page's gate and is allowed.
  for (const route of routes) {
    const isExempt = ONBOARDING_EXEMPT_PATHS.some((p) => route.startsWith(p));
    if (isExempt) continue;
    const src = fs.readFileSync(path.join(PORTAL_DIR, route.split("/").pop()!, "page.tsx"), "utf8");
    const isRedirectOnly = /redirect\("\/affiliate\/portal\//.test(src) && !src.includes("prisma");
    assert.ok(
      src.includes("requireAffiliateWithOnboarding") || isRedirectOnly,
      `${route}/page.tsx must call requireAffiliateWithOnboarding (or be a pure redirect to a gated page) — the layout gate alone is bypassed by soft navigation`,
    );
  }
});

test("the gate's redirect target is exempt — no loop", async () => {
  const { ONBOARDING_EXEMPT_PATHS } = await gate();
  assert.ok(
    ONBOARDING_EXEMPT_PATHS.some((p) => "/affiliate/portal/onboarding".startsWith(p)),
    "the wizard itself must be exempt or the gate loops",
  );
});

test("NOT_STARTED on a gated page → redirected to the wizard", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  ctrl.reviewStatus = "NOT_STARTED";
  ctrl.pathname = "/affiliate/portal/earnings";
  await assert.rejects(requireAffiliateWithOnboarding(), (e: unknown) => {
    assert.ok(e instanceof RedirectSignal);
    assert.equal(e.target, "/affiliate/portal/onboarding?step=1");
    return true;
  });
});

test("NOT_STARTED reaches /affiliate/portal/compliance (owner-mandated)", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  ctrl.reviewStatus = "NOT_STARTED";
  ctrl.pathname = "/affiliate/portal/compliance";
  const { onboardingStatus } = await requireAffiliateWithOnboarding();
  assert.equal(onboardingStatus, "NOT_STARTED");
});

test("NOT_STARTED reaches dashboard, notifications, resources, profile, settings, onboarding", async () => {
  const { requireAffiliateWithOnboarding, ONBOARDING_EXEMPT_PATHS } = await gate();
  ctrl.reviewStatus = "NOT_STARTED";
  for (const exemptPath of ONBOARDING_EXEMPT_PATHS) {
    ctrl.pathname = exemptPath;
    await requireAffiliateWithOnboarding(); // must not throw
  }
});

test("missing review row behaves as NOT_STARTED (the 1 live affiliate with no row is wizard-gated)", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  ctrl.reviewStatus = null;
  ctrl.pathname = "/affiliate/portal/finance";
  await assert.rejects(requireAffiliateWithOnboarding(), (e: unknown) => e instanceof RedirectSignal);
});

test("degraded review read behaves as NOT_STARTED — lands on the wizard's error state, never a loop", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  ctrl.reviewThrows = true;
  ctrl.pathname = "/affiliate/portal/finance";
  await assert.rejects(requireAffiliateWithOnboarding(), (e: unknown) => {
    assert.ok(e instanceof RedirectSignal);
    assert.equal(e.target, "/affiliate/portal/onboarding?step=1");
    return true;
  });
});

test("IN_PROGRESS (and beyond) passes every page", async () => {
  const { requireAffiliateWithOnboarding } = await gate();
  for (const status of ["IN_PROGRESS", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED"]) {
    ctrl.reviewStatus = status;
    ctrl.pathname = "/affiliate/portal/earnings";
    const result = await requireAffiliateWithOnboarding();
    assert.equal(result.onboardingStatus, status);
  }
});

test("sidebar nav gating mirrors the server exempt set exactly", async () => {
  const { ONBOARDING_EXEMPT_PATHS } = await gate();
  const { NAV_ITEMS } = await import("@/components/affiliate/AffiliateSidebar");
  for (const item of NAV_ITEMS) {
    const serverExempt = ONBOARDING_EXEMPT_PATHS.some((p) => item.href.startsWith(p));
    assert.equal(
      item.gated,
      !serverExempt,
      `${item.href}: sidebar gated=${item.gated} disagrees with server exempt=${serverExempt}`,
    );
  }
});

// P1-2 (review) — the layout is NOT re-rendered on App Router soft
// navigation, so a layout-only gate is bypassed by any sidebar click. Every
// gated page must therefore call requireAffiliateWithOnboarding itself. This
// reads the page sources so a future page that reverts to requireAffiliate()
// fails here instead of silently reopening the bypass.
test("every sidebar destination is a filesystem portal route (the filesystem scan covers all of nav)", async () => {
  const { NAV_ITEMS } = await import("@/components/affiliate/AffiliateSidebar");
  const routes = filesystemPortalRoutes();
  for (const item of NAV_ITEMS) {
    assert.ok(routes.includes(item.href), `nav item ${item.href} has no page.tsx — dead link`);
  }
});
