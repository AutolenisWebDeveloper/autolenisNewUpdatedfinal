// TCPA regression (Phase 1 UI-31): the public contact form collects an SMS
// consent checkbox when a phone is provided, but the consent was never sent or
// persisted. The route schema now enforces, server-side, that a phone number
// cannot be accepted without an explicit consent flag — so a phone is never
// stored for messaging without a consent basis. (The route also records the
// consent + timestamp + terms in the submission metadata.)
//
// Run via test:comms (globs lib/services/notifications/__tests__/*.test.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { contactSchema } from "@/app/api/public/contact/route";

test("contact schema: message with no phone is valid without consent", () => {
  const r = contactSchema.safeParse({
    name: "Jane", email: "jane@example.com", subject: "Hi", message: "Hello there",
  });
  assert.equal(r.success, true);
});

test("contact schema: phone provided WITHOUT consent is rejected (TCPA)", () => {
  const r = contactSchema.safeParse({
    name: "Jane", email: "jane@example.com", phone: "555-123-4567", subject: "Hi", message: "Call me",
  });
  assert.equal(r.success, false);
});

test("contact schema: phone provided with smsConsent=false is rejected", () => {
  const r = contactSchema.safeParse({
    name: "Jane", email: "jane@example.com", phone: "555-123-4567", subject: "Hi", message: "Call me", smsConsent: false,
  });
  assert.equal(r.success, false);
});

test("contact schema: phone provided WITH consent is accepted", () => {
  const r = contactSchema.safeParse({
    name: "Jane", email: "jane@example.com", phone: "555-123-4567", subject: "Hi", message: "Call me", smsConsent: true,
  });
  assert.equal(r.success, true);
});

test("contact schema: empty phone string does not require consent", () => {
  const r = contactSchema.safeParse({
    name: "Jane", email: "jane@example.com", phone: "", subject: "Hi", message: "Hello", smsConsent: false,
  });
  assert.equal(r.success, true);
});
