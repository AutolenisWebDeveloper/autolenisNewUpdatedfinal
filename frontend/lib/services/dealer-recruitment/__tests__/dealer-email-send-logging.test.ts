// Phase 2 — every dealer outreach ATTEMPT leaves exactly one durable log row.
//
// The defect this proves fixed: dealerOutreachLog.create sat at the END of
// sendDealerEmail, after seven early returns. Six of those returns are real
// attempts that were rejected by a gate, and they left NO row at all. The only
// observable consequence was an empty dealer_outreach_log — which reads as
// "outreach was never attempted" when the truth is "outreach was attempted and
// blocked". That ambiguity is why a production misconfiguration went unnoticed:
// there was no signal to notice.
//
// The invariant now under test: for any prospect that exists and is not already
// logged for this step, sendDealerEmail writes EXACTLY ONE row whose terminal
// status and errorMessage name the gate that rejected it — and a rejected
// attempt still never reaches the provider.
//
// Two returns legitimately write no NEW row, and both are asserted below rather
// than left implicit:
//   - not_found      — dealerProspectId is a required FK to dealer_prospects, so
//                      a row for a nonexistent prospect cannot be written at all.
//   - already_contacted — writing a second row would break the one-row-per
//                      (prospect, step, channel) idempotency guarantee; it
//                      returns the EXISTING row's id instead.
//
// Run with:
//   pnpm exec tsx --test --experimental-test-module-mocks \
//     lib/services/dealer-recruitment/__tests__/dealer-email-send-logging.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {}, defaultExport: {} });
mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({}) },
});

// ─── controllable gate state, reset per test ────────────────────────────────
let suppressed = false;
let deliverability: { deliverable: boolean; reason: string } = { deliverable: true, reason: "mx_ok" };
let hourCount = 0;
let prospectRow: Record<string, unknown> | null = null;
let priorLog: { id: string } | null = null;
let providerOutcome: { id: string | null; error: string | null; notConfigured?: boolean } | Error = {
  id: "re_live_1",
  error: null,
};

mock.module("@/lib/services/suppression.service", {
  namedExports: { SuppressionService: { isEmailSuppressed: async () => suppressed } },
});
mock.module("@/lib/services/integrations/email-deliverability.service", {
  namedExports: { verifyEmailDeliverability: async () => deliverability },
});

// ─── the provider seam: proves a blocked attempt never DISPATCHES ───────────
// The old tests used "no log row was created" as the proxy for "nothing was
// sent". That proxy is invalid now that blocked attempts DO log, so dispatch is
// asserted directly against the provider.
//
// The seam is INJECTED, not module-mocked. mock.module("resend", ...) does not
// work here: the service is transformed to CJS and require() bypasses node:test's
// ESM mocking, so the spy records zero calls while the service reaches the LIVE
// Resend API. That was observed in this suite before the seam existed — a real
// provider error came back with the spy at zero calls. Injection makes the
// isolation structural.
const dispatchSpy = mock.fn(async (): Promise<{ id: string | null; error: string | null; notConfigured?: boolean }> => {
  if (providerOutcome instanceof Error) throw providerOutcome;
  return providerOutcome;
});

// ─── fake prisma modelling the row LIFECYCLE, not just the create call ──────
interface LogRow {
  id: string;
  dealerProspectId: string;
  outreachType: string;
  channel: string;
  status: string;
  errorMessage: string | null;
  toEmail: string | null;
  fromEmail: string | null;
  resendId: string | null;
  outreachSequenceStep: number | null;
}
let rows: LogRow[] = [];
let seq = 0;

