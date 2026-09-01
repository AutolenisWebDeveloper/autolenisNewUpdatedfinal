// Y1 / MEDIUM-1 — send-time deliverability gate.
//
// sendDealerEmail is the single chokepoint for ALL dealer outreach, so the
// "never cold-email an unverified address" rule is enforced HERE regardless of
// how `email` was populated (Y1 verify-before-persist, admin backfill/re-enrich,
// manual entry). This proves the BEHAVIOR: an undeliverable address is never
// dispatched, and a deliverable address is let through the gate.
//
// PHASE 2 UPDATE — what these tests assert changed, and it is not a relaxation.
// They previously used "no outreach-log row was created" as the proxy for
// "nothing was sent". That proxy is now invalid: a blocked attempt DOES write a
// row, deliberately, because the absence of rows made a blocked send
// indistinguishable from a send never attempted. The safety property is
// unchanged and is now asserted DIRECTLY against the provider seam (dispatchSpy
// call count), which is strictly stronger than inferring it from a side effect.
//
// The send service uses top-level (non-injected) imports, and several of them
// (prospect-claim / unsubscribe-token / supabase-service) pull in `server-only`,
// which throws at import under tsx. So we mock.module those imports. Requires the
// --experimental-test-module-mocks flag (base `test` script provides it).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/dealer-email-send-gate.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Neutralize server-only (imported transitively by claim/unsubscribe/supabase).
mock.module("server-only", { namedExports: {}, defaultExport: {} });
// Stub the Supabase service so isSuppressed()'s getServiceSupabase() never runs
// real code needing env; suppression itself is stubbed below.
mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({}) },
});
mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: { isEmailSuppressed: async () => false },
  },
});

// Controllable deliverability result, reset per test.
let deliverability: { deliverable: boolean; reason: string } = {
  deliverable: true,
  reason: "mx_ok",
};
const verifySpy = mock.fn(async () => deliverability);
mock.module("@/lib/services/integrations/email-deliverability.service", {
  namedExports: { verifyEmailDeliverability: verifySpy },
});

// Fake prisma. create/count are spies so we can assert whether the send got past
// the deliverability gate (a queued log row is only created AFTER the gate).
const prospectRow = {
  id: "p1",
  name: "Toyota of Dallas",
  contactName: null,
  contactTitle: null,
  city: "Dallas",
  state: "TX",
  email: "sales@toyotaofdallas.com",
};
const createSpy = mock.fn(async () => ({ id: "log_1" }));
const prisma = {
  dealerProspect: {
    findUnique: async () => prospectRow,
    updateMany: async () => ({ count: 0 }),
  },
  dealerOutreachLog: {
    findFirst: async () => null, // no prior send (idempotency passes)
    count: async () => 0, // rate limit passes
    create: createSpy,
    update: async () => ({}),
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma } });

// Injected provider seam. NOT mock.module("resend", ...) — the service is
// transformed to CJS, so require() bypasses node:test's ESM mocking and the
// service would reach the LIVE Resend API while the spy recorded zero calls.
// Injection is what keeps this suite off the network.
const dispatchSpy = mock.fn(async () => ({ id: "prov_1", error: null }));

// Isolate the send from the AI template + claim/unsubscribe internals so the
// deliverable-path test is hermetic (no Groq fallback latency, no swallowed
// claim-token throw). These are only reached AFTER the gate, so the gate test
// itself doesn't need them — this just keeps the happy-path assertion clean.
mock.module("../email-template.service", {
  namedExports: {
    generateEmailTemplate: async () => ({
      subject: "Compete for local buyers",
      body: "<p>hi</p>",
      bodyText: "hi",
    }),
  },
});
mock.module("../prospect-claim.service", {
  namedExports: {
    issueProspectClaimToken: async () => null, // no CTA appended
    buildClaimUrl: () => "",
  },
});
mock.module("../unsubscribe-token.service", {
  namedExports: { buildUnsubscribeUrl: () => null },
});

// Import AFTER mocks are registered. Done lazily inside each test because
// top-level await isn't supported under the CJS transform tsx uses here.
type SendFn = typeof import("../dealer-email-send.service").sendDealerEmail;
async function loadSend(): Promise<SendFn> {
  const mod = await import("../dealer-email-send.service");
  return mod.sendDealerEmail;
}

beforeEach(() => {
  // Required env so the domain-config gate passes; RESEND_API_KEY is a
  // placeholder so getResend() returns null and no real network call is made.
  process.env.DEALER_OUTREACH_FROM_EMAIL = "dealers@autolenis.com";
  process.env.DEALER_OUTREACH_REPLY_TO = "markist@skaipay.com";
  process.env.AUTOLENIS_PHYSICAL_ADDRESS = "1 Test St, Dallas TX";
  process.env.RESEND_API_KEY = "re_placeholder_test";
  createSpy.mock.resetCalls();
  verifySpy.mock.resetCalls();
  dispatchSpy.mock.resetCalls();
  deliverability = { deliverable: true, reason: "mx_ok" };
});

test("an undeliverable address is never dispatched, and the block is recorded", async () => {
  deliverability = { deliverable: false, reason: "no_mx" };
  const sendDealerEmail = await loadSend();

  const result = await sendDealerEmail({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /not deliverable/i);
  assert.match(result.error ?? "", /no_mx/);
  // THE safety property, asserted directly rather than inferred: the provider is
  // never reached for an address that failed the deliverability gate.
  assert.equal(dispatchSpy.mock.callCount(), 0, "an undeliverable address must never be dispatched");
  assert.equal(verifySpy.mock.callCount(), 1, "the deliverability check must run");
  // And the rejection is now observable instead of silent.
  assert.equal(createSpy.mock.callCount(), 1, "a blocked attempt must leave exactly one row");
});

test("an unconfigured email channel returns reason 'not_configured' (never a genuine send error)", async () => {
  // A missing required env var must classify the SAME as a missing/placeholder
  // RESEND_API_KEY: `not_configured` (a channel-config gap), so post-intake-outreach
  // DEFERS the required outreach stage rather than counting it a genuine send error
  // that dead-letters a recoverable intake.
  delete process.env.DEALER_OUTREACH_FROM_EMAIL;
  const sendDealerEmail = await loadSend();

  const result = await sendDealerEmail({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(result.success, false);
  assert.equal(result.reason, "not_configured");
  assert.match(result.error ?? "", /not configured/i);
  assert.equal(dispatchSpy.mock.callCount(), 0, "an unconfigured channel must never dispatch");
  assert.equal(verifySpy.mock.callCount(), 0, "config gate short-circuits before deliverability");
  // The config gate now runs AFTER the prospect load so its rejection can be
  // attributed to a prospect and recorded. This is the fix for the failure mode
  // where a misconfigured channel produced no evidence anywhere.
  assert.equal(createSpy.mock.callCount(), 1, "an unconfigured channel must leave exactly one row");
});

test("a deliverable address passes the gate and reaches the provider", async () => {
  deliverability = { deliverable: true, reason: "mx_ok" };
  const sendDealerEmail = await loadSend();

  const result = await sendDealerEmail({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  // The gate let it through, proven at the provider rather than by a side effect.
  assert.equal(dispatchSpy.mock.callCount(), 1, "a deliverable address must reach dispatch");
  assert.equal(result.success, true);
  assert.doesNotMatch(result.error ?? "", /not deliverable/i);
});
