// Task 5 — async reveal polling with distinct persisted terminal states.
//
// Apollo can answer a reveal asynchronously: it returns a request_id and the
// answer arrives later. Four outcomes are genuinely different and must not be
// collapsed into one "it didn't work":
//
//   pending          the answer may still arrive — the request is NOT dead
//   expired          Apollo discarded the request; a new one is needed
//   unknown_request  Apollo has never heard of this id; retrying it is futile
//   failed           a transport or server error; the cause is recorded
//
// Collapsing these is what produces a queue nobody can drain: an operator
// looking at "failed" cannot tell whether to wait, re-request, or investigate.
// A credit may already have been spent on any of them, so the distinction is
// also what makes spend auditable after the fact.
//
// Polling is bounded. An unbounded poll against a paid API is never acceptable,
// and a request that stays pending past the ceiling is persisted as
// PENDING_REVEAL — resumable, not lost.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  drainReveal,
  MAX_REVEAL_POLLS,
  type RevealPollOutcome,
  type DrainRevealDeps,
} from "../apollo-async-reveal.service";

const NOW = new Date("2026-08-31T00:00:00Z");

interface Harness {
  deps: Partial<DrainRevealDeps>;
  polls: () => number;
  candidate: () => Record<string, unknown> | null;
  contact: () => Record<string, unknown> | null;
}

function harness(outcomes: RevealPollOutcome[] | RevealPollOutcome): Harness {
  const seq = Array.isArray(outcomes) ? [...outcomes] : null;
  let polls = 0;
  let candidate: Record<string, unknown> | null = null;
  let contact: Record<string, unknown> | null = null;
  return {
    polls: () => polls,
    candidate: () => candidate,
    contact: () => contact,
    deps: {
      now: NOW,
      sleep: async () => {},
      poll: async () => {
        polls += 1;
        if (seq) return seq.length > 1 ? (seq.shift() as RevealPollOutcome) : seq[0];
        return outcomes as RevealPollOutcome;
      },
      updateCandidate: async (_id, data) => { candidate = data; },
      persistContact: async (c) => { contact = c as unknown as Record<string, unknown>; },
    },
  };
}

const REQ = { candidateId: "cand_1", apolloPersonId: "p1", rooftopId: "rt_1", revealRequestId: "req_1" };

let h: Harness;
beforeEach(() => { h = harness({ kind: "pending" }); });

test("a ready reveal persists the contact and marks the candidate ENRICHED", async () => {
  h = harness({ kind: "ready", email: "a@dealer.invalid", phone: null, dncStatus: "not_found", phoneType: "corporate_phone" });
  const r = await drainReveal(REQ, h.deps);
  assert.equal(r.terminal, true);
  assert.equal(h.candidate()?.enrichmentStatus, "ENRICHED");
  assert.equal(h.contact()?.email, "a@dealer.invalid");
  assert.equal(h.contact()?.dncStatus, "not_found");
  assert.equal(h.contact()?.phoneType, "corporate_phone");
});

test("expired is terminal and distinct — a new request is needed", async () => {
  h = harness({ kind: "expired" });
  const r = await drainReveal(REQ, h.deps);
  assert.equal(r.terminal, true);
  assert.equal(h.candidate()?.enrichmentStatus, "EXPIRED");
  assert.equal(h.contact(), null, "an expired request reveals nothing to persist");
});

test("an unknown request id is terminal and distinct — retrying it is futile", async () => {
  h = harness({ kind: "unknown_request" });
  await drainReveal(REQ, h.deps);
  assert.equal(h.candidate()?.enrichmentStatus, "UNKNOWN_REQUEST");
});

test("a hard failure is terminal, distinct, and records the cause", async () => {
  h = harness({ kind: "failed", error: "HTTP 500 from apollo" });
  const r = await drainReveal(REQ, h.deps);
  assert.equal(r.terminal, true);
  assert.equal(h.candidate()?.enrichmentStatus, "FAILED");
  assert.match(String(h.candidate()?.enrichmentError ?? ""), /HTTP 500/);
});

