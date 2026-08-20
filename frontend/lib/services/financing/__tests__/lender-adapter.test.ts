// Phase 5 Block 2 — pluggable lender-integration adapter. The adapter is the seam
// to a real credit source (RouteOne/Dealertrack-style); we build against a scripted
// mock. The submit wrapper FAILS CLOSED on missing credentials / entitlement /
// timeout / adapter error (never a silent "approved"), records every call on the
// tamper-evident audit trail, and NEVER writes applicant PII (SSN/income) into the
// audit payload. The mock is a scripted test double — it contains NO invented
// credit-decisioning logic; the caller scripts the outcome.
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const audit = { events: [] as Array<Record<string, unknown>> };

mock.module("@/lib/services/financing/financing-audit.service", {
  namedExports: {
    appendFinancingAuditEvent: async (e: Record<string, unknown>) => {
      audit.events.push(e);
      return { id: "evt", ...e };
    },
  },
});

const SUBMISSION = {
  applicationId: "app_1",
  amountRequestedCents: 2_500_000,
  termMonths: 60,
  vehicle: { vin: "1HGCM82633A004352", year: 2022, priceCents: 2_600_000 },
  applicant: { ssn: "123-45-6789", annualIncomeCents: 9_000_000 },
};

beforeEach(() => {
  audit.events = [];
});

test("configured adapter returns the scripted decision and records an ADAPTER_CALL (ok)", async () => {
  const { MockLenderAdapter } = await import("@/lib/services/financing/lender/mock-lender-adapter");
  const { submitCreditApplication } = await import("@/lib/services/financing/lender/lender-service");
  const adapter = new MockLenderAdapter({
    configured: true,
    scenario: { outcome: "APPROVED", lenderReferenceId: "L-1", approvedAmountCents: 2_500_000, aprRate: 7.9, termMonths: 60, monthlyPaymentCents: 50_400 },
  });
  const res = await submitCreditApplication(adapter, SUBMISSION as never, { creditApplicationId: "app_1", dealId: "deal_1", buyerId: "b1" });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.decision.outcome, "APPROVED");
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]!.eventType, "ADAPTER_CALL");
  const payload = audit.events[0]!.payload as Record<string, unknown>;
  assert.equal(payload.ok, true);
  assert.equal(payload.outcome, "APPROVED");
});

test("the audit payload NEVER contains applicant PII (SSN / income)", async () => {
  const { MockLenderAdapter } = await import("@/lib/services/financing/lender/mock-lender-adapter");
  const { submitCreditApplication } = await import("@/lib/services/financing/lender/lender-service");
  const adapter = new MockLenderAdapter({ configured: true, scenario: { outcome: "DECLINED", declineReasonCodes: ["07"] } });
  await submitCreditApplication(adapter, SUBMISSION as never, { creditApplicationId: "app_1" });
  const serialized = JSON.stringify(audit.events);
  // String-scan (catches literal leaks) …
  assert.equal(serialized.includes("123-45-6789"), false, "SSN must never reach the audit trail");
  assert.equal(serialized.includes("9000000"), false, "income must never reach the audit trail");
  // … and structural: the payload keys are a strict subset of the non-PII allowlist,
  // so a reformatted PII leak (SSN without dashes, income as dollars) is caught too.
  const ALLOWED = new Set(["adapter", "ok", "phase", "outcome", "error"]);
  const payloadKeys = Object.keys(audit.events[0]!.payload as Record<string, unknown>);
  assert.ok(payloadKeys.every((k) => ALLOWED.has(k)), `audit payload keys ⊆ allowlist, got: ${payloadKeys.join(",")}`);
});

test("FAIL CLOSED on missing credentials — submit() is never called", async () => {
  const { MockLenderAdapter } = await import("@/lib/services/financing/lender/mock-lender-adapter");
  const { submitCreditApplication } = await import("@/lib/services/financing/lender/lender-service");
  const adapter = new MockLenderAdapter({ configured: false, scenario: { outcome: "APPROVED" } });
  const res = await submitCreditApplication(adapter, SUBMISSION as never, { creditApplicationId: "app_1" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "MISSING_CREDENTIALS");
  assert.equal(adapter.submitCallCount, 0, "an unconfigured adapter must not be called");
  assert.equal(audit.events[0]!.eventType, "ADAPTER_CALL");
  assert.equal((audit.events[0]!.payload as Record<string, unknown>).ok, false);
});

test("FAIL CLOSED when the adapter throws (mapped to ADAPTER_ERROR)", async () => {
  const { MockLenderAdapter } = await import("@/lib/services/financing/lender/mock-lender-adapter");
  const { submitCreditApplication } = await import("@/lib/services/financing/lender/lender-service");
  const adapter = new MockLenderAdapter({ configured: true, throwOnSubmit: new Error("connection reset") });
  const res = await submitCreditApplication(adapter, SUBMISSION as never, {});
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "ADAPTER_ERROR");
  assert.equal((audit.events[0]!.payload as Record<string, unknown>).ok, false);
});

test("FAIL CLOSED on timeout", async () => {
  const { MockLenderAdapter } = await import("@/lib/services/financing/lender/mock-lender-adapter");
  const { submitCreditApplication } = await import("@/lib/services/financing/lender/lender-service");
  // A caller-controlled gate makes the hang deterministic and drainable — no
  // dangling timer/promise for node:test to flag when the test ends.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const adapter = new MockLenderAdapter({ configured: true, hangUntil: gate, scenario: { outcome: "APPROVED" } });
  const res = await submitCreditApplication(adapter, SUBMISSION as never, {}, { timeoutMs: 15 });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "TIMEOUT");
  release();      // let the mock's submit settle now
  await gate;     // ensure nothing is left pending

});

test("getLenderAdapter falls back to the mock and is fail-closed for an unknown named adapter", async () => {
  const { getLenderAdapter } = await import("@/lib/services/financing/lender/lender-service");
  const fallback = getLenderAdapter();
  assert.ok(fallback, "a default adapter is always available for the build");
  const unknown = getLenderAdapter("no-such-lender");
  // Unknown named adapter must be reported unconfigured (fail-closed), never a real submit.
  assert.equal(unknown.isConfigured(), false);
});
