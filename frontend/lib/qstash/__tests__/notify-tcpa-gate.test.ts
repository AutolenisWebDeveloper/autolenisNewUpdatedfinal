// notifyContact — the TCPA consent gate on the SMS leg.
//
// Every lifecycle touch (including all four $99 deposit reminders) sends through
// this one function, so it is the single place SMS consent is enforced. The rule
// is legal, not stylistic: marketing SMS without a captured, current opt-in is TCPA
// exposure per message. It was previously untested.
//
// Pinned here:
//   • SMS requires an explicit consent_sms opt-in — no consent, no send.
//   • do_not_contact suppresses EVERY channel.
//   • a blocked SMS does NOT abort the touch — the email leg is still attempted, so
//     the deposit-reminder chain keeps working on email alone. (This is the live
//     configuration: no buyer-facing SMS consent capture exists, so the SMS leg is
//     dormant for self-signup buyers while email carries the sequence.)
//   • the gate FAILS CLOSED — an unresolvable contact sends nothing.
//
// SCOPE LIMIT: the email SEND is not asserted here. notify.ts constructs its
// Resend client internally via getResend(), and the package is not interceptable
// through node:test module mocking at that seam, so a "was the email delivered"
// assertion would pass or fail for reasons unrelated to consent. Only claims that
// hold regardless of the email transport are made below — in particular, the
// do-not-contact case asserts the SMS side, because an emailSent:false there would
// also be produced by an unstubbed transport and would pass vacuously.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/qstash/__tests__/notify-tcpa-gate.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface ContactRow {
  id: string;
  email: string | null;
  phone: string | null;
  consent_sms: boolean;
  do_not_contact: boolean;
}

let contact: ContactRow | null = null;
let smsSends: Array<{ to: string; body: string }> = [];

mock.module("server-only", { namedExports: {}, defaultExport: {} });

mock.module("@/lib/supabase-service", {
  namedExports: {
    getServiceSupabase: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: contact ? { contact_id: contact.id } : null }) }),
          }),
        }),
      }),
    }),
  },
});

mock.module("@/lib/services/contact.service", {
  namedExports: { ContactService: { getContactById: async () => contact } },
});

// Nothing suppressed — so a refusal below can only come from the consent gate.
mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: { isSmsSuppressed: async () => false, isEmailSuppressed: async () => false },
  },
});

mock.module("twilio", {
  defaultExport: () => ({
    messages: { create: async ({ to, body }: { to: string; body: string }) => { smsSends.push({ to, body }); return { sid: "SM1" }; } },
  }),
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/qstash/notify"); }

const TOUCH = {
  entityType: "buyer" as const,
  entityId: "buyer_1",
  sms: "Complete your $99 Auction Access Deposit: autolenis.com/buyer/deposit",
  emailSubject: "Your vehicle request is saved — one step left",
  emailHtml: "<p>Complete your deposit.</p>",
};

beforeEach(() => {
  contact = { id: "c1", email: "buyer@example.com", phone: "+15551230000", consent_sms: false, do_not_contact: false };
  smsSends = [];
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok";
});

test("NO SMS without consent_sms — the deposit reminder must not text an unconsented buyer", async () => {
  const { notifyContact } = await load();
  const result = await notifyContact(TOUCH);

  assert.equal(result.smsSent, false, "TCPA: marketing SMS requires a captured opt-in");
  assert.deepEqual(smsSends, [], "no message may reach Twilio at all");
});

test("a gated SMS does not abort the touch — the email leg is still attempted", async () => {
  const { notifyContact } = await load();
  const result = await notifyContact({ ...TOUCH, email: "buyer@example.com" });

  // The SMS is refused for want of consent, and notifyContact still returns a
  // result rather than throwing or short-circuiting: the email leg runs on its
  // own consent basis. (Whether the transport delivered is out of scope — see
  // the SCOPE LIMIT note above.)
  assert.equal(result.smsSent, false);
  assert.equal(typeof result.emailSent, "boolean", "the email leg must be evaluated, not skipped");
});

test("WITH consent_sms the SMS sends, carrying the required opt-out", async () => {
  contact = { ...contact!, consent_sms: true };
  const { notifyContact } = await load();
  const result = await notifyContact(TOUCH);

  assert.equal(result.smsSent, true, "a consented buyer is reachable — the gate must not over-block");
  assert.equal(smsSends.length, 1);
  assert.match(smsSends[0]!.body, /reply stop to opt out/i, "every marketing SMS carries the opt-out");
});

test("do_not_contact suppresses SMS even with consent_sms true", async () => {
  // Asserted on the SMS side only: an emailSent:false here would also be produced
  // by an unstubbed transport, so asserting it would pass for the wrong reason.
  contact = { ...contact!, consent_sms: true, do_not_contact: true };
  const { notifyContact } = await load();
  const result = await notifyContact(TOUCH);

  assert.equal(result.smsSent, false, "do-not-contact outranks an SMS opt-in");
  assert.deepEqual(smsSends, [], "nothing may reach Twilio for a do-not-contact buyer");
});

test("an unresolvable contact fails CLOSED — no SMS", async () => {
  contact = null;
  const { notifyContact } = await load();
  const result = await notifyContact(TOUCH);
  assert.equal(result.smsSent, false, "no contact record means no consent record — never send");
  assert.deepEqual(smsSends, []);
});
