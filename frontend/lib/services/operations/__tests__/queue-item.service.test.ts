// Tests for THE single §26 exception writer.
//
// The behaviours that matter, and why each is here:
//   • an uncatalogued code throws rather than inventing an owner and a deadline;
//   • a raise with no ref throws — §3 locates every record by stored reference;
//   • the catalogue supplies owner, buyer-visible status, required action, deadline
//     and return point, so no call site retypes them;
//   • a second raise for the same (code, subject) while the first is OPEN returns
//     the first, and creates nothing;
//   • a second raise AFTER the first is resolved creates a NEW row under a suffixed
//     key — the once-ever physical index must not make a recurrence unraisable;
//   • an explicit idempotency key is once-EVER and returns the resolved row;
//   • resolve() on a row that is already resolved THROWS. This is control/X-01: the
//     path this replaces swallowed the failed write and audited "resolved" anyway;
//   • a database error inside resolve() propagates. The writer never swallows.
//
// Run: pnpm test:operations

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Row {
  id: string;
  status: string;
  idempotencyKey: string | null;
  [k: string]: unknown;
}

const state: { rows: Map<string, Row>; failNextUpdate: boolean; createCalls: number } = {
  rows: new Map(),
  failNextUpdate: false,
  createCalls: 0,
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && "in" in (v as Record<string, unknown>)) {
      if (!(v as { in: unknown[] }).in.includes(row[k])) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      queueItem: {
        create: async ({ data }: { data: Row }) => {
          state.createCalls++;
          if (data.idempotencyKey !== null) {
            for (const existing of state.rows.values()) {
              if (existing.idempotencyKey === data.idempotencyKey) {
                const err = new Error("Unique constraint failed") as Error & { code?: string };
                err.code = "P2002";
                throw err;
              }
            }
          }
          const row = { ...data };
          state.rows.set(row.id, row);
          return row;
        },
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          [...state.rows.values()].find((r) => matches(r, where)) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) => state.rows.get(where.id) ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          [...state.rows.values()].filter((r) => matches(r, where)),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (state.failNextUpdate) {
            state.failNextUpdate = false;
            throw new Error("connection terminated");
          }
          let count = 0;
          for (const row of state.rows.values()) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        },
      },
    },
  },
});

// The module under test is loaded per test, after `mock.module` has registered the
// fake Prisma client. Top-level await is unavailable — tsx emits CJS for node:test.
function svc() {
  return import("@/lib/services/operations/queue-item.service");
}
function cat() {
  return import("@/lib/services/operations/exception-catalogue");
}

beforeEach(() => {
  state.rows.clear();
  state.failNextUpdate = false;
  state.createCalls = 0;
});

test("the catalogue covers §26's 48 rows plus the two the Markdown states elsewhere", async () => {
  const { EXCEPTION_CATALOGUE } = await cat();
  assert.equal(EXCEPTION_CATALOGUE.length, 50);
  // §26 proper: 48 rows. Plus COMMS_TERMINAL_FAILURE (§27, rendered in the HTML
  // register — §2 difference D2) and LINEAGE_ORPHAN (§3).
  const extras = EXCEPTION_CATALOGUE.filter((d) => d.code === "COMMS_TERMINAL_FAILURE" || d.code === "LINEAGE_ORPHAN");
  assert.equal(extras.length, 2);
  assert.equal(EXCEPTION_CATALOGUE.length - extras.length, 48);
});

test("every catalogue entry names an owner, a required action and a return point", async () => {
  const { EXCEPTION_CATALOGUE } = await cat();
  for (const def of EXCEPTION_CATALOGUE) {
    assert.ok(def.ownerRole, `${def.code} has no owner`);
    assert.ok(def.requiredAction.length > 10, `${def.code} has no required action`);
    assert.ok(def.returnPoint.length > 5, `${def.code} has no return point`);
    assert.ok(def.label.length > 3, `${def.code} has no label`);
    // buyerVisibleStatus may be null — see the catalogue header — but it must be
    // an explicit null, never undefined.
    assert.ok(def.buyerVisibleStatus === null || typeof def.buyerVisibleStatus === "string", `${def.code}`);
    assert.ok(def.deadlineHours === null || def.deadlineHours > 0, `${def.code} has a non-positive deadline`);
  }
});

test("an uncatalogued code throws rather than inventing an owner", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  await assert.rejects(
    () => raiseException({ code: "NOT_A_REAL_CODE", buyerId: "b1" }),
    /not in the §26 register/
  );
});

test("a raise with neither a stored reference nor an explicit key throws", async () => {
  const { raiseException } = await svc();
  await assert.rejects(() => raiseException({ code: "PAYMENT_UNROUTABLE" }), /needs either a stored reference/);
});

test("an explicit key alone is enough — an unroutable payment has no platform record to point at", async () => {
  const { raiseException } = await svc();
  // This is the real shape of the §26 "Payment unroutable to an obligation" raise:
  // a Stripe intent whose metadata matched nothing, so no deposit, request or
  // buyer exists to reference. Refusing it would make the one exception §26 marks
  // "never absorbed" the one exception that cannot be raised.
  const { item, created } = await raiseException({
    code: "PAYMENT_UNROUTABLE",
    idempotencyKey: "PAYMENT_UNROUTABLE:pi_orphan",
  });
  assert.equal(created, true);
  assert.equal(item.ownerRole, "FINANCE");
  assert.equal(item.idempotencyKey, "PAYMENT_UNROUTABLE:pi_orphan");
});

