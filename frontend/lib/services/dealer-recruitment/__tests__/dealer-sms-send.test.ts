// Task 8c — dealer SMS, built in full and shipped OFF.
//
// The consent decision is DELEGATED to lib/services/sms/consent-basis, the same
// gate the CRM path evaluates. That is the anti-bypass property, and it is
// asserted two ways: behaviourally (the shared gate is what decided) and
// structurally (this module contains no consent logic of its own). A private
// copy would drift, and a drifted copy is how a consent check becomes decorative.
//
// Dealer prospects carry consent_basis = NONE (the column default; nothing in
// this change writes anything else), so every one of them is refused. SMS
// reaching zero prospects is the CORRECT outcome for vendor-sourced numbers with
// no consent record — not a bug, and not something to route around.
//
// The Twilio client is INJECTED. mock.module on a bare specifier does not apply
// under this repo's CJS transform — proven earlier in this branch when a `resend`
// mock recorded zero calls while the service reached the live API. Injection
// keeps the suite off the network by construction.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  sendDealerSms,
  type DealerSmsDeps,
} from "../dealer-sms-send.service";

const NOW = new Date("2026-08-31T12:00:00Z");

interface Harness {
  deps: Partial<DealerSmsDeps>;
  rows: () => Record<string, unknown>[];
  dispatches: () => number;
  consentEvaluations: () => number;
}

function harness(opts: {
  sendEnabled?: boolean;
  consentBasis?: string;
  dncStatus?: string | null;
  phoneType?: string | null;
  phone?: string | null;
  suppressed?: boolean;
  quietHours?: boolean;
  dispatchThrows?: string;
  priorLive?: boolean;
} = {}): Harness {
  const rows: Record<string, unknown>[] = [];
  let dispatches = 0;
  let consentEvaluations = 0;
  return {
    rows: () => rows,
    dispatches: () => dispatches,
    consentEvaluations: () => consentEvaluations,
    deps: {
      now: NOW,
      sendEnabled: () => opts.sendEnabled ?? true,
      loadTarget: async () => ({
        prospectId: "p1",
        phone: opts.phone === undefined ? "+15125551212" : opts.phone,
        state: "TX",
        zip: "78701",
        consentBasis: opts.consentBasis ?? "NONE",
        dncStatus: opts.dncStatus === undefined ? "not_found" : opts.dncStatus,
        phoneType: opts.phoneType === undefined ? "corporate_phone" : opts.phoneType,
      }),
      findPriorLiveAttempt: async () => (opts.priorLive ? { id: "log_prior" } : null),
      onConsentEvaluated: () => { consentEvaluations += 1; },
      isSmsSuppressed: async () => opts.suppressed ?? false,
      inQuietHours: () => opts.quietHours ?? false,
      dispatch: async () => {
        dispatches += 1;
        if (opts.dispatchThrows) throw new Error(opts.dispatchThrows);
        return { sid: "SM_fake_sid", error: null };
      },
      createLog: async (data) => {
        rows.push(data as unknown as Record<string, unknown>);
        return { id: `log_${rows.length}` };
      },
      updateLog: async (id, data) => {
        const row = rows.find((r) => r.__id === id) ?? rows[rows.length - 1];
        Object.assign(row, data);
      },
    },
  };
}

const MSG = { prospectId: "p1", body: "hello", step: 1 };

// ─── the flag ───────────────────────────────────────────────────────────────

test("the send flag is OFF by default and blocks before Twilio", async () => {
  const h = harness({ sendEnabled: false, consentBasis: "EXPRESS_WRITTEN" });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.success, false);
  assert.equal(r.reason, "send_disabled");
  assert.equal(h.dispatches(), 0);
});

// ─── consent is delegated, not copied ───────────────────────────────────────

test("a dealer prospect with the default NONE basis is refused", async () => {
  const h = harness({ consentBasis: "NONE" });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.success, false);
  assert.equal(r.reason, "no_consent_basis");
  assert.equal(h.dispatches(), 0);
});

test("the SHARED gate is what decided — not a private copy", async () => {
  const h = harness({ consentBasis: "NONE" });
  await sendDealerSms(MSG, h.deps);
  assert.equal(h.consentEvaluations(), 1, "the shared gate must be consulted exactly once");
});

