// Batch 2 — outreach reports execution status, not just a count.
//
// The dealer-sourcing spine is REQUIRED, so outreach must distinguish a valid
// ZERO_RESULTS (no eligible prospects) from a FAILED run (infra error, or eligible
// prospects existed but EVERY send failed). This is the signal the pipeline uses
// to decide whether intake may complete.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/post-intake-outreach-status.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let opp: Record<string, unknown> | null;
let prospectRows: Array<Record<string, unknown>> = [];
let prospectFindThrows = false;
// $99 pre-activation gate: default PAID so the existing status tests exercise the
// post-gate outreach logic; the gate itself is covered by a dedicated test below.
let depositPaid = true;
let sendResult: () => { success: boolean; error?: string; reason?: string } = () => ({ success: true });

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: { findUnique: async () => opp },
      buyer: { findUnique: async () => ({ city: "Dallas", state: "TX" }) },
      deposit: { findFirst: async () => (depositPaid ? { id: "dep_1" } : null) },
      dealerProspect: {
        findMany: async () => {
          if (prospectFindThrows) throw new Error("db connection lost");
          return prospectRows;
        },
      },
    },
  },
});
mock.module("@/lib/services/dealer-recruitment/email-template.service", {
  namedExports: { generateBuyerOpportunityEmail: () => ({ subject: "s", html: "h", text: "t" }) },
});
mock.module("@/lib/services/dealer-recruitment/dealer-email-send.service", {
  namedExports: { sendDealerEmail: async () => sendResult() },
});
mock.module("@/lib/services/dealer-recruitment/shared-inbox", {
  namedExports: { collapseByInbox: (rows: unknown[]) => rows },
});

async function load() {
  return (await import("@/lib/services/acquisition/post-intake-outreach.service")).runPostIntakeOutreach;
}

beforeEach(() => {
  opp = { id: "opp_1", buyerId: "b1", make: "Toyota", model: "Camry", yearMin: null, yearMax: null, budgetAmount: 30000, vehicleType: "used", timeline: "this_week", zip: "75001" };
  prospectRows = [];
  prospectFindThrows = false;
  depositPaid = true;
  sendResult = () => ({ success: true });
});

// $99 PRE-ACTIVATION COST GATE — no PAID deposit ⇒ outreach never fires.
test("no PAID $99 deposit → SKIPPED (awaiting_deposit_gate), prospects never fetched/contacted", async () => {
  depositPaid = false;
  prospectRows = [{ id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" }];
  sendResult = () => ({ success: true });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "SKIPPED");
  assert.equal(r.reason, "awaiting_deposit_gate");
  assert.equal(r.dealersContacted, 0, "an unpaid buyer never triggers dealer outreach");
});

test("anonymous opportunity (no buyerId) → SKIPPED (cannot have paid)", async () => {
  opp = { ...(opp as object), buyerId: null };
  prospectRows = [{ id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" }];
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "SKIPPED");
  assert.equal(r.reason, "awaiting_deposit_gate");
});

test("no make → SKIPPED", async () => {
  opp = { ...(opp as object), make: null };
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "SKIPPED");
  assert.equal(r.dealersContacted, 0);
});

test("0 eligible prospects → ZERO_RESULTS (valid, non-blocking)", async () => {
  prospectRows = [];
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "ZERO_RESULTS");
});

test("prospects exist and a send succeeds → SUCCESS", async () => {
  prospectRows = [{ id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" }];
  sendResult = () => ({ success: true });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "SUCCESS");
  assert.equal(r.dealersContacted, 1);
});

test("prospects exist but EVERY send is a GENUINE error → FAILED (execution failure)", async () => {
  prospectRows = [{ id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" }];
  sendResult = () => ({ success: false, reason: "send_error", error: "provider 500" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "FAILED");
  assert.equal(r.dealersContacted, 0);
});

test("every send RATE-LIMITED → DEFERRED (transient throttle, not a failure)", async () => {
  prospectRows = [{ id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" }];
  sendResult = () => ({ success: false, reason: "rate_limited", error: "Rate limit exceeded" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "DEFERRED", "a self-clearing throttle must not be a failure");
  assert.equal(r.dealersContacted, 0);
});

test("every prospect SUPPRESSED/undeliverable → ZERO_RESULTS (uncontactable, valid completion)", async () => {
  prospectRows = [
    { id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" },
    { id: "p2", name: "D2", contactName: null, email: "d2@x.com", city: "Dallas", state: "TX" },
  ];
  sendResult = () => ({ success: false, reason: "suppressed", error: "Recipient is suppressed" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "ZERO_RESULTS", "unreachable dealers is a valid zero-result, retrying is futile");
});

test("a genuine error alongside rate-limits still → FAILED (error dominates)", async () => {
  prospectRows = [
    { id: "p1", name: "D1", contactName: null, email: "d1@x.com", city: "Dallas", state: "TX" },
    { id: "p2", name: "D2", contactName: null, email: "d2@x.com", city: "Dallas", state: "TX" },
  ];
  let n = 0;
  sendResult = () => (n++ === 0 ? { success: false, reason: "rate_limited", error: "rl" } : { success: false, reason: "send_error", error: "500" });
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "FAILED");
});

test("infra error loading prospects → FAILED", async () => {
  prospectFindThrows = true;
  const run = await load();
  const r = await run("opp_1");
  assert.equal(r.status, "FAILED");
});
