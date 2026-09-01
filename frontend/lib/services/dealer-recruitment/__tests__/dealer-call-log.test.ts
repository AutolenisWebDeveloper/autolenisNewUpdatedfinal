// Task 8b — manual call logging. THE shipping deliverable of Phase 3.
//
// Phone coverage across dealer_prospects is 1,527/1,532 (99.7%); email coverage
// is 167 (10.9%). Those phone numbers are the addressable audience, and a human
// picking up the phone needs no consent basis — TCPA governs automated messaging
// and dialling, not an operator recording that a call took place.
//
// So this ships ENABLED while SMS ships off. It is what turns 1,527 numbers into
// recorded outreach today.
//
// Two gates are deliberately NOT applied here, and the distinction matters:
//
//   the send flag  gates DISPATCH. Nothing is dispatched; a human already acted.
//   dnc_status     gates DIALLING. Recording a call that already happened is
//                  bookkeeping, and refusing to record it would delete the
//                  evidence rather than prevent the act — including, especially,
//                  a call that should not have been made.

import test from "node:test";
import assert from "node:assert/strict";

import {
  logDealerCall,
  CALL_DISPOSITIONS,
  CONNECTED_DISPOSITIONS,
  type CallDisposition,
  type DealerCallLogDeps,
} from "../dealer-call-log.service";

const NOW = new Date("2026-08-31T00:00:00Z");

interface Harness {
  deps: Partial<DealerCallLogDeps>;
  rows: () => Record<string, unknown>[];
  transitions: () => { to: string }[];
}

function harness(opts: { currentStatus?: string; sendEnabled?: boolean } = {}): Harness {
  const rows: Record<string, unknown>[] = [];
  const transitions: { to: string }[] = [];
  return {
    rows: () => rows,
    transitions: () => transitions,
    deps: {
      now: NOW,
      // Present so a test can prove they are NOT consulted.
      sendEnabled: () => opts.sendEnabled ?? false,
      loadProspect: async () => ({ id: "p1", status: opts.currentStatus ?? "SCRIPTED", phone: "+15125551212" }),
      createLog: async (data) => {
        rows.push(data as unknown as Record<string, unknown>);
        return { id: `log_${rows.length}` };
      },
      advanceStatus: async (_id, to) => { transitions.push({ to }); return true; },
    },
  };
}

const CALL = { prospectId: "p1", disposition: "CONNECTED" as CallDisposition, durationSeconds: 214, notes: "Spoke to the GM", actorId: "admin-1" };

test("a logged call writes exactly one CALL row with disposition, duration and notes", async () => {
  const h = harness();
  const r = await logDealerCall(CALL, h.deps);
  assert.ok(r.logId);
  assert.equal(h.rows().length, 1);
  const row = h.rows()[0];
  assert.equal(row.channel, "CALL");
  assert.equal(row.status, "sent");
  assert.equal(row.callDisposition, "CONNECTED");
  assert.equal(row.callDurationSeconds, 214);
  assert.equal(row.body, "Spoke to the GM");
  assert.equal(row.toPhone, "+15125551212");
});

test("call logging does NOT consult the send flag — a human already acted", async () => {
  const h = harness({ sendEnabled: false });
  const r = await logDealerCall(CALL, h.deps);
  assert.equal(r.ok, true, "recording a completed call is not a dispatch");
  assert.equal(h.rows().length, 1);
});

test("call logging is NOT blocked by DNC — that gates dialling, not bookkeeping", async () => {
  // Refusing to record a call to a DNC number would delete the evidence rather
  // than prevent the act. A call that should not have been made is precisely the
  // one that must be on the record.
  const h = harness();
  const r = await logDealerCall({ ...CALL, disposition: "WRONG_NUMBER", durationSeconds: 12 }, h.deps);
  assert.equal(r.ok, true);
  assert.equal(h.rows().length, 1);
});

test("an invalid disposition is rejected without writing", async () => {
  const h = harness();
  const r = await logDealerCall({ ...CALL, disposition: "MADE_UP" as CallDisposition }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "INVALID_DISPOSITION");
  assert.equal(h.rows().length, 0);
});

test("every declared disposition is accepted", async () => {
  for (const disposition of CALL_DISPOSITIONS) {
    const h = harness();
    const r = await logDealerCall({ ...CALL, disposition }, h.deps);
    assert.equal(r.ok, true, `${disposition} should be accepted`);
  }
});

test("a negative or non-finite duration is rejected without writing", async () => {
  for (const durationSeconds of [-5, NaN, Infinity]) {
    const h = harness();
    const r = await logDealerCall({ ...CALL, durationSeconds }, h.deps);
    assert.equal(r.ok, false, `duration ${durationSeconds} must be rejected`);
    assert.equal(r.error, "INVALID_DURATION");
    assert.equal(h.rows().length, 0);
  }
});

test("a zero duration is valid — a no-answer call still took time and happened", async () => {
  const h = harness();
  const r = await logDealerCall({ ...CALL, disposition: "NO_ANSWER", durationSeconds: 0 }, h.deps);
  assert.equal(r.ok, true);
});

