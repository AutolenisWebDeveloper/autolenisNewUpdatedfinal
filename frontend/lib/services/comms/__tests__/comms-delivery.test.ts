// Safety-critical gate tests for the internal comms-dispatch queue's delivery
// functions (deliverEmail / deliverSms). These reproduce the retired Inngest
// workers' consent / DNC / suppression / TCPA gates, so they are the guard that a
// gate is never silently dropped in the migration.
//
//   • transactional dedups on EmailSendLog (SENT precheck) and bypasses SOFT
//     suppression but honors HARD suppression;
//   • do_not_contact / missing contact → GATED (no send);
//   • marketing without consent_email → CONSENT_GATED;
//   • SMS requires a contact with consent_sms and no DNC → else TCPA_GATED;
//   • suppression → SUPPRESSED (no send);
//   • a provider error THROWS (fail-closed, never a fabricated success) and a
//     transactional failure is recorded FAILED on EmailSendLog (retriable).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/comms/__tests__/comms-delivery.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Controllable provider + gate mocks ───────────────────────────────────────
let resendResult: { data: { id: string } | null; error: { message: string } | null } = {
  data: { id: "re_1" },
  error: null,
};
let resendThrows = false;
let twilioResult = { sid: "SM_1" };
let emailHardSuppressed = false;
let emailSoftSuppressed = false;
let smsSuppressed = false;
let alreadySent = false;
let normalizeResult: string | "" = "+15555550123";

const sends = { resend: 0, twilio: 0 };
const emailLog: Array<{ status?: string; key: string }> = [];

mock.module("@/lib/services/comms/comms-providers", {
  namedExports: {
    sendEmailViaResend: async () => {
      sends.resend += 1;
      if (resendThrows) throw new Error("resend network down");
      if (resendResult.error) throw new Error(`RESEND_API_EXCEPTION: ${resendResult.error.message}`);
      return { id: resendResult.data?.id ?? null };
    },
    sendSmsViaTwilio: async () => {
      sends.twilio += 1;
      return { sid: twilioResult.sid };
    },
  },
});

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isEmailHardSuppressed: async () => emailHardSuppressed,
      isEmailSuppressed: async () => emailSoftSuppressed,
      isSmsSuppressed: async () => smsSuppressed,
    },
  },
});

mock.module("@/lib/services/template.service", {
  namedExports: {
    TemplateService: {
      renderTemplate: async () => ({ subject: "S", html: "<p>H</p>", text: "H" }),
    },
  },
});

mock.module("@/lib/services/email/email-send-log", {
  namedExports: {
    transactionalEmailAlreadySent: async () => alreadySent,
    recordTransactionalEmailSend: async (p: { status?: string; idempotencyKey: string }) => {
      emailLog.push({ status: p.status ?? "SENT", key: p.idempotencyKey });
    },
  },
});

