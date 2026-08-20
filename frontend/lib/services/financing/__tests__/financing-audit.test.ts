// Phase 5 Block 1 — tamper-evident, hash-chained financing audit trail. The hash
// signs the full row (who/whose/when/rule/payload), and verify enforces genesis +
// contiguity + (optional) tip anchor, so content tampering, middle-row removal,
// prefix truncation, suffix truncation, and forged appends are all detectable.
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  rows: [] as Array<Record<string, unknown>>,
  compliance: [] as Array<Record<string, unknown>>,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      financingAuditEvent: {
        findFirst: async ({ orderBy }: { orderBy?: unknown }) => {
          void orderBy;
          if (state.rows.length === 0) return null;
          return [...state.rows].sort((a, b) => Number(b.sequence) - Number(a.sequence))[0];
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.rows.push(data);
          return { id: `evt_${data.sequence}`, ...data };
        },
      },
      complianceEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.compliance.push(data);
          return { id: `ce_${state.compliance.length}`, ...data };
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    },
  },
});

const FIXED = {
  prevHash: null,
  sequence: 1,
  eventType: "DECISION_RENDERED",
  actorType: "SYSTEM",
  actorId: "a1",
  creditApplicationId: "app1",
  dealId: "deal1",
  buyerId: "b1",
  ruleId: "r1",
  createdAt: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  state.rows = [];
  state.compliance = [];
});

test("computeEventHash is deterministic + order-independent, and covers nested/array/unicode payloads", async () => {
  const { computeEventHash } = await import("@/lib/services/financing/financing-audit.service");
  const p1 = { z: [3, { b: 2, a: 1 }], name: "José ☕", n: null };
  const p2 = { name: "José ☕", n: null, z: [3, { a: 1, b: 2 }] };
  const a = computeEventHash({ ...FIXED, payload: p1 });
  const b = computeEventHash({ ...FIXED, payload: p2 });
  assert.equal(a, b, "canonical over nested keys/arrays/unicode/null");
  assert.match(a, /^[0-9a-f]{64}$/);
  // Changing an identifying column changes the hash (who/whose/when are signed).
  assert.notEqual(a, computeEventHash({ ...FIXED, payload: p1, actorId: "a2" }));
  assert.notEqual(a, computeEventHash({ ...FIXED, payload: p1, buyerId: "b2" }));
  assert.notEqual(a, computeEventHash({ ...FIXED, payload: p1, createdAt: "2026-09-02T00:00:00.000Z" }));
});

test("appendFinancingAuditEvent chains prevHash→hash and assigns a monotonic sequence", async () => {
  const { appendFinancingAuditEvent } = await import("@/lib/services/financing/financing-audit.service");
  const e1 = await appendFinancingAuditEvent({ eventType: "APPLICATION_SUBMITTED" as never, actorType: "BUYER" as never, buyerId: "b1", payload: { step: 1 } });
  const e2 = await appendFinancingAuditEvent({ eventType: "DECISION_RENDERED" as never, actorType: "SYSTEM" as never, payload: { step: 2 } });
  assert.equal(e1.sequence, 1);
  assert.equal(e1.prevHash, null);
  assert.equal(e2.sequence, 2);
  assert.equal(e2.prevHash, e1.hash);
});

test("mirrors a non-PII breadcrumb into ComplianceEvent when the event concerns a buyer", async () => {
  const { appendFinancingAuditEvent } = await import("@/lib/services/financing/financing-audit.service");
  // Buyer-scoped event → mirrored.
  const e1 = await appendFinancingAuditEvent({
    eventType: "DECISION_RENDERED" as never,
    actorType: "SYSTEM" as never,
    buyerId: "b1",
    creditApplicationId: "app1",
    dealId: "deal1",
    ruleId: "r1",
    payload: { ssn: "123-45-6789", income: 90000 }, // PII in the chain payload...
  });
  assert.equal(state.compliance.length, 1);
  const ce = state.compliance[0]!;
  assert.equal(ce.eventType, "FINANCING_DECISION_RENDERED");
  assert.equal(ce.buyerId, "b1");
  const meta = ce.metadata as Record<string, unknown>;
  assert.equal(meta.financingAuditSequence, e1.sequence);
  assert.equal(meta.financingAuditHash, e1.hash);
  assert.equal(meta.creditApplicationId, "app1");
  assert.equal(meta.dealId, "deal1");
  assert.equal(meta.ruleId, "r1");
  // ...must NOT cross into the compliance mirror.
  assert.equal(JSON.stringify(ce).includes("123-45-6789"), false, "no PII in the mirror");
  assert.equal(JSON.stringify(ce).includes("90000"), false, "no PII in the mirror");

  // Event with no buyer → not mirrored.
  await appendFinancingAuditEvent({ eventType: "NOTICE_SENT" as never, actorType: "SYSTEM" as never, payload: { step: 2 } });
  assert.equal(state.compliance.length, 1, "no buyer ⇒ no compliance mirror");
});