test("this module contains no consent logic of its own", () => {
  // Structural. A private copy would drift from the CRM path, and a drifted
  // copy is how a consent check becomes decorative.
  const src = readFileSync(
    join(process.cwd(), "lib/services/dealer-recruitment/dealer-sms-send.service.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.split("//")[0]).join("\n");
  assert.ok(src.includes("evaluateConsentBasis"), "must delegate to the shared gate");

  // No affirmative-basis literals: deciding which bases permit contact is the
  // shared gate's job, and a second list here is what would drift.
  for (const literal of ["EXPRESS_WRITTEN", "EXISTING_BUSINESS_RELATIONSHIP", "consent_sms"]) {
    assert.ok(!src.includes(literal), `must not re-implement consent: found ${literal}`);
  }

  // No local re-implementation of the DNC or phone-type RULES. Checked as
  // comparisons rather than as bare strings: "not_found" is also this service's
  // own prospect-missing reason, and forbidding the substring would fail a
  // correct file for an unrelated word.
  assert.doesNotMatch(src, /dncStatus\s*[!=]==?\s*["']/, "must not compare dncStatus to a literal");
  assert.doesNotMatch(src, /phoneType\s*[!=]==?\s*["']/, "must not compare phoneType to a literal");
  assert.doesNotMatch(src, /DNC_CLEAR_STATUS\s*=/, "must not declare its own DNC constant");
  assert.doesNotMatch(src, /ALLOWED_PHONE_TYPES\s*=/, "must not declare its own phone-type allow-list");
});

test("DNC and phone-type blocks come through the shared gate too", async () => {
  for (const [opts, reason] of [
    [{ consentBasis: "EXPRESS_WRITTEN", dncStatus: "found" }, "dnc_blocked"],
    [{ consentBasis: "EXPRESS_WRITTEN", dncStatus: "pending" }, "dnc_blocked"],
    [{ consentBasis: "EXPRESS_WRITTEN", dncStatus: null }, "dnc_blocked"],
    [{ consentBasis: "EXPRESS_WRITTEN", phoneType: "mobile_phone" }, "phone_type_blocked"],
  ] as const) {
    const h = harness(opts);
    const r = await sendDealerSms(MSG, h.deps);
    assert.equal(r.reason, reason, `${JSON.stringify(opts)} -> ${reason}`);
    assert.equal(h.dispatches(), 0);
  }
});

// ─── send-time gates ────────────────────────────────────────────────────────

test("suppression is checked at SEND time, not at queue-build time", async () => {
  const h = harness({ consentBasis: "EXPRESS_WRITTEN", suppressed: true });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.reason, "suppressed");
  assert.equal(h.dispatches(), 0);
});

test("quiet hours block the send", async () => {
  const h = harness({ consentBasis: "EXPRESS_WRITTEN", quietHours: true });
  assert.equal((await sendDealerSms(MSG, h.deps)).reason, "quiet_hours");
});

test("an invalid or missing phone is refused", async () => {
  for (const phone of [null, "", "not-a-number"]) {
    const h = harness({ consentBasis: "EXPRESS_WRITTEN", phone });
    const r = await sendDealerSms(MSG, h.deps);
    assert.equal(r.reason, "invalid_phone", `phone ${JSON.stringify(phone)}`);
  }
});

// ─── every attempt logs exactly one row ─────────────────────────────────────

test("every blocked outcome still writes exactly one sms row", async () => {
  for (const opts of [
    { sendEnabled: false, consentBasis: "EXPRESS_WRITTEN" },
    { consentBasis: "NONE" },
    { consentBasis: "EXPRESS_WRITTEN", dncStatus: "found" },
    { consentBasis: "EXPRESS_WRITTEN", phoneType: "mobile_phone" },
    { consentBasis: "EXPRESS_WRITTEN", suppressed: true },
    { consentBasis: "EXPRESS_WRITTEN", quietHours: true },
  ]) {
    const h = harness(opts);
    await sendDealerSms(MSG, h.deps);
    assert.equal(h.rows().length, 1, `${JSON.stringify(opts)} must leave exactly one row`);
    assert.equal(h.rows()[0].channel, "sms");
    assert.equal(h.rows()[0].status, "failed");
    assert.ok(h.rows()[0].errorMessage, "a failed row must say why");
  }
});

test("every attempt records the consent_basis in force at send time", async () => {
  const h = harness({ consentBasis: "NONE" });
  await sendDealerSms(MSG, h.deps);
  assert.equal(h.rows()[0].consentBasis, "NONE");
});

test("a successful send records the twilio sid and the destination", async () => {
  const h = harness({ consentBasis: "EXPRESS_WRITTEN" });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.success, true);
  assert.equal(h.dispatches(), 1);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].status, "sent");
  assert.equal(h.rows()[0].twilioSid, "SM_fake_sid");
  assert.equal(h.rows()[0].toPhone, "+15125551212");
});

test("a Twilio failure writes one failed row carrying the provider error", async () => {
  const h = harness({ consentBasis: "EXPRESS_WRITTEN", dispatchThrows: "21610 unsubscribed" });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.success, false);
  assert.equal(r.reason, "send_error");
  assert.equal(h.rows().length, 1);
  assert.match(String(h.rows()[0].errorMessage), /21610/);
});

test("a duplicate live attempt at the same step does not dispatch twice", async () => {
  const h = harness({ consentBasis: "EXPRESS_WRITTEN", priorLive: true });
  const r = await sendDealerSms(MSG, h.deps);
  assert.equal(r.reason, "already_contacted");
  assert.equal(h.dispatches(), 0);
  assert.equal(h.rows().length, 0, "it points at the existing row rather than adding one");
  assert.equal(r.outreachLogId, "log_prior");
});