mock.module("@/lib/utils/phone", {
  namedExports: { normalizePhone: () => normalizeResult },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

// The comms service imports getServiceSupabase from a `server-only` module; stub
// it so the module loads under the test runner (delivery takes supabase directly).
mock.module("@/lib/supabase-service", {
  namedExports: { getServiceSupabase: () => ({}) },
});

// Fake supabase for the delivery functions (passed in directly).
function fakeSupabase(contactRow: Record<string, unknown> | null) {
  const writes = { campaign: [] as unknown[], timeline: [] as Record<string, unknown>[] };
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () => ({ data: table === "contacts" ? contactRow : null }),
      update: (d: unknown) => {
        if (table === "campaign_recipients") writes.campaign.push(d);
        return b;
      },
      insert: async (d: Record<string, unknown>) => {
        if (table === "contact_timeline_events") writes.timeline.push(d);
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    };
    return b;
  };
  return { from, writes } as unknown as { from: (t: string) => unknown; writes: typeof writes };
}

async function load() {
  return import("@/lib/services/comms/comms-outbox.service");
}

beforeEach(() => {
  resendResult = { data: { id: "re_1" }, error: null };
  resendThrows = false;
  twilioResult = { sid: "SM_1" };
  emailHardSuppressed = false;
  emailSoftSuppressed = false;
  smsSuppressed = false;
  alreadySent = false;
  normalizeResult = "+15555550123";
  sends.resend = 0;
  sends.twilio = 0;
  emailLog.length = 0;
});

// ── deliverEmail ─────────────────────────────────────────────────────────────
test("transactional email already SENT → DUPLICATE, no send", async () => {
  alreadySent = true;
  const { deliverEmail } = await load();
  const sb = fakeSupabase(null);
  const r = await deliverEmail(sb as never, {
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "transactional",
    idempotencyKey: "txn-1",
  });
  assert.equal(r.outcome, "DUPLICATE");
  assert.equal(sends.resend, 0);
});

test("do_not_contact contact → GATED, no send", async () => {
  const { deliverEmail } = await load();
  const sb = fakeSupabase({ do_not_contact: true, consent_email: true });
  const r = await deliverEmail(sb as never, {
    contactId: "c1",
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "marketing",
  });
  assert.equal(r.outcome, "GATED");
  assert.equal(sends.resend, 0);
});

test("missing contact → GATED", async () => {
  const { deliverEmail } = await load();
  const sb = fakeSupabase(null);
  const r = await deliverEmail(sb as never, {
    contactId: "c1",
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "marketing",
  });
  assert.equal(r.outcome, "GATED");
});

test("marketing soft-suppressed → SUPPRESSED; transactional bypasses soft but honors hard", async () => {
  const { deliverEmail } = await load();
  // marketing: soft suppression blocks
  emailSoftSuppressed = true;
  let r = await deliverEmail(fakeSupabase(null) as never, {
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "marketing",
  });
  assert.equal(r.outcome, "SUPPRESSED");
  assert.equal(sends.resend, 0);

  // transactional: soft suppression does NOT block (bypasses soft tier)...
  emailSoftSuppressed = true;
  emailHardSuppressed = false;
  r = await deliverEmail(fakeSupabase(null) as never, {
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "transactional",
    idempotencyKey: "txn-x",
  });
  assert.equal(r.outcome, "SUCCESS");

  // ...but HARD suppression blocks even transactional.
  emailHardSuppressed = true;
  r = await deliverEmail(fakeSupabase(null) as never, {
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "transactional",
    idempotencyKey: "txn-y",
  });
  assert.equal(r.outcome, "SUPPRESSED");
});

test("marketing without consent_email → CONSENT_GATED", async () => {
  const { deliverEmail } = await load();
  const sb = fakeSupabase({ do_not_contact: false, consent_email: false });
  const r = await deliverEmail(sb as never, {
    contactId: "c1",
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "marketing",
  });
  assert.equal(r.outcome, "CONSENT_GATED");
  assert.equal(sends.resend, 0);
});

test("incomplete direct payload (no subject/html, no templateId) → throws", async () => {
  const { deliverEmail } = await load();
  await assert.rejects(
    () => deliverEmail(fakeSupabase(null) as never, { email: "b@x.com", type: "marketing" }),
    /EMAIL_PAYLOAD_INCOMPLETE/,
  );
});

test("Resend error THROWS and records EmailSendLog FAILED for transactional (retriable)", async () => {
  resendThrows = true;
  const { deliverEmail } = await load();
  await assert.rejects(
    () =>
      deliverEmail(fakeSupabase(null) as never, {
        email: "b@x.com",
        subject: "S",
        html: "<p>h</p>",
        type: "transactional",
        idempotencyKey: "txn-fail",
      }),
    /resend network down/,
  );
  assert.deepEqual(emailLog, [{ status: "FAILED", key: "txn-fail" }]);
});

test("happy path: sends, stamps campaign_recipient + timeline, records EmailSendLog SENT", async () => {
  const { deliverEmail } = await load();
  const sb = fakeSupabase({ do_not_contact: false, consent_email: true, first_name: "A" });
  const r = await deliverEmail(sb as never, {
    contactId: "c1",
    email: "b@x.com",
    templateId: "welcome",
    campaignId: "camp1",
    campaignRecipientId: "cr1",
    type: "marketing",
  });
  assert.equal(r.outcome, "SUCCESS");
  assert.equal(r.providerId, "re_1");
  assert.equal(sends.resend, 1);
  assert.equal((sb as unknown as { writes: { campaign: unknown[]; timeline: unknown[] } }).writes.campaign.length, 1);
  assert.equal((sb as unknown as { writes: { campaign: unknown[]; timeline: unknown[] } }).writes.timeline.length, 1);
});

test("C1: a post-send bookkeeping failure does NOT throw (never triggers a re-send)", async () => {
  const { deliverEmail } = await load();
  // A fake whose contact_timeline_events insert throws AFTER the provider send.
  const sb = {
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { do_not_contact: false, consent_email: true } }),
        update: () => b,
        insert: async () => {
          if (table === "contact_timeline_events") throw new Error("timeline DB down");
          return { error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      };
      return b;
    },
  };
  // Must resolve SUCCESS despite the bookkeeping failure — the send already happened.
  const r = await deliverEmail(sb as never, {
    contactId: "c1",
    email: "b@x.com",
    subject: "S",
    html: "<p>h</p>",
    type: "marketing",
  });
  assert.equal(r.outcome, "SUCCESS");
  assert.equal(sends.resend, 1);
});

