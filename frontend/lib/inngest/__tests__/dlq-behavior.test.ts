// #8 regression — the messaging workers' non-transactional DLQ path.
//
// Root cause being fixed: lib/inngest/functions.ts carried its OWN inline
// isFinalAttempt that probed `maxAttempt`/`maxRetries` (neither exists on the
// Inngest v3 ctx, which exposes `attempt` + `maxAttempts`), so it returned false
// on EVERY attempt — the final one included. Result: moveJobToDeadLetter was
// never called, the guard never released, and permanently-failing email/SMS/
// workflow-resume jobs silently vanished. A green "isFinalAttempt returns the
// right boolean" unit test masked it because the WORKERS used a different, broken
// copy.
//
// This test proves the BEHAVIOR end-to-end: drive each worker to throw, and
// assert a row lands in the dead-letter store on the FINAL attempt and NOT on a
// non-final attempt. It runs the REAL toolkit isFinalAttempt (captured before the
// toolkit is mocked) so the final-vs-non-final decision is genuine — it is not a
// predicate test. moveJobToDeadLetter is a spy that records the DLQ row.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/inngest/__tests__/dlq-behavior.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
// Capture the REAL isFinalAttempt before mocking the toolkit, so the worker's
// final-vs-non-final decision runs the genuine predicate (attempt >= maxAttempts-1),
// not a stand-in. This is the whole point: prove the DLQ fires on the real final
// attempt, not just that a boolean function is correct in isolation.
import { isFinalAttempt as realIsFinalAttempt } from "@/lib/inngest/idempotency";

// DLQ rows recorded by the moveJobToDeadLetter spy.
const dlqRows: Array<Record<string, unknown>> = [];
// Keys released by the releaseIdempotencyGuard spy (re-drive path).
const releasedKeys: string[] = [];

function makeFakeSupabase() {
  const contactRow = { consent_sms: true, consent_email: true, do_not_contact: false };
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: async (row: Record<string, unknown>) => {
        if (table === "jobs_dead_letter") dlqRows.push(row);
        return { error: null };
      },
      update: () => b,
      delete: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: async () => ({ data: table === "contacts" ? contactRow : null }),
      // thenable so `await from().update().eq()` (updateIdempotencyState) resolves
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    };
    return b;
  }
  return { from: (t: string) => builder(t) };
}

// Mock the idempotency toolkit: getSupabase returns the fake DB (for the sms
// contact load); acquire/update/release are no-ops; moveJobToDeadLetter is a spy
// that records the DLQ row; isFinalAttempt is the REAL predicate captured above.
mock.module("@/lib/inngest/idempotency", {
  namedExports: {
    getSupabase: () => makeFakeSupabase(),
    acquireIdempotencyGuard: async () => true,
    updateIdempotencyState: async () => {},
    releaseIdempotencyGuard: async (_sb: unknown, key: string) => { releasedKeys.push(key); },
    moveJobToDeadLetter: async (
      _sb: unknown,
      jobId: string,
      eventName: string,
      payload: unknown,
      errorMessage: string,
    ) => {
      dlqRows.push({ job_id: jobId, event_name: eventName, payload, error_message: errorMessage });
    },
    isFinalAttempt: realIsFinalAttempt,
  },
});

mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

// email-send-log (transactional dedup) — proceed past the SENT-precheck; record is a no-op.
mock.module("@/lib/services/email/email-send-log", {
  namedExports: {
    transactionalEmailAlreadySent: async () => false,
    recordTransactionalEmailSend: async () => {},
  },
});

mock.module("@/lib/services/suppression.service", {
  namedExports: {
    SuppressionService: {
      isEmailSuppressed: async () => false,
      isEmailHardSuppressed: async () => false,
      isSmsSuppressed: async () => false,
    },
  },
});

// Force each worker's dispatch step to throw so it reaches the catch/DLQ path.
// The email worker's failure is triggered via TemplateService (a first-party
// module we CAN reliably mock), not the third-party resend client — node:test's
// named-export mocking is unreliable for CJS packages. The throw ORIGIN is
// immaterial: any error inside the worker's try reaches the same catch → DLQ
// wiring, which is exactly what #8 fixes. (sms/workflow fail at their own seams.)
mock.module("@/lib/services/template.service", {
  namedExports: {
    TemplateService: {
      renderTemplate: async () => { throw new Error("email dispatch boom"); },
    },
  },
});
mock.module("twilio", {
  defaultExport: () => ({
    messages: { create: async () => { throw new Error("twilio dispatch boom"); } },
  }),
});
mock.module("@/lib/services/workflow.engine", {
  namedExports: {
    WorkflowEngine: { resumeEnrollment: async () => { throw new Error("workflow resume boom"); } },
  },
});

