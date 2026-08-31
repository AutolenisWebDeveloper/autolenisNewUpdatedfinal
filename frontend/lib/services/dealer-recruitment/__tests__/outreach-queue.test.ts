// Task 9 — the queue read-model: "who do I contact right now, and how?"
//
// DEVIATION FROM THE ORIGINAL PLAN, and the reason for it.
//
// The plan specified four outcomes: EMAIL_READY | SMS_READY | BOTH_READY |
// UNREACHABLE. Applied to the real data that model is actively misleading.
// Email coverage is 167/1,532; SMS reaches ZERO prospects because consent_basis
// defaults to NONE; phone coverage is 1,527/1,532. So the plan's model would
// mark roughly 1,365 prospects UNREACHABLE — every one of which a human can pick
// up the phone and call today, which is precisely what Phase 3 shipped enabled.
//
// A queue that hides its own addressable audience is worse than no queue. So
// contactability reports the OPEN CHANNELS, and CALL is one of them. UNREACHABLE
// means what it says: nothing works.
//
// The channels are not interchangeable and each has its own rule:
//   email  a send-safe address (VERIFIED or ROLE_DERIVED) that is not suppressed
//   call   a valid phone — a human dialling needs no consent basis
//   sms    the full shared consent gate: basis, DNC, phone type

import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  resolveContactability,
  loadOutreachQueue,
  type QueueSourceRow,
  type OutreachQueueDeps,
} from "../outreach-queue.service";

function row(over: Partial<QueueSourceRow> = {}): QueueSourceRow {
  return {
    prospectId: "p1",
    name: "Toyota of Dallas",
    city: "Dallas",
    state: "TX",
    status: "DISCOVERED",
    score: 50,
    email: null,
    emailVerificationStatus: null,
    emailSuppressed: false,
    phone: null,
    phoneSuppressed: false,
    consentBasis: "NONE",
    dncStatus: null,
    phoneType: null,
    contactName: null,
    contactTitle: null,
    contactSource: null,
    contactConfidence: null,
    apolloLastSyncedAt: null,
    lastTouchAt: null,
    lastTouchChannel: null,
    ...over,
  };
}

// ─── channel rules ──────────────────────────────────────────────────────────

test("a send-safe email opens the email channel", () => {
  for (const status of ["VERIFIED", "ROLE_DERIVED"]) {
    const c = resolveContactability(row({ email: "a@b.invalid", emailVerificationStatus: status }));
    assert.equal(c.channels.email, true, `${status} should be send-safe`);
  }
});

test("an UNVERIFIED email does not open the email channel", () => {
  const c = resolveContactability(row({ email: "a@b.invalid", emailVerificationStatus: "UNVERIFIED" }));
  assert.equal(c.channels.email, false);
  assert.ok(c.reasons.includes("email_not_send_safe"));
});

test("a suppressed email is closed even when VERIFIED", () => {
  const c = resolveContactability(
    row({ email: "a@b.invalid", emailVerificationStatus: "VERIFIED", emailSuppressed: true }));
  assert.equal(c.channels.email, false);
  assert.ok(c.reasons.includes("email_suppressed"));
});

test("a valid phone opens the CALL channel with no consent basis at all", () => {
  // This is the whole point of the deviation: 1,527 prospects are callable today.
  const c = resolveContactability(row({ phone: "+15125551212", consentBasis: "NONE", dncStatus: null }));
  assert.equal(c.channels.call, true);
  assert.equal(c.channels.sms, false, "SMS still requires the full gate");
});

test("a DNC-listed number still opens CALL — DNC is surfaced, not silently applied", () => {
  // A human must SEE the DNC badge and decide. Hiding the row would remove the
  // information rather than protect anyone.
  const c = resolveContactability(row({ phone: "+15125551212", dncStatus: "found" }));
  assert.equal(c.channels.call, true);
  assert.equal(c.dncBlocked, true, "the badge is what stops the operator, and it must be set");
});

test("a suppressed phone closes both phone channels", () => {
  const c = resolveContactability(row({ phone: "+15125551212", phoneSuppressed: true }));
  assert.equal(c.channels.call, false);
  assert.equal(c.channels.sms, false);
  assert.ok(c.reasons.includes("phone_suppressed"));
});

test("SMS needs the full shared gate — basis, DNC and phone type together", () => {
  const open = resolveContactability(row({
    phone: "+15125551212", consentBasis: "EXPRESS_WRITTEN", dncStatus: "not_found", phoneType: "corporate_phone",
  }));
  assert.equal(open.channels.sms, true);

  for (const over of [
    { consentBasis: "NONE" },
    { dncStatus: "found" },
    { dncStatus: "pending" },
    { dncStatus: null },
    { phoneType: "mobile_phone" },
  ]) {
    const c = resolveContactability(row({
      phone: "+15125551212", consentBasis: "EXPRESS_WRITTEN", dncStatus: "not_found",
      phoneType: "corporate_phone", ...over,
    }));
    assert.equal(c.channels.sms, false, `${JSON.stringify(over)} must close SMS`);
  }
});

// ─── the summary ────────────────────────────────────────────────────────────

