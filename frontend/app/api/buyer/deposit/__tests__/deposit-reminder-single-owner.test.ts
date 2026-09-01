// The $99 deposit-reminder chain has exactly ONE enrollment owner:
// POST /api/buyer/deposit/create-intent.
//
// POST /api/buyer/onboarding/complete used to enroll too, and that second owner
// was load-bearing in the wrong direction. Onboarding finishes BEFORE the buyer
// can reach checkout (the wizard routes to /buyer/prequal), so at enrollment
// there is no deposit intent to abandon. Once touch 1 became immediate, the
// send-time guard (depositConversionResolved) saw no deposit on the drain's next
// pass and cancelled it — and the cancelled row then blocked the real
// create-intent enrollment, because enqueueLifecycleTouch upserts with
// ignoreDuplicates on UNIQUE(base_key, sequence) and both call sites share the
// base_key `deposit-reminder:{buyerId}`. Net effect: the buyer received NONE of
// the six touches. The +1h first-touch delay had been masking this.
//
// Dropping the onboarding enrollment also closes a leak: onboarding/complete had
// no concierge check, unlike create-intent, so any concierge buyer routed through
// onboarding was enrolled in the generic "$99 deposit" sequence that create-intent
// deliberately withholds from them (see create-intent-enrollment.test.ts #2).
// (Which concierge buyers traverse onboarding was NOT verified — the point stands
// either way: the exclusion belongs on one enrollment path, and now there is one.)
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/deposit/__tests__/deposit-reminder-single-owner.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const BUYER_EMAIL = "buyer@example.com";

let enrollCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({
      id: BUYER_ID,
      firstName: "Sam",
      lastName: "Buyer",
      user: { email: BUYER_EMAIL },
    }),
    successResponse: (data: unknown) => ({ ok: true, data }),
    errorResponse: (code: string, message: string, status: number) => ({ ok: false, code, message, status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        update: async () => ({ onboardingComplete: true, termsAcceptedAt: new Date(), termsVersion: "2026-01-01" }),
        findUnique: async () => ({ firstName: "Sam", lastName: "Buyer" }),
      },
    },
  },
});

mock.module("@/lib/services/crm/lifecycle-scheduler", {
  namedExports: {
    scheduleLifecycleWorkload: async (input: Record<string, unknown>) => { enrollCalls.push(input); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://autolenis.com/api/buyer/onboarding/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { enrollCalls = []; });

test("onboarding/complete still completes onboarding", async () => {
  const { POST } = await import("@/app/api/buyer/onboarding/complete/route");
  const res = (await POST(req({ accepted: true }))) as { ok: boolean; data?: Record<string, unknown> };
  assert.equal(res.ok, true, "the route's own job is unaffected");
  assert.equal(res.data?.onboardingComplete, true);
});

test("onboarding/complete does NOT enroll the deposit-reminder chain", async () => {
  const { POST } = await import("@/app/api/buyer/onboarding/complete/route");
  await POST(req({ accepted: true }));

  assert.deepEqual(
    enrollCalls.filter((c) => c.workload === "deposit_reminder"),
    [],
    "enrolling here burns the touch-1 slot before a checkout exists to abandon, " +
      "and the cancelled row then blocks the real create-intent enrollment",
  );
});

// ── Single-owner invariant, as an executable guard ──────────────────────────
// Prose cannot stop a third call site appearing. This can: it scans app/ for
// deposit_reminder enrollments and fails on any outside create-intent.

test("create-intent is the ONLY buyer-facing enroller of deposit_reminder", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");

  const ROOT = process.cwd();
  const OWNER = "app/api/buyer/deposit/create-intent/route.ts";
  const SKIP = new Set(["node_modules", ".next", "__tests__", "e2e", ".git"]);

  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
    }
  })(join(ROOT, "app"));

  const offenders: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === OWNER) continue;
    const src = readFileSync(file, "utf8");
    const idx = src.indexOf('workload: "deposit_reminder"');
    if (idx !== -1) offenders.push(`${rel}:${src.slice(0, idx).split("\n").length}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `deposit_reminder must be enrolled only from ${OWNER}. A second enroller races for the same ` +
      `base_key (deposit-reminder:{buyerId}); whichever writes touch 1 first owns the row, and if ` +
      `its guard cancels, UNIQUE(base_key, sequence) silently swallows the other. Offenders: ${offenders.join(", ")}`,
  );
});