const prisma = {
  dealerProspect: {
    findUnique: async () => prospectRow,
    updateMany: async () => ({ count: 1 }),
  },
  dealerOutreachLog: {
    findFirst: async () => priorLog,
    count: async () => hourCount,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: LogRow = {
        id: `log_${++seq}`,
        dealerProspectId: String(data.dealerProspectId),
        outreachType: String(data.outreachType),
        channel: String(data.channel),
        status: String(data.status),
        errorMessage: (data.errorMessage as string) ?? null,
        toEmail: (data.toEmail as string) ?? null,
        fromEmail: (data.fromEmail as string) ?? null,
        resendId: (data.resendId as string) ?? null,
        outreachSequenceStep: (data.outreachSequenceStep as number) ?? null,
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`update on missing log row ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma } });

mock.module("../email-template.service", {
  namedExports: {
    generateEmailTemplate: async () => ({ subject: "s", body: "<p>b</p>", bodyText: "b" }),
  },
});
mock.module("../prospect-claim.service", {
  namedExports: { issueProspectClaimToken: async () => null, buildClaimUrl: () => "" },
});
mock.module("../unsubscribe-token.service", {
  namedExports: { buildUnsubscribeUrl: () => null },
});

type SendFn = typeof import("../dealer-email-send.service").sendDealerEmail;
async function loadSend(): Promise<SendFn> {
  const mod = await import("../dealer-email-send.service");
  return mod.sendDealerEmail;
}

/** The single row this attempt produced. Fails loudly on 0 or 2+. */
function theOnlyRow(): LogRow {
  assert.equal(rows.length, 1, `expected exactly one log row, got ${rows.length}`);
  return rows[0];
}

beforeEach(() => {
  process.env.DEALER_OUTREACH_FROM_EMAIL = "dealers@autolenis.invalid";
  process.env.DEALER_OUTREACH_REPLY_TO = "reply@autolenis.invalid";
  process.env.AUTOLENIS_PHYSICAL_ADDRESS = "1 Test St, Dallas TX";
  process.env.RESEND_API_KEY = "re_live_testkey";
  suppressed = false;
  deliverability = { deliverable: true, reason: "mx_ok" };
  hourCount = 0;
  priorLog = null;
  providerOutcome = { id: "re_live_1", error: null };
  prospectRow = {
    id: "p1",
    name: "Toyota of Dallas",
    contactName: null,
    contactTitle: null,
    city: "Dallas",
    state: "TX",
    email: "sales@dealer.invalid",
  };
  rows = [];
  seq = 0;
  dispatchSpy.mock.resetCalls();
});

// ─── the six gates that must now leave a durable row ────────────────────────

test("not_configured writes exactly one failed row naming the missing vars", async () => {
  delete process.env.DEALER_OUTREACH_FROM_EMAIL;
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.success, false);
  assert.equal(r.reason, "not_configured");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /DEALER_OUTREACH_FROM_EMAIL/);
  assert.equal(dispatchSpy.mock.callCount(), 0, "an unconfigured channel must never dispatch");
  assert.equal(r.outreachLogId, row.id, "the caller must receive the row id it can look up");
});

test("no_email writes exactly one failed row", async () => {
  prospectRow = { ...prospectRow, email: null };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "no_email");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.ok(row.errorMessage, "a failure row must carry an error message");
  assert.equal(dispatchSpy.mock.callCount(), 0);
});

test("suppressed writes exactly one failed row and never dispatches", async () => {
  suppressed = true;
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "suppressed");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /suppress/i);
  assert.equal(dispatchSpy.mock.callCount(), 0, "a suppressed address must never be emailed");
});

test("undeliverable writes exactly one failed row and never dispatches", async () => {
  deliverability = { deliverable: false, reason: "no_mx" };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "undeliverable");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /no_mx/);
  assert.equal(dispatchSpy.mock.callCount(), 0, "an undeliverable address must never be emailed");
});

test("rate_limited writes exactly one failed row and never dispatches", async () => {
  hourCount = 999;
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "rate_limited");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /rate limit/i);
  assert.equal(dispatchSpy.mock.callCount(), 0);
});

test("a provider error writes exactly one failed row carrying the provider message", async () => {
  providerOutcome = { id: null, error: "domain not verified" };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "send_error");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /domain not verified/);
  assert.equal(dispatchSpy.mock.callCount(), 1, "the provider WAS reached — that is why it failed");
});

test("a provider throw writes exactly one failed row", async () => {
  providerOutcome = new Error("ECONNRESET");
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "send_error");
  const row = theOnlyRow();
  assert.equal(row.status, "failed");
  assert.match(row.errorMessage ?? "", /ECONNRESET/);
});

// ─── the two returns that legitimately write no NEW row ─────────────────────

test("already_contacted writes NO new row and returns the existing one", async () => {
  priorLog = { id: "log_existing" };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "already_contacted");
  assert.equal(rows.length, 0, "a duplicate attempt must not create a second row");
  assert.equal(r.outreachLogId, "log_existing", "it must point at the row that already exists");
  assert.equal(dispatchSpy.mock.callCount(), 0, "a duplicate must never dispatch a second email");
});

test("not_found writes no row — dealerProspectId is a required FK", async () => {
  prospectRow = null;
  const send = await loadSend();

  const r = await send({ dealerProspectId: "ghost" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "not_found");
  assert.equal(rows.length, 0, "a log row for a nonexistent prospect would violate the FK");
  assert.equal(dispatchSpy.mock.callCount(), 0);
});

// ─── the happy path still terminates correctly ──────────────────────────────

test("a successful send leaves exactly one row marked sent with the provider id", async () => {
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.success, true);
  const row = theOnlyRow();
  assert.equal(row.status, "sent");
  assert.equal(row.resendId, "re_live_1");
  assert.equal(row.toEmail, "sales@dealer.invalid");
  assert.equal(dispatchSpy.mock.callCount(), 1);
});

test("the row records the sequence step so follow-ups are distinguishable", async () => {
  const send = await loadSend();

  await send({ dealerProspectId: "p1", outreachType: "followup_1" }, { dispatch: dispatchSpy });

  assert.equal(theOnlyRow().outreachSequenceStep, 2);
});

test("every attempt is channel 'email' — the channel column is never left blank", async () => {
  suppressed = true;
  const send = await loadSend();

  await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(theOnlyRow().channel, "email");
});

// ─── the config-vs-failure distinction is structural, not textual ───────────
// post-intake-outreach DEFERS a `not_configured` outreach stage but counts
// `send_error` against a bounded retry budget that dead-letters the intake. The
// classification therefore must not depend on a vendor's error wording.

test("a provider missing its credential classifies as not_configured", async () => {
  providerOutcome = { id: null, error: "RESEND_API_KEY not configured", notConfigured: true };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "not_configured");
  assert.equal(theOnlyRow().status, "failed");
});

test("a provider error whose text merely mentions configuration is NOT reclassified", async () => {
  // Without the structural flag this would be misread as a channel-config gap and
  // silently deferred forever instead of counted as the real failure it is.
  providerOutcome = { id: null, error: "sender domain is not configured in your account" };
  const send = await loadSend();

  const r = await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(r.reason, "send_error");
  assert.match(theOnlyRow().errorMessage ?? "", /not configured in your account/);
});

test("a not_configured row does not claim a from address that was never configured", async () => {
  // The row exists to expose the config gap. Recording the send-time fallback
  // here would make an unconfigured channel look configured to whoever reads it.
  delete process.env.DEALER_OUTREACH_FROM_EMAIL;
  const send = await loadSend();

  await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(theOnlyRow().fromEmail, null);
});

test("a real send records the from address it actually used", async () => {
  const send = await loadSend();

  await send({ dealerProspectId: "p1" }, { dispatch: dispatchSpy });

  assert.equal(theOnlyRow().fromEmail, "dealers@autolenis.invalid");
});