test("UNREACHABLE means nothing works — not merely 'no email'", () => {
  const c = resolveContactability(row({ email: null, phone: null }));
  assert.equal(c.contactability, "UNREACHABLE");
  assert.equal(c.channels.email, false);
  assert.equal(c.channels.call, false);
  assert.equal(c.channels.sms, false);
});

test("a phone-only prospect is CALL_READY, never UNREACHABLE", () => {
  const c = resolveContactability(row({ email: null, phone: "+15125551212" }));
  assert.equal(c.contactability, "CALL_READY");
  assert.notEqual(c.contactability, "UNREACHABLE");
});

test("email plus phone reports both channels open", () => {
  const c = resolveContactability(row({
    email: "a@b.invalid", emailVerificationStatus: "VERIFIED", phone: "+15125551212",
  }));
  assert.equal(c.channels.email, true);
  assert.equal(c.channels.call, true);
  assert.equal(c.contactability, "EMAIL_AND_CALL_READY");
});

test("every row gets a primary action naming the channel to use now", () => {
  assert.equal(resolveContactability(row({ phone: "+15125551212" })).primaryAction, "LOG_CALL");
  assert.equal(
    resolveContactability(row({ email: "a@b.invalid", emailVerificationStatus: "VERIFIED" })).primaryAction,
    "SEND_EMAIL",
  );
  assert.equal(resolveContactability(row({})).primaryAction, "NONE");
});

test("email is the primary action when both are open — it costs no operator time", () => {
  const c = resolveContactability(row({
    email: "a@b.invalid", emailVerificationStatus: "VERIFIED", phone: "+15125551212",
  }));
  assert.equal(c.primaryAction, "SEND_EMAIL");
});

// ─── personnel provenance ───────────────────────────────────────────────────

test("personnel come from the contact profile, never the unprovenanced prospect columns", async () => {
  // 594 dealer_prospects rows carry contact_name with contact_source NULL on all
  // 1,532 — zero provenance. Showing those as if they were verified contacts
  // would present a guess as a fact.
  const deps = fakeQueue({
    rows: [row({ contactName: null, contactSource: null, phone: "+15125551212" })],
    profiles: { p1: { name: "Dana Reyes", title: "General Manager", contactSource: "apollo", contactConfidence: "high", apolloLastSyncedAt: new Date("2026-08-01") } },
  });
  const q = await loadOutreachQueue({}, deps);
  assert.equal(q.rows[0].contactName, "Dana Reyes");
  assert.equal(q.rows[0].contactSource, "apollo");
});

test("a prospect with no profile shows NO contact rather than an unprovenanced one", async () => {
  const deps = fakeQueue({
    rows: [row({ contactName: "Legacy Name", contactTitle: "Legacy Title", phone: "+15125551212" })],
    profiles: {},
  });
  const q = await loadOutreachQueue({}, deps);
  assert.equal(q.rows[0].contactName, null);
  assert.equal(q.rows[0].contactSource, null);
});

// ─── the queue itself ───────────────────────────────────────────────────────

function fakeQueue(opts: {
  rows: QueueSourceRow[];
  profiles?: Record<string, { name: string; title: string; contactSource: string; contactConfidence: string; apolloLastSyncedAt: Date }>;
}): Partial<OutreachQueueDeps> {
  return {
    loadRows: async () => opts.rows,
    loadProfiles: async () => opts.profiles ?? {},
  };
}

test("the default view excludes UNREACHABLE but the bucket still COUNTS them", async () => {
  const reachable = Array.from({ length: 12 }, (_, i) => row({ prospectId: `r${i}`, phone: "+15125551212" }));
  const unreachable = Array.from({ length: 40 }, (_, i) => row({ prospectId: `u${i}` }));
  const q = await loadOutreachQueue({}, fakeQueue({ rows: [...reachable, ...unreachable] }));
  assert.equal(q.rows.length, 12);
  assert.equal(q.counts.unreachable, 40, "the unreachable bucket must be visible, not silently filtered");
  assert.equal(q.counts.total, 52);
});

test("the unreachable bucket is openable as its own view", async () => {
  const q = await loadOutreachQueue(
    { bucket: "unreachable" },
    fakeQueue({ rows: [row({ prospectId: "a", phone: "+15125551212" }), row({ prospectId: "b" })] }),
  );
  assert.equal(q.rows.length, 1);
  assert.equal(q.rows[0].prospectId, "b");
});

test("the default view keeps only DISCOVERED and SCRIPTED", async () => {
  const rows = ["DISCOVERED", "SCRIPTED", "CONTACTED", "REPLIED", "ONBOARDED", "DEAD"].map((status, i) =>
    row({ prospectId: `p${i}`, status, phone: "+15125551212" }));
  const q = await loadOutreachQueue({}, fakeQueue({ rows }));
  assert.deepEqual(q.rows.map((r) => r.status).sort(), ["DISCOVERED", "SCRIPTED"]);
});

