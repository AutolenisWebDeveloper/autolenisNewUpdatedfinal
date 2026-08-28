// P0 regression: the terms-acceptance redirect loop.
//
// Root cause (three distinct defects, all fixed together):
//
//  1. SPLIT-BRAIN VERSION RESOLUTION. Six production call sites each resolved
//     the current terms version with their own
//     `process.env.CURRENT_TERMS_VERSION ?? "2026-01-01"` literal — two READ it
//     to decide whether to gate (proxy.ts's edge gate, app/buyer/layout.tsx's
//     server backstop) and four WRITE it (acceptTermsAction, the signup
//     metadata stamp, onboarding-complete, the prequal service). The edge and
//     Node runtimes are configured separately, so an env var set in one and not
//     the other made the writer stamp a value the reader rejected: every buyer
//     gated forever, with accepting re-writing the rejected value. Production
//     resolves to "1.0.0"; the literal fallback matched no stored row at all.
//
//  2. The fallback was a value nothing ever writes, so an unset env var was an
//     unrecoverable lockout instead of a no-op.
//
//  3. Version semantics had to be preserved exactly: a NULL stored version
//     predates version stamping and must stay valid, not be treated as a
//     mismatch that re-gates every legacy buyer.
//
// These prove the single shared predicate in lib/auth/terms — the one both
// gates now call, so they cannot reach opposite conclusions about one buyer.
//
// Run: pnpm test:auth   (globs lib/auth/__tests__/*.test.ts)

import test from "node:test";
import assert from "node:assert/strict";

import {
  FALLBACK_TERMS_VERSION,
  getCurrentTermsVersion,
  needsTermsAcceptance,
} from "../terms";

// env.d.ts types CURRENT_TERMS_VERSION as a required string, so `delete` is a
// type error — assign through the index signature to simulate "unset".
const env = process.env as Record<string, string | undefined>;

function withEnv(value: string | undefined, fn: () => void) {
  const previous = env.CURRENT_TERMS_VERSION;
  env.CURRENT_TERMS_VERSION = value;
  try {
    fn();
  } finally {
    env.CURRENT_TERMS_VERSION = previous;
  }
}

test("getCurrentTermsVersion returns the configured version", () => {
  withEnv("1.0.0", () => {
    assert.equal(getCurrentTermsVersion(), "1.0.0");
  });
});

test("the unset fallback matches the value production actually stamps", () => {
  // Regression for defect 2: the old "2026-01-01" literal matched no stored
  // acceptance row, so a missing env var invalidated every buyer's acceptance.
  // The fallback must equal what production writes, so an unset var degrades to
  // agreeing with existing rows.
  assert.equal(FALLBACK_TERMS_VERSION, "1.0.0");
  withEnv(undefined, () => {
    assert.equal(getCurrentTermsVersion(), "1.0.0");
  });
  withEnv("   ", () => {
    assert.equal(getCurrentTermsVersion(), "1.0.0", "a blank env var must not become the version");
  });
});

test("a buyer who accepted the current version is not re-gated", () => {
  withEnv("1.0.0", () => {
    assert.equal(needsTermsAcceptance(new Date(), "1.0.0"), false);
  });
});

test("a buyer who never accepted is gated", () => {
  withEnv("1.0.0", () => {
    assert.equal(needsTermsAcceptance(null, null), true);
    assert.equal(needsTermsAcceptance(undefined, "1.0.0"), true);
  });
});

test("a buyer who accepted an OLDER version is re-gated", () => {
  withEnv("2.0.0", () => {
    assert.equal(needsTermsAcceptance(new Date(), "1.0.0"), true);
  });
});

test("a NULL stored version stays valid (predates version stamping)", () => {
  // Regression for defect 3 — preserves the semantics of the previous inline
  // checks, which only re-gated when a non-null version differed.
  withEnv("1.0.0", () => {
    assert.equal(needsTermsAcceptance(new Date(), null), false);
    assert.equal(needsTermsAcceptance(new Date(), undefined), false);
  });
});

test("the edge gate and the server backstop cannot disagree about one buyer", () => {
  // Regression for defect 1, expressed as the invariant that actually matters:
  // whatever acceptTermsAction stamps, BOTH gates must then accept — even when
  // the env var is missing in one of the two runtimes.
  //
  // The edge reads an ISO string from Supabase user_metadata; the layout reads a
  // Date from Prisma. Both go through the same predicate, so the only way they
  // could diverge is the version — which is now resolved by one function.
  for (const configured of ["1.0.0", "2026-06-01", undefined]) {
    withEnv(configured, () => {
      const stamped = getCurrentTermsVersion(); // what acceptTermsAction writes
      const acceptedAt = new Date();

      const edgeGate = needsTermsAcceptance(acceptedAt.toISOString(), stamped);
      const layoutGate = needsTermsAcceptance(acceptedAt, stamped);

      assert.equal(edgeGate, false, `edge gate re-gated its own stamp (env=${configured})`);
      assert.equal(layoutGate, false, `layout gate re-gated its own stamp (env=${configured})`);
      assert.equal(edgeGate, layoutGate, `gates disagreed (env=${configured})`);
    });
  }
});

test("accepting under one runtime's config is honoured by the other runtime", () => {
  // The precise production scenario: the Node server (which runs
  // acceptTermsAction) has CURRENT_TERMS_VERSION set, the edge does not — or
  // vice versa. Before the fix the two resolved different values and the buyer
  // looped forever. Now the unset side falls back to the same value the set
  // side uses in production, so the acceptance survives the crossing.
  let stampedByServer = "";
  withEnv("1.0.0", () => {
    stampedByServer = getCurrentTermsVersion();
  });
  withEnv(undefined, () => {
    assert.equal(
      needsTermsAcceptance(new Date().toISOString(), stampedByServer),
      false,
      "an edge runtime missing the env var must not reject the server's own stamp",
    );
  });
});