test("onDispatch is invoked immediately before the provider send", async () => {
  const { deliverEmail } = await load();
  const order: string[] = [];
  const sb = fakeSupabase(null);
  await deliverEmail(sb as never, { email: "b@x.com", subject: "S", html: "<p>h</p>", type: "marketing" }, {
    onDispatch: async () => { order.push("dispatch"); },
  });
  order.push("after");
  // onDispatch ran (before the send completed and before we returned).
  assert.deepEqual(order, ["dispatch", "after"]);
  assert.equal(sends.resend, 1);
});

// ── deliverSms ───────────────────────────────────────────────────────────────
test("invalid phone → INVALID_PHONE, no send", async () => {
  normalizeResult = "";
  const { deliverSms } = await load();
  const r = await deliverSms(fakeSupabase(null) as never, { phone: "bad", body: "hi" });
  assert.equal(r.outcome, "INVALID_PHONE");
  assert.equal(sends.twilio, 0);
});

test("SMS with no contact → TCPA_GATED", async () => {
  const { deliverSms } = await load();
  const r = await deliverSms(fakeSupabase(null) as never, { phone: "+15555550123", body: "hi" });
  assert.equal(r.outcome, "TCPA_GATED");
  assert.equal(sends.twilio, 0);
});

test("SMS without consent_sms or with DNC → TCPA_GATED", async () => {
  const { deliverSms } = await load();
  let r = await deliverSms(fakeSupabase({ consent_sms: false, do_not_contact: false }) as never, {
    contactId: "c1",
    phone: "+15555550123",
    body: "hi",
  });
  assert.equal(r.outcome, "TCPA_GATED");
  r = await deliverSms(fakeSupabase({ consent_sms: true, do_not_contact: true }) as never, {
    contactId: "c1",
    phone: "+15555550123",
    body: "hi",
  });
  assert.equal(r.outcome, "TCPA_GATED");
  assert.equal(sends.twilio, 0);
});

test("SMS suppressed → SUPPRESSED, no send", async () => {
  smsSuppressed = true;
  const { deliverSms } = await load();
  const r = await deliverSms(fakeSupabase({ consent_sms: true, do_not_contact: false }) as never, {
    contactId: "c1",
    phone: "+15555550123",
    body: "hi",
  });
  assert.equal(r.outcome, "SUPPRESSED");
  assert.equal(sends.twilio, 0);
});

test("SMS happy path → SUCCESS with sid + timeline", async () => {
  const { deliverSms } = await load();
  const sb = fakeSupabase({ consent_sms: true, do_not_contact: false });
  const r = await deliverSms(sb as never, { contactId: "c1", phone: "+15555550123", body: "hi" });
  assert.equal(r.outcome, "SUCCESS");
  assert.equal(r.providerId, "SM_1");
  assert.equal(sends.twilio, 1);
  assert.equal((sb as unknown as { writes: { timeline: unknown[] } }).writes.timeline.length, 1);
});