test("rows are ordered by score, highest first", async () => {
  const rows = [
    row({ prospectId: "low", score: 10, phone: "+15125551212" }),
    row({ prospectId: "high", score: 90, phone: "+15125551212" }),
    row({ prospectId: "mid", score: 50, phone: "+15125551212" }),
  ];
  const q = await loadOutreachQueue({}, fakeQueue({ rows }));
  assert.deepEqual(q.rows.map((r) => r.prospectId), ["high", "mid", "low"]);
});

test("a null score sorts last rather than crashing or sorting first", async () => {
  const rows = [
    row({ prospectId: "none", score: null, phone: "+15125551212" }),
    row({ prospectId: "some", score: 1, phone: "+15125551212" }),
  ];
  const q = await loadOutreachQueue({}, fakeQueue({ rows }));
  assert.deepEqual(q.rows.map((r) => r.prospectId), ["some", "none"]);
});

test("counts break down by channel so the operator sees what is actually workable", async () => {
  const q = await loadOutreachQueue({}, fakeQueue({ rows: [
    row({ prospectId: "a", phone: "+15125551212" }),
    row({ prospectId: "b", email: "b@x.invalid", emailVerificationStatus: "VERIFIED" }),
    row({ prospectId: "c" }),
  ]}));
  assert.equal(q.counts.callReady, 1);
  assert.equal(q.counts.emailReady, 1);
  assert.equal(q.counts.smsReady, 0, "nothing is SMS-ready while consent_basis defaults to NONE");
  assert.equal(q.counts.unreachable, 1);
});

test("the DNC-blocked count is reported separately from unreachable", async () => {
  const q = await loadOutreachQueue({}, fakeQueue({ rows: [
    row({ prospectId: "a", phone: "+15125551212", dncStatus: "found" }),
    row({ prospectId: "b", phone: "+15125551212", dncStatus: "not_found" }),
  ]}));
  assert.equal(q.counts.dncBlocked, 1);
  assert.equal(q.counts.unreachable, 0, "a DNC number is still callable and must not be hidden");
});

// ─── the number the operator actually dials ─────────────────────────────────

test("the row carries the phone number, because the queue's one live action dials it", async () => {
  // Manual calling is the only outreach that ships enabled, and the queue is
  // where it starts. A read model that resolves "CALL_READY" but withholds the
  // number forces the operator into a second lookup for every single row.
  const deps = fakeQueue({ rows: [row({ phone: "+15125551212" })] });
  const q = await loadOutreachQueue({}, deps);
  assert.equal(q.rows[0].phone, "+15125551212");
});

test("a prospect with no phone reports null rather than an empty string", async () => {
  // telHref distinguishes the two; an empty string would render a dead tel: link.
  const deps = fakeQueue({ rows: [row({ phone: null, email: "a@b.com", emailVerificationStatus: "VERIFIED" })] });
  const q = await loadOutreachQueue({}, deps);
  assert.equal(q.rows[0].phone, null);
});

// ─── truncation ─────────────────────────────────────────────────────────────

test("the row cap is applied to the BEST rows, not to an arbitrary page", async () => {
  // defaultLoadRows takes 500 rows. With no ORDER BY, which 500 Postgres
  // returns is unspecified and changes between calls — so on 1,532 production
  // prospects roughly a thousand were invisible, a different thousand each
  // load, and the "highest score first" sort below ran over whatever arbitrary
  // subset had come back. Sorting has to happen in the DATABASE, before the
  // cap, or the cap decides the ranking.
  const { QUEUE_ROW_CAP, defaultQueueOrderBy } = await import("../outreach-queue.service");
  assert.equal(typeof QUEUE_ROW_CAP, "number");
  assert.deepEqual(defaultQueueOrderBy, [{ searchScore: { sort: "desc", nulls: "last" } }, { id: "asc" }]);
});

// ─── the queue and the send path must read the SAME contact ─────────────────

test("one ordering decides the primary contact, shared by the queue and the send path", async () => {
  // A rooftop can hold several contact profiles, and consent basis, DNC status
  // and phone type all hang off the one chosen. The queue read model ordered by
  // [isPrimaryContact desc, apolloLastSyncedAt desc]; the SMS send wiring
  // ordered by [isPrimaryContact desc, createdAt asc]. On any rooftop with two
  // profiles those can disagree, so the queue could show "SMS ready" from one
  // person's record while the send service evaluated someone else's — the UI
  // and the gate reasoning about different facts, which is exactly the class of
  // bug consent gates exist to prevent.
  // dealer-sms-wiring reaches two `server-only` modules at import time, which
  // this transform refuses to load. Neither is used by the constant under test.
  mock.module("@/lib/supabase-service", { namedExports: { getServiceSupabase: () => null } });
  mock.module("@/lib/crm/recipient-timezone", {
    namedExports: { isRecipientInQuietHours: () => true },
  });

  const queue = await import("../outreach-queue.service");
  const wiring = await import("../dealer-sms-wiring");
  assert.deepEqual(
    queue.PRIMARY_CONTACT_ORDER,
    wiring.PRIMARY_CONTACT_ORDER,
    "both paths must import ONE ordering, not keep two that happen to match",
  );
  assert.equal(queue.PRIMARY_CONTACT_ORDER, wiring.PRIMARY_CONTACT_ORDER);
});