test("the catalogue supplies owner, buyer-visible status, action, deadline and return point", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { EXCEPTION_CATALOGUE, requireException } = await cat();
  const def = requireException("LOCATION_UNUSABLE");
  const { item, created } = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  assert.equal(created, true);
  assert.equal(item.ownerRole, def.ownerRole);
  assert.equal(item.buyerVisibleStatus, def.buyerVisibleStatus);
  assert.equal(item.requiredAction, def.requiredAction);
  assert.equal(item.returnPoint, def.returnPoint);
  assert.equal(item.type, def.type);
  assert.ok(item.deadlineAt instanceof Date);
});

test("detail is appended to the catalogue action, never replaces it", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { EXCEPTION_CATALOGUE, requireException } = await cat();
  const def = requireException("PAYMENT_UNROUTABLE");
  const { item } = await raiseException({ code: "PAYMENT_UNROUTABLE", depositId: "d1", detail: "pi_123" });
  assert.ok(String(item.requiredAction).startsWith(def.requiredAction));
  assert.ok(String(item.requiredAction).endsWith("pi_123"));
});

test("a second raise for the same subject while the first is open returns the first", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const first = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  const second = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  assert.equal(second.created, false);
  assert.equal(second.item.id, first.item.id);
  assert.equal(state.rows.size, 1);
});

test("a different subject gets its own row", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  const other = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b2" });
  assert.equal(other.created, true);
  assert.equal(state.rows.size, 2);
});

test("a recurrence after resolution creates a new row under a suffixed key", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const first = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  await resolve({ queueItemId: first.item.id, resolution: "buyer corrected the ZIP", resolvedBy: "admin_1" });

  const again = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  assert.equal(again.created, true, "a recurrence must be raisable after resolution");
  assert.notEqual(again.item.id, first.item.id);
  assert.equal(again.item.idempotencyKey, "LOCATION_UNUSABLE:buyer=b1#2");
  assert.equal(state.rows.size, 2);
});

test("an explicit idempotency key is once-ever and returns the resolved row", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const first = await raiseException({ code: "PAYMENT_UNROUTABLE", depositId: "d1", idempotencyKey: "evt_1" });
  await resolve({ queueItemId: first.item.id, resolution: "routed", resolvedBy: "admin_1" });

  const replay = await raiseException({ code: "PAYMENT_UNROUTABLE", depositId: "d1", idempotencyKey: "evt_1" });
  assert.equal(replay.created, false);
  assert.equal(replay.item.id, first.item.id);
  assert.equal(state.rows.size, 1, "a replayed provider event must not raise a second exception");
});

test("resolve on an already-resolved item THROWS — control/X-01", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { item } = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  await resolve({ queueItemId: item.id, resolution: "done", resolvedBy: "admin_1" });
  await assert.rejects(
    () => resolve({ queueItemId: item.id, resolution: "done again", resolvedBy: "admin_2" }),
    QueueItemConcurrencyError
  );
});

test("a database error inside resolve propagates — the writer never swallows", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { item } = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  state.failNextUpdate = true;
  await assert.rejects(() => resolve({ queueItemId: item.id, resolution: "done", resolvedBy: "a" }), /connection terminated/);
  assert.equal(state.rows.get(item.id)?.status, "OPEN", "a failed resolve must leave the item open");
});

test("resolve on a missing item throws rather than reporting success", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  await assert.rejects(
    () => resolve({ queueItemId: "nope", resolution: "x", resolvedBy: "a" }),
    QueueItemConcurrencyError
  );
});

test("assign moves an open item to ASSIGNED and records the admin", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { item } = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  const assigned = await assign({ queueItemId: item.id, adminId: "admin_7" });
  assert.equal(assigned.status, "ASSIGNED");
  assert.equal(assigned.assignedAdminId, "admin_7");
});

test("assign on a resolved item throws", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { item } = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  await resolve({ queueItemId: item.id, resolution: "done", resolvedBy: "a" });
  await assert.rejects(() => assign({ queueItemId: item.id, adminId: "admin_7" }), QueueItemConcurrencyError);
});

test("escalate stamps escalated_at, keeps the item open, and records the reason", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { item } = await raiseException({ code: "CONTRACT_OVERDUE_FROM_DEALER", dealId: "deal_1" });
  const escalated = await escalate({ queueItemId: item.id, reason: "48h past deadline" });
  assert.equal(escalated.status, "ESCALATED");
  assert.ok(escalated.escalatedAt instanceof Date);
  assert.ok(String(escalated.requiredAction).includes("48h past deadline"));

  const open = await listOpen({ dealId: "deal_1" });
  assert.equal(open.length, 1, "an escalated item is still open");
});

test("listOpen excludes resolved items and filters by owner", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const a = await raiseException({ code: "LOCATION_UNUSABLE", buyerId: "b1" });
  await raiseException({ code: "PAYMENT_UNROUTABLE", depositId: "d1" });
  await resolve({ queueItemId: a.item.id, resolution: "done", resolvedBy: "x" });

  const open = await listOpen();
  assert.equal(open.length, 1);
  assert.equal(open[0].exceptionCode, "PAYMENT_UNROUTABLE");

  const finance = await listOpen({ ownerRole: "FINANCE" });
  assert.equal(finance.length, 1);
  const buyerOps = await listOpen({ ownerRole: "BUYER_OPERATIONS" });
  assert.equal(buyerOps.length, 0);
});

test("every catalogue code is raisable — no entry has an unreachable shape", async () => {
  const { raiseException, resolve, assign, escalate, listOpen, QueueItemConcurrencyError } = await svc();
  const { EXCEPTION_CATALOGUE, requireException } = await cat();
  for (const def of EXCEPTION_CATALOGUE) {
    state.rows.clear();
    const { item } = await raiseException({ code: def.code, buyerId: "b1" });
    assert.equal(item.exceptionCode, def.code);
  }
});
