// Unit tests for the compliance-critical send wrapper (P0-4).
// Run with:  npx tsx --test lib/services/email/__tests__/compliance-send.test.ts
//
// Verifies retry-on-FAILED with backoff and escalation-on-exhaustion, with all
// I/O (the underlying send, sleep, and the alert email) injected so the test is
// DB-free and timer-free. The key compliance guarantee: a delivered result is
// only ever reported for a verified SENT/DUPLICATE, and a final failure always
// escalates to the compliance inbox.

import test from "node:test";
import assert from "node:assert/strict";
import { complianceSend, type ComplianceSendDeps } from "../compliance-send";
import type { EmailSendOutcome } from "../resend.service";

const SENT: EmailSendOutcome = { sent: true, outcome: "SENT", resendId: "re_ok" };
const DUPLICATE: EmailSendOutcome = { sent: false, outcome: "DUPLICATE", resendId: "re_prior" };
const FAILED: EmailSendOutcome = { sent: false, outcome: "FAILED" };
const DEV_SKIPPED: EmailSendOutcome = { sent: false, outcome: "DEV_SKIPPED" };

const params = {
  to: "buyer@example.com",
  firstName: "B",
  decisionDate: "May 1, 2026",
  prequalApplicationId: "PRQ-1",
  buyerId: "BUY-1",
};

function makeDeps(sequence: EmailSendOutcome[], alertEmail: string | null = "ops@autolenis.com") {
  const calls = { send: 0, sleep: 0, alert: 0 };
  let alertArgs: { to: string; subject: string } | null = null;
  const deps: Partial<ComplianceSendDeps> = {
    send: async () => {
      const o = sequence[Math.min(calls.send, sequence.length - 1)];
      calls.send++;
      return o;
    },
    sleep: async () => { calls.sleep++; },
    alertSend: async (a) => { calls.alert++; alertArgs = { to: a.to, subject: a.subject }; return {}; },
    retryDelaysMs: [1, 2, 3], // 3 retries after the first attempt
    alertEmail,
  };
  return { deps, calls, getAlertArgs: () => alertArgs };
}

test("provider success → SENT, no retry, no alert", async () => {
  const { deps, calls } = makeDeps([SENT]);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "SENT");
  assert.equal(calls.send, 1);
  assert.equal(calls.sleep, 0);
  assert.equal(calls.alert, 0);
});

test("verified-prior DUPLICATE → returns DUPLICATE, no retry, no alert", async () => {
  const { deps, calls } = makeDeps([DUPLICATE]);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "DUPLICATE");
  assert.equal(calls.send, 1);
  assert.equal(calls.alert, 0);
});

test("DEV_SKIPPED (no API key) → no retry, no alert", async () => {
  const { deps, calls } = makeDeps([DEV_SKIPPED]);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "DEV_SKIPPED");
  assert.equal(calls.send, 1);
  assert.equal(calls.alert, 0);
});

test("retry then succeed → SENT, no alert, send called until success", async () => {
  const { deps, calls } = makeDeps([FAILED, FAILED, SENT]);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "SENT");
  assert.equal(calls.send, 3);
  assert.equal(calls.sleep, 2);
  assert.equal(calls.alert, 0);
});

test("persistent failure → FAILED, exhausts retries, escalates once to compliance inbox", async () => {
  const { deps, calls, getAlertArgs } = makeDeps([FAILED]);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "FAILED");
  assert.equal(calls.send, 4); // 1 initial + 3 retries
  assert.equal(calls.sleep, 3);
  assert.equal(calls.alert, 1);
  const args = getAlertArgs();
  assert.ok(args);
  assert.equal(args!.to, "ops@autolenis.com");
  assert.match(args!.subject, /FCRA/);
});

test("persistent failure with no alert email configured → FAILED, no escalation email", async () => {
  const { deps, calls } = makeDeps([FAILED], null);
  const out = await complianceSend(params, deps);
  assert.equal(out.outcome, "FAILED");
  assert.equal(calls.send, 4);
  assert.equal(calls.alert, 0);
});
