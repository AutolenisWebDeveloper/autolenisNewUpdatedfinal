// Task 7 — the dealer prospect status machine.
//
// DealerProspectStatus ALREADY carries every value this needs — DISCOVERED,
// SCRIPTED, DRAFTED, CONTACTED, REPLIED, ONBOARDED, DEAD — so no enum migration
// is involved. What was missing is the machine: which transitions are legal,
// which are refused, and what a transition must record.
//
// The matrix is asserted exhaustively rather than by example. A test that only
// checks the happy path proves the legal transitions work; it says nothing about
// whether an ILLEGAL one is refused, which is the half that protects the data.

import test from "node:test";
import assert from "node:assert/strict";
import { DealerProspectStatus } from "@prisma/client";

import {
  canTransition,
  transitionProspect,
  TRANSITIONS,
  TERMINAL,
  type StatusTransitionDeps,
} from "../dealer-prospect-status.service";

const ALL = Object.values(DealerProspectStatus);

interface Harness {
  deps: Partial<StatusTransitionDeps>;
  updates: () => { from: string; to: string; data: Record<string, unknown> }[];
  audits: () => Record<string, unknown>[];
}

function harness(opts: { current: DealerProspectStatus; updateCount?: number }): Harness {
  const updates: { from: string; to: string; data: Record<string, unknown> }[] = [];
  const audits: Record<string, unknown>[] = [];
  return {
    updates: () => updates,
    audits: () => audits,
    deps: {
      now: new Date("2026-08-31T00:00:00Z"),
      loadStatus: async () => opts.current,
      applyTransition: async (_id, from, to, data) => {
        updates.push({ from, to, data });
        return opts.updateCount ?? 1;
      },
      writeAudit: async (a) => { audits.push(a as unknown as Record<string, unknown>); },
    },
  };
}

// ─── the matrix, asserted exhaustively ──────────────────────────────────────

test("the happy path is reachable end to end", () => {
  const path: DealerProspectStatus[] = ["DISCOVERED", "SCRIPTED", "CONTACTED", "REPLIED", "ONBOARDED"];
  for (let i = 0; i < path.length - 1; i++) {
    assert.ok(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]} must be legal`);
  }
});

test("DEAD is reachable from every non-terminal state", () => {
  for (const s of ALL.filter((s) => !TERMINAL.includes(s))) {
    assert.ok(canTransition(s, "DEAD"), `${s} -> DEAD must be legal`);
  }
});

test("no state transitions to itself", () => {
  for (const s of ALL) assert.equal(canTransition(s, s), false, `${s} -> ${s} must be illegal`);
});

test("terminal states go nowhere", () => {
  for (const t of TERMINAL) {
    for (const to of ALL) {
      assert.equal(canTransition(t, to), false, `${t} -> ${to} must be illegal (terminal)`);
    }
  }
});

test("skipping forward is refused", () => {
  const illegal: Array<[DealerProspectStatus, DealerProspectStatus]> = [
    ["DISCOVERED", "ONBOARDED"],
    ["DISCOVERED", "REPLIED"],
    ["SCRIPTED", "ONBOARDED"],
    ["CONTACTED", "ONBOARDED"],
  ];
  for (const [from, to] of illegal) {
    assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`);
  }
});

test("going backwards is refused", () => {
  const illegal: Array<[DealerProspectStatus, DealerProspectStatus]> = [
    ["CONTACTED", "DISCOVERED"],
    ["REPLIED", "SCRIPTED"],
    ["ONBOARDED", "REPLIED"],
  ];
  for (const [from, to] of illegal) {
    assert.equal(canTransition(from, to), false, `${from} -> ${to} must be illegal`);
  }
});

test("every state pair is decided — the matrix has no undefined holes", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      assert.equal(typeof canTransition(from, to), "boolean", `${from} -> ${to} is undecided`);
    }
  }
});

test("TRANSITIONS declares an entry for every status, so a new value cannot be forgotten", () => {
  for (const s of ALL) {
    assert.ok(Array.isArray(TRANSITIONS[s]), `TRANSITIONS is missing ${s}`);
  }
});