test("two calls to the same prospect BOTH log — calls are not idempotent by step", async () => {
  // Unlike an email step, a second real call is a second real event. Deduping
  // them would erase attempt history, which is the point of the log.
  const h = harness();
  await logDealerCall({ ...CALL, disposition: "NO_ANSWER", durationSeconds: 0 }, h.deps);
  await logDealerCall({ ...CALL, disposition: "CONNECTED", durationSeconds: 90 }, h.deps);
  assert.equal(h.rows().length, 2);
});

test("a CONNECTED call advances DISCOVERED and SCRIPTED to CONTACTED", async () => {
  for (const from of ["DISCOVERED", "SCRIPTED"]) {
    const h = harness({ currentStatus: from });
    await logDealerCall(CALL, h.deps);
    assert.deepEqual(h.transitions(), [{ to: "CONTACTED" }], `${from} should advance`);
  }
});

test("a non-connecting disposition does NOT advance status", async () => {
  for (const disposition of CALL_DISPOSITIONS.filter((d) => !CONNECTED_DISPOSITIONS.includes(d))) {
    const h = harness({ currentStatus: "SCRIPTED" });
    await logDealerCall({ ...CALL, disposition, durationSeconds: 0 }, h.deps);
    assert.equal(h.transitions().length, 0, `${disposition} must not advance status`);
  }
});

test("a call on an already-advanced prospect does not move it backwards", async () => {
  const h = harness({ currentStatus: "REPLIED" });
  await logDealerCall(CALL, h.deps);
  assert.equal(h.transitions().length, 0, "CONTACTED would be a regression from REPLIED");
});

test("the row is still written when the status advance fails", async () => {
  // The call happened. A bookkeeping failure downstream must not erase it.
  const h = harness({ currentStatus: "SCRIPTED" });
  h.deps.advanceStatus = async () => { throw new Error("db down"); };
  const r = await logDealerCall(CALL, h.deps);
  assert.equal(r.ok, true);
  assert.equal(h.rows().length, 1);
});

test("a missing prospect is reported and nothing is written", async () => {
  const h = harness();
  h.deps.loadProspect = async () => null;
  const r = await logDealerCall({ ...CALL, prospectId: "ghost" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "NOT_FOUND");
  assert.equal(h.rows().length, 0);
});

test("notes are trimmed and an empty note stores null rather than whitespace", async () => {
  const h = harness();
  await logDealerCall({ ...CALL, notes: "   " }, h.deps);
  assert.equal(h.rows()[0].body, null);
});

test("the row records consent_basis so a phone-channel audit can reconstruct it", async () => {
  const h = harness();
  await logDealerCall(CALL, h.deps);
  // A manual call's basis is the operator's own action, recorded as such rather
  // than left null — null would be indistinguishable from "never considered".
  assert.equal(h.rows()[0].consentBasis, "MANUAL_CALL");
});

// ─── a callback request must not end the call ───────────────────────────────

test("CALLBACK_REQUESTED does NOT advance status — it is the one disposition that means call again", async () => {
  // Named explicitly rather than derived from CONNECTED_DISPOSITIONS, which
  // would make this test agree with whatever the constant happens to say.
  //
  // The defect: CALLBACK_REQUESTED sat in CONNECTED_DISPOSITIONS, so logging it
  // advanced the prospect to CONTACTED. The queue's workable set is
  // [DISCOVERED, SCRIPTED, DRAFTED], so the prospect left the queue the moment
  // an operator recorded that the dealer had asked to be called back — removing
  // from the call list exactly the person who asked to be called.
  for (const from of ["DISCOVERED", "SCRIPTED", "DRAFTED"]) {
    const h = harness({ currentStatus: from });
    const res = await logDealerCall({ ...CALL, disposition: "CALLBACK_REQUESTED" }, h.deps);
    assert.equal(res.ok, true, "the call is still logged");
    assert.equal(h.rows().length, 1, "the row is written either way");
    assert.equal(
      h.transitions().length,
      0,
      `CALLBACK_REQUESTED from ${from} must leave the prospect workable`,
    );
  }
});

test("CONNECTED, GATEKEEPER and NOT_INTERESTED still advance to CONTACTED", async () => {
  // The other side of the same fix: narrowing the set must not stop the three
  // dispositions that genuinely end the attempt from advancing.
  for (const disposition of ["CONNECTED", "GATEKEEPER", "NOT_INTERESTED"] as const) {
    const h = harness({ currentStatus: "SCRIPTED" });
    await logDealerCall({ ...CALL, disposition }, h.deps);
    assert.deepEqual(h.transitions(), [{ to: "CONTACTED" }], `${disposition} should advance`);
  }
});

test("CALLBACK_REQUESTED is a recognised disposition, just not a connecting one", async () => {
  assert.ok(
    (CALL_DISPOSITIONS as readonly string[]).includes("CALLBACK_REQUESTED"),
    "still selectable by an operator",
  );
  assert.ok(
    !CONNECTED_DISPOSITIONS.includes("CALLBACK_REQUESTED"),
    "but never one that closes the prospect out of the queue",
  );
});