async function load() {
  return import("@/lib/inngest/functions");
}

// Fake Inngest ctx. isFinalAttempt (real) reads attempt/maxAttempts off this.
function ctx(data: unknown, attempt: number, maxAttempts = 3) {
  return {
    event: { data },
    step: { run: <T>(_n: string, fn: () => Promise<T>): Promise<T> => fn() },
    attempt,
    maxAttempts,
    runId: "run_test",
  };
}

const FINAL = 2; // attempt index of the last of 3 attempts (0,1,2)
const NON_FINAL = 0;

beforeEach(() => {
  dlqRows.length = 0;
  releasedKeys.length = 0;
});

// ── emailSendFn ──────────────────────────────────────────────────────────────
// templateId routes resolve-content through TemplateService (mocked to throw).
const emailData = { email: "buyer@example.com", templateId: "welcome", type: "marketing" };

test("emailSendFn: final-attempt failure lands the job in jobs_dead_letter + releases the guard", async () => {
  const { runEmailSend } = await load();
  await assert.rejects(() => runEmailSend(ctx(emailData, FINAL) as never), /email dispatch boom/);
  assert.equal(dlqRows.length, 1, "one DLQ row on final attempt");
  assert.equal(dlqRows[0]!.event_name, "autolenis/email.send");
  assert.equal(releasedKeys.length, 1, "guard released so a re-emit can re-drive");
});

test("emailSendFn: non-final failure does NOT dead-letter or release (Inngest will retry)", async () => {
  const { runEmailSend } = await load();
  await assert.rejects(() => runEmailSend(ctx(emailData, NON_FINAL) as never), /email dispatch boom/);
  assert.equal(dlqRows.length, 0, "no DLQ row before the final attempt");
  assert.equal(releasedKeys.length, 0, "guard held across retries");
});

// S3 invariant: a TRANSACTIONAL send (idempotencyKey + no contactId) dedups on
// EmailSendLog and is retriable — it must NEVER dead-letter (nor release, since it
// takes no idempotency_keys guard), even on the final attempt.
const emailTxnData = {
  email: "buyer@example.com",
  idempotencyKey: "deal-selected-d1",
  templateId: "deal-selected",
  type: "transactional",
};

test("emailSendFn: TRANSACTIONAL final failure does NOT dead-letter or release", async () => {
  const { runEmailSend } = await load();
  await assert.rejects(() => runEmailSend(ctx(emailTxnData, FINAL) as never), /email dispatch boom/);
  assert.equal(dlqRows.length, 0, "transactional failures ride EmailSendLog, never the DLQ");
  assert.equal(releasedKeys.length, 0, "transactional path holds no guard to release");
});

// ── smsSendFn ────────────────────────────────────────────────────────────────
const smsData = { contactId: "c1", phone: "+15555550123", body: "hi" };

test("smsSendFn: final-attempt failure lands the job in jobs_dead_letter + releases the guard", async () => {
  const { runSmsSend } = await load();
  await assert.rejects(() => runSmsSend(ctx(smsData, FINAL) as never), /twilio dispatch boom/);
  assert.equal(dlqRows.length, 1);
  assert.equal(dlqRows[0]!.event_name, "autolenis/sms.send");
  assert.equal(releasedKeys.length, 1, "guard released so a re-emit can re-drive");
});

test("smsSendFn: non-final failure does NOT dead-letter or release", async () => {
  const { runSmsSend } = await load();
  await assert.rejects(() => runSmsSend(ctx(smsData, NON_FINAL) as never), /twilio dispatch boom/);
  assert.equal(dlqRows.length, 0);
  assert.equal(releasedKeys.length, 0);
});

// ── workflowResumeFn ─────────────────────────────────────────────────────────
const wfData = { enrollment_id: "e1", node_id: "n1" };

test("workflowResumeFn: final-attempt failure lands the job in jobs_dead_letter", async () => {
  const { runWorkflowResume } = await load();
  await assert.rejects(() => runWorkflowResume(ctx(wfData, FINAL) as never), /workflow resume boom/);
  assert.equal(dlqRows.length, 1);
  assert.equal(dlqRows[0]!.event_name, "autolenis/workflow.resume");
});

test("workflowResumeFn: non-final failure does NOT dead-letter", async () => {
  const { runWorkflowResume } = await load();
  await assert.rejects(() => runWorkflowResume(ctx(wfData, NON_FINAL) as never), /workflow resume boom/);
  assert.equal(dlqRows.length, 0);
});