async function buildChain(): Promise<Record<string, unknown>[]> {
  const { appendFinancingAuditEvent } = await import("@/lib/services/financing/financing-audit.service");
  await appendFinancingAuditEvent({ eventType: "APPLICATION_SUBMITTED" as never, actorType: "BUYER" as never, buyerId: "b1", payload: { step: 1 } });
  await appendFinancingAuditEvent({ eventType: "RULE_APPLIED" as never, actorType: "SYSTEM" as never, ruleId: "r1", payload: { step: 2 } });
  await appendFinancingAuditEvent({ eventType: "NOTICE_SENT" as never, actorType: "SYSTEM" as never, payload: { step: 3 } });
  return [...state.rows].sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

test("verify accepts an untampered chain and pinpoints a tampered row (any signed column)", async () => {
  const { verifyFinancingAuditChain } = await import("@/lib/services/financing/financing-audit.service");
  const chain = await buildChain();
  assert.deepEqual(verifyFinancingAuditChain(chain as never[]), { ok: true });

  const tampPayload = chain.map((r) => ({ ...r }));
  (tampPayload[1] as { payload: unknown }).payload = { step: 2, injected: "evil" };
  assert.deepEqual(verifyFinancingAuditChain(tampPayload as never[]), { ok: false, brokenAtSequence: 2 });

  // Tampering an identifying column (reassign who did the override) is also caught.
  const tampWho = chain.map((r) => ({ ...r }));
  (tampWho[1] as { buyerId: string | null }).buyerId = "someone-else";
  assert.deepEqual(verifyFinancingAuditChain(tampWho as never[]), { ok: false, brokenAtSequence: 2 });
});

test("verify detects a removed middle row (contiguity + prevHash break)", async () => {
  const { verifyFinancingAuditChain } = await import("@/lib/services/financing/financing-audit.service");
  const chain = await buildChain();
  const withHole = [chain[0]!, chain[2]!] as never[];
  assert.deepEqual(verifyFinancingAuditChain(withHole), { ok: false, brokenAtSequence: 3 });
});

test("verify detects PREFIX truncation (row 1 must be genesis)", async () => {
  const { verifyFinancingAuditChain } = await import("@/lib/services/financing/financing-audit.service");
  const chain = await buildChain();
  const noHead = [chain[1]!, chain[2]!] as never[]; // drop the genesis row
  const res = verifyFinancingAuditChain(noHead);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.brokenAtSequence, 2, "the new head is not genesis");
});

test("verify detects SUFFIX truncation and forged appends via the tip anchor", async () => {
  const { verifyFinancingAuditChain, appendFinancingAuditEvent } = await import("@/lib/services/financing/financing-audit.service");
  const chain = await buildChain();
  const tip = { sequence: 3, hash: chain[2]!.hash as string };

  // Suffix truncation: drop the last row → tip mismatch.
  const truncated = [chain[0]!, chain[1]!] as never[];
  assert.deepEqual(verifyFinancingAuditChain(truncated, tip), { ok: false, brokenAtSequence: 2 });

  // Forged append with a correctly-recomputed hash is self-consistent (passes
  // without an anchor) but the tip anchor rejects it (unexpected head).
  await appendFinancingAuditEvent({ eventType: "HUMAN_OVERRIDE" as never, actorType: "ADMIN" as never, payload: { forged: true } });
  const forged = [...state.rows].sort((a, b) => Number(a.sequence) - Number(b.sequence)) as never[];
  assert.deepEqual(verifyFinancingAuditChain(forged), { ok: true }, "forged-but-consistent passes without an anchor (known limit)");
  const res = verifyFinancingAuditChain(forged, tip);
  assert.equal(res.ok, false, "the tip anchor rejects the forged append");
});