// ─── dead_reason is mandatory ───────────────────────────────────────────────

test("DEAD without a reason is REJECTED and writes nothing", async () => {
  const h = harness({ current: "SCRIPTED" });
  const r = await transitionProspect({ prospectId: "p1", to: "DEAD", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "DEAD_REASON_REQUIRED");
  assert.equal(h.updates().length, 0, "a rejected transition must not write");
  assert.equal(h.audits().length, 0);
});

test("a whitespace-only dead reason is rejected", async () => {
  const h = harness({ current: "SCRIPTED" });
  const r = await transitionProspect(
    { prospectId: "p1", to: "DEAD", deadReason: "   \n\t ", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "DEAD_REASON_REQUIRED");
});

test("DEAD with a reason is accepted and stamps dead_at plus the reason", async () => {
  const h = harness({ current: "SCRIPTED" });
  const r = await transitionProspect(
    { prospectId: "p1", to: "DEAD", deadReason: "  Declined — franchise conflict  ", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, true);
  const d = h.updates()[0].data;
  assert.equal(d.deadReason, "Declined — franchise conflict", "the reason is trimmed before storage");
  assert.ok(d.deadAt instanceof Date);
});

// ─── writes and guards ──────────────────────────────────────────────────────

test("an illegal transition is refused without writing", async () => {
  const h = harness({ current: "DISCOVERED" });
  const r = await transitionProspect({ prospectId: "p1", to: "ONBOARDED", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "ILLEGAL_TRANSITION");
  assert.equal(h.updates().length, 0);
});

test("a legal transition stamps the matching timestamp column", async () => {
  const cases: Array<[DealerProspectStatus, DealerProspectStatus, string]> = [
    ["DISCOVERED", "SCRIPTED", "scriptedAt"],
    ["SCRIPTED", "CONTACTED", "contactedAt"],
    ["CONTACTED", "REPLIED", "repliedAt"],
    ["REPLIED", "ONBOARDED", "onboardedAt"],
  ];
  for (const [from, to, column] of cases) {
    const h = harness({ current: from });
    const r = await transitionProspect({ prospectId: "p1", to, actorId: "admin-1" }, h.deps);
    assert.equal(r.ok, true, `${from} -> ${to} should succeed`);
    assert.ok(h.updates()[0].data[column] instanceof Date, `${to} must stamp ${column}`);
  }
});

test("the write is GUARDED on the current status, so a concurrent transition applies once", async () => {
  // applyTransition returns the number of rows matched. Zero means another
  // writer moved the prospect first — an updateMany guarded on `from`, the same
  // pattern the credit ledger uses.
  const h = harness({ current: "SCRIPTED", updateCount: 0 });
  const r = await transitionProspect({ prospectId: "p1", to: "CONTACTED", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "CONCURRENT_TRANSITION");
  assert.equal(h.updates()[0].from, "SCRIPTED", "the guard must carry the expected from-status");
});

test("an accepted transition writes an audit row naming actor, from and to", async () => {
  const h = harness({ current: "SCRIPTED" });
  await transitionProspect({ prospectId: "p1", to: "CONTACTED", actorId: "admin-1" }, h.deps);
  const a = h.audits()[0];
  assert.equal(h.audits().length, 1);
  assert.equal(a.actorId, "admin-1");
  assert.equal(a.from, "SCRIPTED");
  assert.equal(a.to, "CONTACTED");
  assert.equal(a.prospectId, "p1");
});

test("a missing prospect is reported, not treated as a failed transition", async () => {
  const h = harness({ current: "SCRIPTED" });
  h.deps.loadStatus = async () => null;
  const r = await transitionProspect({ prospectId: "ghost", to: "CONTACTED", actorId: "admin-1" }, h.deps);
  assert.equal(r.ok, false);
  assert.equal(r.error, "NOT_FOUND");
  assert.equal(h.updates().length, 0);
});