test("the four non-ready outcomes map to four DIFFERENT statuses", async () => {
  const seen = new Map<string, string>();
  for (const outcome of [
    { kind: "pending" } as const,
    { kind: "expired" } as const,
    { kind: "unknown_request" } as const,
    { kind: "failed", error: "x" } as const,
  ]) {
    const local = harness(outcome);
    await drainReveal(REQ, local.deps);
    seen.set(outcome.kind, String(local.candidate()?.enrichmentStatus));
  }
  const statuses = [...seen.values()];
  assert.equal(new Set(statuses).size, 4, `collapsed statuses: ${JSON.stringify([...seen])}`);
});

test("polling is bounded and a still-pending request is PENDING_REVEAL, not lost", async () => {
  h = harness({ kind: "pending" });
  const r = await drainReveal(REQ, h.deps);
  assert.equal(h.polls(), MAX_REVEAL_POLLS, "must stop at the ceiling, never loop forever");
  assert.equal(r.terminal, false, "pending is not terminal — the answer may still arrive");
  assert.equal(h.candidate()?.enrichmentStatus, "PENDING_REVEAL");
  assert.equal(h.candidate()?.revealPollCount, MAX_REVEAL_POLLS);
});

test("polling stops as soon as a terminal answer arrives", async () => {
  h = harness([{ kind: "pending" }, { kind: "ready", email: "b@dealer.invalid", phone: null, dncStatus: null, phoneType: null }]);
  await drainReveal(REQ, h.deps);
  assert.equal(h.polls(), 2, "must not keep polling after a terminal answer");
  assert.equal(h.candidate()?.enrichmentStatus, "ENRICHED");
});

test("a ready reveal with no email and no phone is UNREACHABLE, never fabricated", async () => {
  h = harness({ kind: "ready", email: null, phone: null, dncStatus: null, phoneType: null });
  await drainReveal(REQ, h.deps);
  assert.equal(h.candidate()?.enrichmentStatus, "UNREACHABLE");
  assert.equal(h.contact()?.email, null);
  assert.equal(h.contact()?.phone, null);
});

test("dnc_status is persisted VERBATIM — 'pending' is not rewritten to a clearance", async () => {
  h = harness({ kind: "ready", email: null, phone: "+15125551212", dncStatus: "pending", phoneType: "mobile_phone" });
  await drainReveal(REQ, h.deps);
  assert.equal(h.contact()?.dncStatus, "pending");
  assert.ok(h.contact()?.dncCheckedAt instanceof Date);
});

test("a poll that THROWS is recorded FAILED rather than escaping", async () => {
  const local = harness({ kind: "pending" });
  local.deps.poll = async () => { throw new Error("ECONNRESET"); };
  const r = await drainReveal(REQ, local.deps);
  assert.equal(r.terminal, true);
  assert.equal(local.candidate()?.enrichmentStatus, "FAILED");
  assert.match(String(local.candidate()?.enrichmentError ?? ""), /ECONNRESET/);
});

test("a candidate with no rooftop still records its terminal status", async () => {
  // The link is missing, but the reveal outcome is still information — and a
  // credit may already have been spent on it.
  const local = harness({ kind: "ready", email: "c@dealer.invalid", phone: null, dncStatus: null, phoneType: null });
  await drainReveal({ ...REQ, rooftopId: null }, local.deps);
  assert.equal(local.contact(), null, "nowhere to file the contact");
  assert.ok(local.candidate()?.enrichmentStatus, "the candidate must still be updated");
});

test("every drain records the poll count, so a stuck request is visible", async () => {
  h = harness([{ kind: "pending" }, { kind: "expired" }]);
  await drainReveal(REQ, h.deps);
  assert.equal(h.candidate()?.revealPollCount, 2);
});
